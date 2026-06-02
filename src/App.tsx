import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axountLogo from "../img/axount_logo-bw-400w.png";
import {
  createDesktopFileBridge,
  listenNativeProjectOpen,
  openNativeProjectFile,
  openNativeProjectPath,
  takePendingNativeProjectPaths,
} from "./lib/desktopFiles";
import { functionCodesMatch, objectBucketFromCode } from "./lib/codes";
import { clearLatestDraft, draftSummary, loadLatestDraft, saveLatestDraft, type DraftSummary } from "./lib/draftStore";
import { saveExportFile, saveProjectFile, type ProjectSavePicker, type SavedProjectFileHandle } from "./lib/fileSave";
import { exportFileName, exportReconciliationWorkbook, projectTotals } from "./lib/exportWorkbook";
import { rollupBudgetLines } from "./lib/matching";
import { currency } from "./lib/money";
import { parseAllWorkbooks } from "./lib/parser";
import {
  activeBudgetLines,
  audit,
  buildCarryoverSource,
  createProject,
  downloadBlob,
  loadProjectBundle,
  projectFileName,
  saveProjectBundle,
  updateAllocation,
} from "./lib/project";
import {
  budgetAccountSummary,
  budgetAccountVariances,
  mappedFunctionCode,
  type BudgetAccountVariance,
} from "./lib/sourceChecks";
import type { AccountSummary, Allocation, BudgetLine, Project, Purchase, ReviewStatus } from "./lib/types";

const tabs = ["Dashboard", "Review Queue", "Spending", "Budget Lines", "Accounts", "Functions", "Objects", "Carryover", "Export"];

type Tab = (typeof tabs)[number];
const SIDEBAR_COLLAPSED_KEY = "axount-grant-ledger-sidebar-collapsed";
const REVIEW_STATUSES: ReviewStatus[] = ["Allowable", "Not Allowable", "Partially Allowable", "Review Required"];

interface ReviewFilters {
  functionCode: string;
  objectCode: string;
  status: ReviewStatus | "";
  keyword: string;
}

type ReviewQueueMode = "accounts" | "budget";

interface BudgetLineFilters {
  state: string;
  functionCode: string;
  object: string;
  needsReview: "" | "has-review" | "no-review";
  remaining: "" | "available" | "none" | "over-budget";
  keyword: string;
}

function defaultFiscalYear() {
  return {
    fiscalYear: "FY25",
    fiscalYearStart: "2024-07-01",
    fiscalYearEnd: "2025-06-30",
  };
}

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [tab, setTab] = useState<Tab>("Dashboard");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<Project | null>(null);
  const [draftStatus, setDraftStatus] = useState("No local draft loaded.");
  const [projectFileHandle, setProjectFileHandle] = useState<SavedProjectFileHandle | null>(null);
  const desktopFiles = useMemo(() => createDesktopFileBridge(), []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
  const autosaveTimer = useRef<number | null>(null);
  const [setup, setSetup] = useState({
    grantName: "35a5 Grant",
    grantCode: "35a5",
    budgetVersionLabel: "Original budget",
    ...defaultFiscalYear(),
  });
  const [files, setFiles] = useState<{ budget?: File; accounts?: File; invoices?: File; staff?: File; priorProject?: File }>({});

  const budgetLines = useMemo(() => (project ? activeBudgetLines(project) : []), [project]);
  const totals = useMemo(() => (project ? projectTotals(project) : null), [project]);
  const rollups = useMemo(
    () => (project ? rollupBudgetLines(budgetLines, project.allocations, project.carryovers) : []),
    [budgetLines, project],
  );
  const sourceVariances = useMemo(
    () => (project ? budgetAccountVariances(budgetLines, project.accounts, project.functionCodeMappings ?? {}) : []),
    [budgetLines, project],
  );
  const accountSummary = useMemo(
    () => (project ? budgetAccountSummary(budgetLines, project.accounts, project.functionCodeMappings ?? {}) : null),
    [budgetLines, project],
  );

  useEffect(() => {
    loadLatestDraft()
      .then((loaded) => {
        setDraft(loaded);
        if (loaded) setDraftStatus(`Autosaved draft found from ${formatDateTime(loaded.updatedAt)}.`);
      })
      .catch(() => setDraftStatus("Local autosave is unavailable in this browser session."));
  }, []);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!project) return;
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      saveLatestDraft(project)
        .then(() => {
          setDraft(project);
          setDraftStatus(`Autosaved locally at ${formatDateTime(project.updatedAt)}.`);
        })
        .catch(() => setDraftStatus("Autosave failed. Download a .recon project file to preserve this work."));
    }, 400);
    return () => {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    };
  }, [project]);

  async function importProject() {
    if (!files.budget || !files.accounts || (!files.invoices && !files.staff)) {
      setMessage("Choose the budget, account, and at least one spending workbook: invoice detail or staff payroll.");
      return;
    }
    setBusy(true);
    setMessage(files.priorProject ? "Importing workbooks and prior project..." : "Importing workbooks...");
    try {
      const [imports, priorProject] = await Promise.all([
        parseAllWorkbooks({
          budgetFile: files.budget,
          accountsFile: files.accounts,
          invoicesFile: files.invoices,
          staffFile: files.staff,
          budgetVersionLabel: setup.budgetVersionLabel,
        }),
        files.priorProject ? loadProjectBundle(files.priorProject) : Promise.resolve(undefined),
      ]);
      const created = createProject({ ...setup, imports, priorProject });
      setProject(created);
      setProjectFileHandle(null);
      setTab("Dashboard");
      setMessage(
        priorProject
          ? "Project imported with prior-year carryover and autosaved locally. Use Save Project to choose a .recon file."
          : "Project imported and autosaved locally. Use Save Project to choose a .recon file.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  const openProject = useCallback(async (file?: File, handle?: SavedProjectFileHandle) => {
    if (!file) return;
    setBusy(true);
    try {
      const loaded = await loadProjectBundle(file);
      setProject(loaded);
      setProjectFileHandle(handle ?? null);
      setTab("Dashboard");
      setMessage(
        handle
          ? `Project reopened from ${handle.name}. Save Project overwrites this file.`
          : "Project reopened and autosaved locally. Use Save Project to choose where this file should be overwritten.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Project open failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  const openNativeProjectFromPath = useCallback(
    async (path: string) => {
      setBusy(true);
      try {
        const opened = await openNativeProjectPath(path);
        if (!opened) return;
        await openProject(opened.file, opened.handle);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Project open failed.");
      } finally {
        setBusy(false);
      }
    },
    [openProject],
  );

  useEffect(() => {
    if (!desktopFiles) return;
    let unlisten: (() => void) | null = null;
    let mounted = true;

    takePendingNativeProjectPaths()
      .then((paths) => {
        if (!mounted) return;
        for (const path of paths) void openNativeProjectFromPath(path);
      })
      .catch(() => undefined);

    listenNativeProjectOpen((path) => {
      void openNativeProjectFromPath(path);
    })
      .then((listener) => {
        if (!mounted) {
          listener?.();
          return;
        }
        unlisten = listener;
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [desktopFiles, openNativeProjectFromPath]);

  async function openNativeProject() {
    setBusy(true);
    try {
      const opened = await openNativeProjectFile();
      if (!opened) {
        setMessage("Open cancelled.");
        return;
      }
      await openProject(opened.file, opened.handle);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Project open failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProject() {
    if (!project) return;
    const blob = await saveProjectBundle(project);
    const result = await saveProjectFile({
      blob,
      suggestedName: projectFileName(project),
      handle: projectFileHandle,
      desktop: desktopFiles,
      picker: window as ProjectSavePicker,
      fallbackDownload: downloadBlob,
    });
    if (result.handle) setProjectFileHandle(result.handle);
    if (result.mode === "cancelled") {
      setMessage("Save cancelled.");
      return;
    }
    if (result.mode === "downloaded") {
      setMessage("Project file downloaded. This browser cannot overwrite downloads directly, so rename the file if you need a separate copy.");
      return;
    }
    setMessage(
      result.mode === "picked"
        ? `Project saved to ${result.fileName}. Future saves overwrite this file. Rename it in the save dialog when you want a separate file.`
        : `Project saved to ${result.fileName}.`,
    );
  }

  async function exportWorkbook() {
    if (!project) return;
    const blob = await exportReconciliationWorkbook(project);
    const result = await saveExportFile({
      blob,
      suggestedName: exportFileName(project),
      desktop: desktopFiles,
      fallbackDownload: downloadBlob,
    });
    if (result.mode === "cancelled") {
      setMessage("Export cancelled.");
      return;
    }
    setMessage(result.mode === "downloaded" ? "Excel reconciliation workbook downloaded." : `Excel reconciliation workbook saved to ${result.fileName}.`);
  }

  function applyAllocation(allocation: Allocation) {
    if (!project) return;
    setProject(updateAllocation(project, allocation));
  }

  function applyAllocations(allocations: Allocation[]) {
    if (!allocations.length) return;
    setProject((current) => {
      if (!current) return current;
      const updates = new Map(allocations.map((allocation) => [allocation.id, allocation]));
      return {
        ...current,
        updatedAt: new Date().toISOString(),
        allocations: current.allocations.map((allocation) => updates.get(allocation.id) ?? allocation),
        auditLog: [audit("Bulk review updated", `${allocations.length} review queue items updated.`), ...current.auditLog],
      };
    });
  }

  function applyFunctionCodeMapping(sourceFunctionCode: string, targetFunctionCode: string) {
    if (!project) return;
    const currentMappings = project.functionCodeMappings ?? {};
    const nextMappings = { ...currentMappings };
    if (!targetFunctionCode || targetFunctionCode === sourceFunctionCode) {
      delete nextMappings[sourceFunctionCode];
    } else {
      nextMappings[sourceFunctionCode] = targetFunctionCode;
    }
    setProject({
      ...project,
      functionCodeMappings: nextMappings,
      auditLog: [
        audit(
          "Function code remap updated",
          targetFunctionCode && targetFunctionCode !== sourceFunctionCode
            ? `${sourceFunctionCode} account budgets compare as ${targetFunctionCode}`
            : `${sourceFunctionCode} account budget remap cleared`,
        ),
        ...project.auditLog,
      ],
      updatedAt: new Date().toISOString(),
    });
  }

  function resumeDraft() {
    if (!draft) return;
    setProject({ ...draft, functionCodeMappings: draft.functionCodeMappings ?? {} });
    setProjectFileHandle(null);
    setTab("Dashboard");
    setMessage("Autosaved local draft resumed. Use Save Project to choose a .recon file.");
  }

  async function discardDraft() {
    await clearLatestDraft();
    setDraft(null);
    setDraftStatus("Autosaved draft cleared.");
  }

  function openHome() {
    setProject(null);
    setProjectFileHandle(null);
    setTab("Dashboard");
    setFiles({});
    setMessage("Home opened. Start a new grant review or resume an autosaved draft.");
  }

  async function importCarryover(file?: File) {
    if (!file || !project) return;
    const prior = await loadProjectBundle(file);
    const carryover = buildCarryoverSource(project, prior);
    setProject({
      ...project,
      carryovers: [...project.carryovers, carryover],
      auditLog: [audit("Carryover imported", `${prior.grantName} ${prior.fiscalYear}`), ...project.auditLog],
      updatedAt: new Date().toISOString(),
    });
    setMessage("Carryover project imported.");
  }

  return (
    <main className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <button className="brand brand-button" type="button" title="Home / New Grant" onClick={openHome}>
          <div className="mark">
            <img src={axountLogo} alt="" />
          </div>
          <div className="brand-copy">
            <h1>aXount: Grant Ledger</h1>
            <p>Local grant reconciliation</p>
          </div>
        </button>
        <button
          className="sidebar-toggle"
          type="button"
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
        >
          {sidebarCollapsed ? ">" : "<"}
        </button>
        {project ? (
          <>
            <div className="project-card">
              <strong>{project.grantName}</strong>
              <span>
                {project.grantCode} / {project.fiscalYear}
              </span>
            </div>
            <nav>
              {tabs.map((item) => (
                <button
                  key={item}
                  className={tab === item ? "active" : ""}
                  aria-label={item}
                  title={item}
                  onClick={() => setTab(item)}
                >
                  <span className="nav-icon">{tabIcon(item)}</span>
                  <span className="nav-label">{item}</span>
                </button>
              ))}
            </nav>
            <button className="secondary" aria-label="New Grant" onClick={openHome}>
              <span className="save-full">New Grant</span>
              <span className="save-short">New</span>
            </button>
            <button className="secondary" aria-label="Save Project" onClick={saveProject}>
              <span className="save-full">Save Project</span>
              <span className="save-short">Save</span>
            </button>
          </>
        ) : (
          <p className="empty-note">Import workbooks or reopen a saved project.</p>
        )}
      </aside>

      <section className="workspace">
        {message && <div className="toast">{message}</div>}
        {!project ? (
          <ImportScreen
            setup={setup}
            setSetup={setSetup}
            files={files}
            setFiles={setFiles}
            onImport={importProject}
            onOpen={openProject}
            onOpenNative={desktopFiles ? openNativeProject : undefined}
            onResumeDraft={resumeDraft}
            onDiscardDraft={discardDraft}
            draft={draft ? draftSummary(draft) : null}
            draftStatus={draftStatus}
            busy={busy}
          />
        ) : (
          <>
            <SaveNotice draftStatus={draftStatus} projectFileName={projectFileHandle?.name} onSave={saveProject} nativeSave={Boolean(desktopFiles)} />
            {tab === "Dashboard" && (
              <Dashboard
                project={project}
                totals={totals!}
                rollups={rollups}
                sourceVariances={sourceVariances}
                accountSummary={accountSummary!}
                onOpenTab={setTab}
              />
            )}
            {tab === "Review Queue" && (
              <ReviewQueue project={project} budgetLines={budgetLines} onChange={applyAllocation} onBulkChange={applyAllocations} />
            )}
            {tab === "Spending" && <Spending project={project} budgetLines={budgetLines} onChange={applyAllocation} />}
            {tab === "Budget Lines" && <BudgetLines rollups={rollups} />}
            {tab === "Accounts" && (
              <Accounts
                project={project}
                sourceVariances={sourceVariances}
                onFunctionCodeMappingChange={applyFunctionCodeMapping}
              />
            )}
            {tab === "Functions" && <Breakdown project={project} mode="function" />}
            {tab === "Objects" && <Breakdown project={project} mode="object" />}
            {tab === "Carryover" && <Carryover project={project} rollups={rollups} totals={totals!} onImport={importCarryover} />}
            {tab === "Export" && <ExportView project={project} onSave={saveProject} onExport={exportWorkbook} />}
          </>
        )}
      </section>
    </main>
  );
}

function ImportScreen({
  setup,
  setSetup,
  files,
  setFiles,
  onImport,
  onOpen,
  onOpenNative,
  onResumeDraft,
  onDiscardDraft,
  draft,
  draftStatus,
  busy,
}: {
  setup: ReturnType<typeof defaultFiscalYear> & {
    grantName: string;
    grantCode: string;
    budgetVersionLabel: string;
  };
  setSetup: (setup: ReturnType<typeof defaultFiscalYear> & { grantName: string; grantCode: string; budgetVersionLabel: string }) => void;
  files: { budget?: File; accounts?: File; invoices?: File; staff?: File; priorProject?: File };
  setFiles: (files: { budget?: File; accounts?: File; invoices?: File; staff?: File; priorProject?: File }) => void;
  onImport: () => void;
  onOpen: (file?: File) => void;
  onOpenNative?: () => void;
  onResumeDraft: () => void;
  onDiscardDraft: () => void;
  draft: DraftSummary | null;
  draftStatus: string;
  busy: boolean;
}) {
  return (
    <div className="import-layout">
      <section className="hero-panel">
        <h2>Grant spending clarity that stays on your computer.</h2>
        <p>
          Import the approved budget, account totals, and invoice or staff detail. Grant Ledger matches spending to budget
          lines, flags weak matches for review, tracks carryover, and exports an audit-ready workbook.
        </p>
        {draft && (
          <div className="draft-card">
            <div>
              <strong>Autosaved draft available</strong>
              <span>
                {draft.grantName} / {draft.grantCode} / {draft.fiscalYear}
              </span>
              <span>Saved locally {formatDateTime(draft.updatedAt)}</span>
            </div>
            <div className="draft-actions">
              <button className="primary" onClick={onResumeDraft}>Resume Draft</button>
              <button className="secondary" onClick={onDiscardDraft}>Clear Draft</button>
            </div>
          </div>
        )}
        <label className="file-drop compact">
          <span>Open saved .recon project</span>
          <input type="file" accept=".recon" onChange={(event) => onOpen(event.target.files?.[0])} />
        </label>
        {onOpenNative && (
          <button className="secondary" disabled={busy} onClick={onOpenNative}>
            Open .recon Project
          </button>
        )}
        <p className="draft-status">{draftStatus}</p>
      </section>

      <section className="setup-panel">
        <h3>New project</h3>
        <div className="form-grid">
          <label>
            Grant name
            <input value={setup.grantName} onChange={(event) => setSetup({ ...setup, grantName: event.target.value })} />
          </label>
          <label>
            Grant code
            <input value={setup.grantCode} onChange={(event) => setSetup({ ...setup, grantCode: event.target.value })} />
          </label>
          <label>
            Fiscal year
            <input value={setup.fiscalYear} onChange={(event) => setSetup({ ...setup, fiscalYear: event.target.value })} />
          </label>
          <label>
            Budget version
            <input
              value={setup.budgetVersionLabel}
              onChange={(event) => setSetup({ ...setup, budgetVersionLabel: event.target.value })}
            />
          </label>
          <label>
            Start date
            <input
              type="date"
              value={setup.fiscalYearStart}
              onChange={(event) => setSetup({ ...setup, fiscalYearStart: event.target.value })}
            />
          </label>
          <label>
            End date
            <input
              type="date"
              value={setup.fiscalYearEnd}
              onChange={(event) => setSetup({ ...setup, fiscalYearEnd: event.target.value })}
            />
          </label>
        </div>
        <div className="file-grid">
          <FileInput
            label="Approved budget"
            file={files.budget}
            accept=".xlsx,.csv"
            placeholder="Choose .xlsx or .csv file"
            onFile={(budget) => setFiles({ ...files, budget })}
          />
          <FileInput label="Account summary" file={files.accounts} onFile={(accounts) => setFiles({ ...files, accounts })} />
          <FileInput label="Invoice detail (optional)" file={files.invoices} onFile={(invoices) => setFiles({ ...files, invoices })} />
          <FileInput label="Staff payroll (optional)" file={files.staff} onFile={(staff) => setFiles({ ...files, staff })} />
          <FileInput
            label="Prior .recon carryover (optional)"
            file={files.priorProject}
            accept=".recon"
            placeholder="Choose prior project"
            onFile={(priorProject) => setFiles({ ...files, priorProject })}
          />
        </div>
        <button className="primary" disabled={busy} onClick={onImport}>
          {busy ? "Importing..." : "Import and Match"}
        </button>
      </section>
    </div>
  );
}

function SaveNotice({
  draftStatus,
  projectFileName,
  onSave,
  nativeSave,
}: {
  draftStatus: string;
  projectFileName?: string;
  onSave: () => void;
  nativeSave: boolean;
}) {
  return (
    <div className="save-notice">
      <div>
        <strong>Autosave is local to this browser.</strong>
        <span>
          {draftStatus} {projectFileName ? `Save Project overwrites ${projectFileName}.` : "First save chooses a .recon file; later saves overwrite it."} Rename the file in the save dialog if you want a separate copy.
          {nativeSave ? " Desktop saves use the system file dialog." : ""}
        </span>
      </div>
      <button className="primary" onClick={onSave}>
        Save Project File
      </button>
    </div>
  );
}

function FileInput({
  label,
  file,
  onFile,
  accept = ".xlsx",
  placeholder = "Choose .xlsx file",
}: {
  label: string;
  file?: File;
  onFile: (file?: File) => void;
  accept?: string;
  placeholder?: string;
}) {
  return (
    <label className="file-drop">
      <span>{label}</span>
      <strong>{file?.name ?? placeholder}</strong>
      <input type="file" accept={accept} onChange={(event) => onFile(event.target.files?.[0])} />
    </label>
  );
}

function spendingSource(purchase: Purchase): string {
  return purchase.sourceType === "staff" ? "Staff payroll" : "Invoice";
}

function spendingName(purchase: Purchase): string {
  if (purchase.sourceType === "staff") return purchase.employeeName && purchase.employeeId ? `${purchase.employeeName} (${purchase.employeeId})` : purchase.vendorName;
  return purchase.vendorName;
}

function spendingReference(purchase: Purchase): string {
  if (purchase.sourceType === "staff") return purchase.status || "Payroll";
  return purchase.poNumber ? `PO ${purchase.poNumber}` : purchase.requisitionNumber ? `Req ${purchase.requisitionNumber}` : "Invoice detail";
}

function Dashboard({
  project,
  totals,
  rollups,
  sourceVariances,
  accountSummary,
  onOpenTab,
}: {
  project: Project;
  totals: ReturnType<typeof projectTotals>;
  rollups: ReturnType<typeof rollupBudgetLines>;
  sourceVariances: BudgetAccountVariance[];
  accountSummary: ReturnType<typeof budgetAccountSummary>;
  onOpenTab: (tab: Tab) => void;
}) {
  const overBudget = rollups.filter((row) => row.state === "Over Budget");
  const flexUsed = rollups.filter((row) => row.state === "Flex Used");
  const hasBudgetDifference = Math.abs(accountSummary.netDifference) > 0.01;
  const reviewItems = project.allocations
    .filter((allocation) => allocation.status === "Review Required" || allocation.matchBasis !== "specific-budget-line")
    .sort((a, b) => priority(b) - priority(a));
  const budgetAttention = [...overBudget, ...flexUsed].slice(0, 6);
  return (
    <div className="screen">
      <ScreenHeader title="Dashboard" subtitle={`${project.grantName} / ${project.fiscalYear}`} />
      <div className="kpi-grid">
        <Kpi label="Approved Budget" value={currency(totals.approved)} />
        <Kpi label="Loaded Account Budget" value={currency(accountSummary.accountBudgetTotal)} tone={hasBudgetDifference ? "warn" : "good"} />
        <Kpi label="Current Spending" value={currency(totals.payments)} />
        <Kpi label="Confirmed Spending" value={currency(totals.grantToDate)} />
        <Kpi label="Budget Remaining" value={currency(totals.remainingBeforeFlex)} tone={totals.remainingBeforeFlex < 0 ? "bad" : "good"} />
        <Kpi label="Needs Review" value={currency(totals.review)} tone="warn" />
        <Kpi label="Not Allowable" value={currency(totals.notAllowable)} tone="bad" />
        <Kpi label="Net Account Budget Difference" value={signedCurrency(accountSummary.netDifference)} tone={hasBudgetDifference ? "warn" : "good"} />
      </div>
      <p className="plain-note">
        Confirmed Spending includes reviewed current-year invoice and staff spending plus imported prior-year confirmed spending.
        The net account budget difference compares loaded account budgets to the approved budget; function/object setup mismatches are listed in Accounts.
      </p>
      <section className="panel">
        <div className="panel-heading">
          <h3>Attention Needed</h3>
          <button className="small-action" onClick={() => onOpenTab("Review Queue")}>Open Review Queue</button>
        </div>
        <div className="attention-actions">
          <button onClick={() => onOpenTab("Review Queue")}>
            <strong>{reviewItems.length}</strong>
            <span>spending items need review</span>
          </button>
          <button onClick={() => onOpenTab("Budget Lines")}>
            <strong>{overBudget.length}</strong>
            <span>budget lines are over budget</span>
          </button>
          <button onClick={() => onOpenTab("Accounts")}>
            <strong>{sourceVariances.length}</strong>
            <span>budget/account setup gaps</span>
          </button>
          <button onClick={() => onOpenTab("Carryover")}>
            <strong>{currency(totals.carryover)}</strong>
            <span>imported prior-year spending</span>
          </button>
        </div>
      </section>
      <details className="advanced-panel">
        <summary>Advanced detail</summary>
        <div className="split compact-split">
          <section className="panel">
            <h3>Detailed Budget Position</h3>
            <div className="carryover-metrics">
              <Metric label="Approved budget" value={currency(totals.approved)} />
              <Metric label="Prior confirmed spending" value={currency(totals.carryover)} />
              <Metric label="Current confirmed spending" value={currency(totals.allowable)} />
              <Metric label="All confirmed spending" value={currency(totals.grantToDate)} />
              <Metric label="Budget remaining" value={currency(totals.remainingBeforeFlex)} />
            </div>
          </section>
          <section className="panel">
            <h3>Line Status Detail</h3>
          <table>
            <thead>
              <tr>
                <th>State</th>
                <th>Lines</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {["Under Budget", "Within Budget", "Flex Used", "Over Budget"].map((state) => {
                const rows = rollups.filter((row) => row.state === state);
                return (
                  <tr key={state}>
                    <td><StatusPill status={state} /></td>
                    <td>{rows.length}</td>
                    <td>{currency(rows.reduce((total, row) => total + row.totalAgainstBudget, 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </section>
        </div>
      </details>
      <div className="split">
        <section className="panel">
          <div className="panel-heading">
            <h3>Budget vs Accounts Gaps</h3>
            <button className="small-action" onClick={() => onOpenTab("Accounts")}>Open Accounts</button>
          </div>
          <BudgetAccountGapList rows={sourceVariances.slice(0, 6)} />
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h3>Review These Items</h3>
            <button className="small-action" onClick={() => onOpenTab("Review Queue")}>Review all</button>
          </div>
          <DashboardReviewList project={project} rows={reviewItems.slice(0, 6)} />
        </section>
        <section className="panel full-span">
          <div className="panel-heading">
            <h3>Budget Lines To Check</h3>
            <button className="small-action" onClick={() => onOpenTab("Budget Lines")}>Open Budget Lines</button>
          </div>
          <DashboardBudgetList rows={budgetAttention} />
          <p className="footnote">* Means the line is over the approved amount but within 10%.</p>
        </section>
      </div>
    </div>
  );
}

function BudgetAccountGapList({ rows }: { rows: BudgetAccountVariance[] }) {
  if (!rows.length) return <p className="muted">The approved budget and loaded account budgets match by function/object.</p>;
  return (
    <div className="compact-list">
      {rows.map((row) => (
        <div className="compact-row" key={row.id}>
          <div>
            <strong>
              {row.functionCode} / {row.objectBucket}: {currency(Math.abs(row.differenceAmount))}
            </strong>
            <span>
              {row.type}. Approved {currency(row.approvedAmount)} vs accounts {currency(row.accountBudgetAmount)}.
            </span>
            {row.likelyBudgetLines[0] && (
              <span>
                Likely line: row {row.likelyBudgetLines[0].sourceRow}, {row.likelyBudgetLines[0].description}
              </span>
            )}
          </div>
          <div className="compact-meta">
            <StatusPill status={row.type} />
            <strong>{currency(row.differenceAmount)}</strong>
          </div>
        </div>
      ))}
    </div>
  );
}

function DashboardReviewList({ project, rows }: { project: Project; rows: Allocation[] }) {
  if (!rows.length) return <p className="muted">No review-required spending items.</p>;
  return (
    <div className="compact-list">
      {rows.map((allocation) => {
        const purchase = project.purchases.find((item) => item.id === allocation.purchaseId);
        const variance = project.controlVariances.find((item) => item.id === allocation.accountSummaryId);
        const amount = purchase?.paymentAmount ?? variance?.varianceAmount ?? 0;
        return (
          <div className="compact-row" key={allocation.id}>
            <div>
              <strong>{purchase ? spendingName(purchase) : variance?.accountNumber || "Review item"}</strong>
              <span>
                {purchase
                  ? `${purchase.functionCode} / ${purchase.objectCode} / ${spendingReference(purchase)}`
                  : variance?.accountDescription}
              </span>
            </div>
            <div className="compact-meta">
              <StatusPill status={allocation.matchBasis} />
              <strong>{currency(amount)}</strong>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DashboardBudgetList({ rows }: { rows: ReturnType<typeof rollupBudgetLines> }) {
  if (!rows.length) return <p className="muted">No budget lines are over budget.</p>;
  return (
    <div className="compact-list">
      {rows.map((row) => (
        <div className="compact-row" key={row.line.id}>
          <div>
            <strong>
              {row.line.functionCode} / {row.line.objectBucket}
            </strong>
            <span>{row.line.description}</span>
          </div>
          <div className="compact-meta">
            <StatusPill status={simpleBudgetState(row.state)} />
            <strong>{currency(row.totalAgainstBudget)}</strong>
            <span>remaining {currency(row.remainingBeforeFlex)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReviewQueue({ project, budgetLines, onChange, onBulkChange }: ReviewProps & { onBulkChange: (allocations: Allocation[]) => void }) {
  const [filters, setFilters] = useState<ReviewFilters>({ functionCode: "", objectCode: "", status: "", keyword: "" });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [mode, setMode] = useState<ReviewQueueMode>("accounts");
  const allRows = useMemo(
    () =>
      project.allocations
        .filter((allocation) => allocation.status === "Review Required" || allocation.matchBasis !== "specific-budget-line")
        .sort((a, b) => priority(b) - priority(a)),
    [project.allocations],
  );
  const filterOptions = useMemo(() => reviewFilterOptions(project, budgetLines, allRows), [project, budgetLines, allRows]);
  const rows = useMemo(() => filterReviewRows(project, budgetLines, allRows, filters), [project, budgetLines, allRows, filters]);
  const selectedRows = rows.filter((allocation) => selectedIds.has(allocation.id));
  const allRowsSelected = rows.length > 0 && selectedRows.length === rows.length;

  useEffect(() => {
    const rowIds = new Set(rows.map((allocation) => allocation.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => rowIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [rows]);

  function toggleSelection(allocationId: string, selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(allocationId);
      } else {
        next.delete(allocationId);
      }
      return next;
    });
  }

  function toggleAll(selected: boolean) {
    setSelectedIds(selected ? new Set(rows.map((allocation) => allocation.id)) : new Set());
  }

  function updateFilter(update: Partial<ReviewFilters>) {
    setFilters((current) => ({ ...current, ...update }));
  }

  return (
    <AllocationTable
      title="Review Queue"
      rows={rows}
      project={project}
      budgetLines={budgetLines}
      onChange={onChange}
      selectable={{
        allRowsSelected,
        filterOptions,
        filters,
        mode,
        rowCount: rows.length,
        selectedIds,
        selectedRows,
        totalCount: allRows.length,
        onBulkChange,
        onClearFilters: () => setFilters({ functionCode: "", objectCode: "", status: "", keyword: "" }),
        onClearSelection: () => setSelectedIds(new Set()),
        onFilterChange: updateFilter,
        onModeChange: setMode,
        onToggleAll: toggleAll,
        onToggleRow: toggleSelection,
      }}
    />
  );
}

function Spending({ project, budgetLines, onChange }: ReviewProps) {
  return <AllocationTable title="Spending" rows={project.allocations.filter((row) => row.purchaseId)} project={project} budgetLines={budgetLines} onChange={onChange} />;
}

interface ReviewProps {
  project: Project;
  budgetLines: BudgetLine[];
  onChange: (allocation: Allocation) => void;
}

interface SelectionProps {
  allRowsSelected: boolean;
  filterOptions: ReviewFilterOptions;
  filters: ReviewFilters;
  mode: ReviewQueueMode;
  rowCount: number;
  selectedIds: Set<string>;
  selectedRows: Allocation[];
  totalCount: number;
  onBulkChange: (allocations: Allocation[]) => void;
  onClearFilters: () => void;
  onClearSelection: () => void;
  onFilterChange: (update: Partial<ReviewFilters>) => void;
  onModeChange: (mode: ReviewQueueMode) => void;
  onToggleAll: (selected: boolean) => void;
  onToggleRow: (allocationId: string, selected: boolean) => void;
}

function AllocationTable({
  title,
  rows,
  project,
  budgetLines,
  onChange,
  selectable,
}: ReviewProps & { title: string; rows: Allocation[]; selectable?: SelectionProps }) {
  const budgetLineOptions = selectable ? reviewBudgetLineOptions(budgetLines, selectable.filters) : budgetLines;
  const reviewAmount = rows.reduce((total, allocation) => total + Math.abs(allocationAmount(project, allocation)), 0);
  const missingBudgetLines = rows.filter((allocation) => !allocation.budgetLineId).length;
  const manualDecisions = rows.filter((allocation) => allocation.matchBasis === "manual").length;
  return (
    <div className="screen">
      <ScreenHeader title={title} subtitle="Open every auto-match, weak match, and variance." />
      {selectable && (
        <>
          <div className="review-summary" aria-label="Review queue summary">
            <SummaryStat label="Visible items" value={`${rows.length}`} />
            <SummaryStat label="Visible amount" value={currency(reviewAmount)} />
            <SummaryStat label="No budget line" value={`${missingBudgetLines}`} />
            <SummaryStat label="Manual decisions" value={`${manualDecisions}`} />
          </div>
          <ReviewModeToggle mode={selectable.mode} onChange={selectable.onModeChange} />
          <ReviewQueueFilters
            filters={selectable.filters}
            options={selectable.filterOptions}
            rowCount={selectable.rowCount}
            totalCount={selectable.totalCount}
            onChange={selectable.onFilterChange}
            onClear={selectable.onClearFilters}
          />
          {selectable.mode === "accounts" && (
            <ReviewBulkEditor
              project={project}
              budgetLines={budgetLineOptions}
              selectedRows={selectable.selectedRows}
              onApply={(allocations) => {
                selectable.onBulkChange(allocations);
                selectable.onClearSelection();
              }}
            />
          )}
        </>
      )}
      {(!selectable || selectable.mode === "accounts") && (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {selectable && (
                <th className="selection-cell">
                  <input
                    type="checkbox"
                    aria-label="Select all review queue items"
                    checked={selectable.allRowsSelected}
                    onChange={(event) => selectable.onToggleAll(event.target.checked)}
                  />
                </th>
              )}
              <th>Status</th>
              <th>Basis</th>
              <th>Spending / Variance</th>
              <th>Amount</th>
              <th>Budget Line</th>
              <th>Review Decision</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((allocation) => {
              const purchase = project.purchases.find((item) => item.id === allocation.purchaseId);
              const variance = project.controlVariances.find((item) => item.id === allocation.accountSummaryId);
              const line = budgetLines.find((item) => item.id === allocation.budgetLineId);
              const amount = allocationAmount(project, allocation);
              return (
                <tr key={allocation.id} className={selectable?.selectedIds.has(allocation.id) ? "selected-row" : undefined}>
                  {selectable && (
                    <td className="selection-cell">
                      <input
                        type="checkbox"
                        aria-label={`Select ${purchase ? spendingName(purchase) : variance?.accountNumber ?? "review item"}`}
                        checked={selectable.selectedIds.has(allocation.id)}
                        onChange={(event) => selectable.onToggleRow(allocation.id, event.target.checked)}
                      />
                    </td>
                  )}
                  <td><StatusPill status={allocation.status} /></td>
                  <td className="basis-cell">{allocation.matchBasis}</td>
                  <td>
                    <strong>{purchase ? spendingName(purchase) : variance?.accountNumber}</strong>
                    <span className="muted block">
                      {purchase ? `${spendingSource(purchase)} / ${purchase.accountNumber} / ${spendingReference(purchase)}` : variance?.accountDescription}
                    </span>
                    <span className="muted block">{allocation.reasons.join(" ")}</span>
                  </td>
                  <td className="amount-cell">{currency(amount)}</td>
                  <td>
                    <select
                      value={allocation.budgetLineId ?? ""}
                      onChange={(event) =>
                        onChange({ ...allocation, budgetLineId: event.target.value || undefined, matchBasis: "manual" })
                      }
                    >
                      <option value="">No budget line</option>
                      {budgetLineOptions.map((budgetLine) => (
                        <option key={budgetLine.id} value={budgetLine.id}>
                          {reviewBudgetLineLabel(budgetLine)}
                        </option>
                      ))}
                    </select>
                    {line && <span className="muted block">{currency(line.approvedAmount)} approved</span>}
                  </td>
                  <td>
                    <ReviewEditor allocation={allocation} amount={amount} onChange={onChange} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
      {selectable?.mode === "budget" && (
        <BudgetReviewTable
          project={project}
          budgetLines={budgetLineOptions}
          rows={rows}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function ReviewModeToggle({ mode, onChange }: { mode: ReviewQueueMode; onChange: (mode: ReviewQueueMode) => void }) {
  return (
    <div className="review-mode-toggle" role="group" aria-label="Review queue view">
      <button
        type="button"
        className={mode === "accounts" ? "active" : undefined}
        aria-pressed={mode === "accounts"}
        onClick={() => onChange("accounts")}
      >
        Account View
      </button>
      <button
        type="button"
        className={mode === "budget" ? "active" : undefined}
        aria-pressed={mode === "budget"}
        onClick={() => onChange("budget")}
      >
        Budget View
      </button>
    </div>
  );
}

function BudgetReviewTable({
  project,
  budgetLines,
  rows,
  onChange,
}: {
  project: Project;
  budgetLines: BudgetLine[];
  rows: Allocation[];
  onChange: (allocation: Allocation) => void;
}) {
  const lineRows = budgetLines
    .map((budgetLine) => ({
      budgetLine,
      items: reviewItemsForBudgetLine(project, budgetLines, rows, budgetLine),
    }))
    .filter((row) => row.items.length > 0);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Budget Line</th>
            <th>Approved</th>
            <th>Matched Items</th>
            <th>Account Items</th>
          </tr>
        </thead>
        <tbody>
          {lineRows.map(({ budgetLine, items }) => {
            const matchedItems = items.filter((allocation) => allocation.budgetLineId === budgetLine.id);
            const matchedAmount = matchedItems.reduce((total, allocation) => total + Math.abs(allocationAmount(project, allocation)), 0);
            return (
              <tr key={budgetLine.id}>
                <td>
                  <strong>{compactFunctionCode(budgetLine.functionCode)} / {budgetLine.objectBucket}</strong>
                  <span className="muted block">{budgetLine.description}</span>
                </td>
                <td className="amount-cell">{currency(budgetLine.approvedAmount)}</td>
                <td>
                  <strong>{matchedItems.length}</strong>
                  <span className="muted block">{currency(matchedAmount)} selected</span>
                </td>
                <td>
                  <BudgetAccountMultiSelect
                    project={project}
                    budgetLine={budgetLine}
                    items={items}
                    onChange={onChange}
                  />
                </td>
              </tr>
            );
          })}
          {!lineRows.length && (
            <tr>
              <td colSpan={4}>No budget lines have account items under these filters.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function BudgetAccountMultiSelect({
  project,
  budgetLine,
  items,
  onChange,
}: {
  project: Project;
  budgetLine: BudgetLine;
  items: Allocation[];
  onChange: (allocation: Allocation) => void;
}) {
  const [query, setQuery] = useState("");
  const selectedCount = items.filter((allocation) => allocation.budgetLineId === budgetLine.id).length;
  const filteredItems = filterBudgetAccountItems(project, items, query);

  function toggleItem(allocation: Allocation, selected: boolean) {
    onChange({ ...allocation, budgetLineId: selected ? budgetLine.id : undefined, matchBasis: "manual" });
  }

  return (
    <details className="multi-select-dropdown">
      <summary>{selectedCount ? `${selectedCount} selected` : "Match account items"}</summary>
      <div className="multi-select-panel">
        <input
          type="search"
          placeholder="Search account items"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="multi-select-options">
          {filteredItems.map((allocation) => {
            const checked = allocation.budgetLineId === budgetLine.id;
            return (
              <label key={allocation.id} className={checked ? "selected-option" : undefined}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => toggleItem(allocation, event.target.checked)}
                />
                <span>
                  <strong>{reviewAccountItemLabel(project, allocation)}</strong>
                  <span className="muted block">{currency(allocationAmount(project, allocation))}</span>
                </span>
              </label>
            );
          })}
          {!filteredItems.length && <p className="empty-option">No matching account items.</p>}
        </div>
      </div>
    </details>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="review-summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

interface ReviewFilterOptions {
  functionCodes: string[];
  objectCodes: string[];
}

function ReviewQueueFilters({
  filters,
  options,
  rowCount,
  totalCount,
  onChange,
  onClear,
}: {
  filters: ReviewFilters;
  options: ReviewFilterOptions;
  rowCount: number;
  totalCount: number;
  onChange: (update: Partial<ReviewFilters>) => void;
  onClear: () => void;
}) {
  const hasFilters = Boolean(filters.functionCode || filters.objectCode || filters.status || filters.keyword);
  return (
    <section className="review-filters">
      <strong>{hasFilters ? `${rowCount} of ${totalCount}` : `${totalCount} items`}</strong>
      <select value={filters.functionCode} onChange={(event) => onChange({ functionCode: event.target.value })}>
        <option value="">All functions</option>
        {options.functionCodes.map((functionCode) => (
          <option key={functionCode} value={functionCode}>
            {functionCode}
          </option>
        ))}
      </select>
      <select value={filters.objectCode} onChange={(event) => onChange({ objectCode: event.target.value })}>
        <option value="">All objects</option>
        {options.objectCodes.map((objectCode) => (
          <option key={objectCode} value={objectCode}>
            {objectCode}
          </option>
        ))}
      </select>
      <select value={filters.status} onChange={(event) => onChange({ status: event.target.value as ReviewStatus | "" })}>
        <option value="">All decisions</option>
        {REVIEW_STATUSES.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      <input
        type="search"
        placeholder="Keyword"
        value={filters.keyword}
        onChange={(event) => onChange({ keyword: event.target.value })}
      />
      <button className="small-action" type="button" disabled={!hasFilters} onClick={onClear}>
        Clear
      </button>
    </section>
  );
}

function ReviewBulkEditor({
  project,
  budgetLines,
  selectedRows,
  onApply,
}: {
  project: Project;
  budgetLines: BudgetLine[];
  selectedRows: Allocation[];
  onApply: (allocations: Allocation[]) => void;
}) {
  const [budgetLineId, setBudgetLineId] = useState("__keep__");
  const [status, setStatus] = useState<ReviewStatus | "__keep__">("__keep__");
  const hasBudgetLineChange = budgetLineId !== "__keep__";
  const hasStatusChange = status !== "__keep__";
  const canApply = selectedRows.length > 0 && (hasBudgetLineChange || hasStatusChange);

  function applyBulkEdit() {
    if (!canApply) return;
    onApply(
      selectedRows.map((allocation) => {
        const amount = allocationAmount(project, allocation);
        let next = allocation;
        if (hasBudgetLineChange) {
          next = { ...next, budgetLineId: budgetLineId === "__none__" ? undefined : budgetLineId, matchBasis: "manual" };
        }
        if (hasStatusChange) {
          next = reviewedAllocation(next, amount, status);
        }
        return next;
      }),
    );
    setBudgetLineId("__keep__");
    setStatus("__keep__");
  }

  return (
    <section className="bulk-editor">
      <strong>{selectedRows.length} selected</strong>
      <select value={budgetLineId} onChange={(event) => setBudgetLineId(event.target.value)}>
        <option value="__keep__">Keep budget line</option>
        <option value="__none__">No budget line</option>
        {budgetLines.map((budgetLine) => (
          <option key={budgetLine.id} value={budgetLine.id}>
            {reviewBudgetLineLabel(budgetLine)}
          </option>
        ))}
      </select>
      <select value={status} onChange={(event) => setStatus(event.target.value as ReviewStatus | "__keep__")}>
        <option value="__keep__">Keep decision</option>
        {REVIEW_STATUSES.map((reviewStatus) => (
          <option key={reviewStatus} value={reviewStatus}>
            {reviewStatus}
          </option>
        ))}
      </select>
      <button className="small-action" type="button" disabled={!canApply} onClick={applyBulkEdit}>
        Apply
      </button>
    </section>
  );
}

function ReviewEditor({
  allocation,
  amount,
  onChange,
}: {
  allocation: Allocation;
  amount: number;
  onChange: (allocation: Allocation) => void;
}) {
  function setStatus(status: ReviewStatus) {
    onChange(reviewedAllocation(allocation, amount, status));
  }

  return (
    <div className="review-editor">
      <select value={allocation.status} onChange={(event) => setStatus(event.target.value as ReviewStatus)}>
        <option>Allowable</option>
        <option>Not Allowable</option>
        <option>Partially Allowable</option>
        <option>Review Required</option>
      </select>
      {allocation.status === "Partially Allowable" && (
        <input
          type="number"
          min="0"
          max={amount}
          step="0.01"
          value={allocation.allowableAmount}
          onChange={(event) => {
            const allowableAmount = Number(event.target.value) || 0;
            onChange({
              ...allocation,
              allowableAmount,
              nonAllowableAmount: Math.max(0, amount - allowableAmount),
              matchBasis: "manual",
            });
          }}
        />
      )}
      <textarea
        placeholder="Review note"
        value={allocation.reviewNote}
        onChange={(event) => onChange({ ...allocation, reviewNote: event.target.value, matchBasis: "manual" })}
      />
    </div>
  );
}

function allocationAmount(project: Project, allocation: Allocation) {
  const purchase = project.purchases.find((item) => item.id === allocation.purchaseId);
  const variance = project.controlVariances.find((item) => item.id === allocation.accountSummaryId);
  return purchase?.paymentAmount ?? variance?.varianceAmount ?? 0;
}

function reviewFilterOptions(project: Project, budgetLines: BudgetLine[], rows: Allocation[]): ReviewFilterOptions {
  const functionCodes = new Set<string>();
  const objectCodes = new Set<string>();
  for (const allocation of rows) {
    const context = allocationReviewContext(project, budgetLines, allocation);
    if (context.functionCode) functionCodes.add(context.functionCode);
    if (context.objectCode) objectCodes.add(context.objectCode);
  }
  return {
    functionCodes: uniqueSorted([...functionCodes]),
    objectCodes: uniqueSorted([...objectCodes]),
  };
}

function filterReviewRows(project: Project, budgetLines: BudgetLine[], rows: Allocation[], filters: ReviewFilters): Allocation[] {
  const keyword = filters.keyword.trim().toLowerCase();
  return rows.filter((allocation) => {
    const context = allocationReviewContext(project, budgetLines, allocation);
    if (filters.functionCode && context.functionCode !== filters.functionCode) return false;
    if (filters.objectCode && context.objectCode !== filters.objectCode) return false;
    if (filters.status && allocation.status !== filters.status) return false;
    return !keyword || context.keywordText.includes(keyword);
  });
}

export function reviewBudgetLineOptions(
  budgetLines: BudgetLine[],
  filters: Pick<ReviewFilters, "functionCode" | "objectCode">,
): BudgetLine[] {
  const objectBucket = filters.objectCode ? objectBucketFromCode(filters.objectCode) : "";
  return budgetLines.filter((line) => {
    if (filters.functionCode && line.functionCode !== filters.functionCode) return false;
    if (objectBucket && line.objectBucket !== objectBucket) return false;
    return true;
  });
}

export function reviewBudgetLineLabel(budgetLine: BudgetLine): string {
  return [
    compactFunctionCode(budgetLine.functionCode),
    budgetLine.objectBucket,
    currency(budgetLine.approvedAmount),
    budgetLine.description.slice(0, 70),
  ].join(" / ");
}

export function reviewItemsForBudgetLine(
  project: Project,
  budgetLines: BudgetLine[],
  rows: Allocation[],
  budgetLine: BudgetLine,
): Allocation[] {
  return rows.filter((allocation) => {
    if (allocation.budgetLineId === budgetLine.id) return true;
    const context = allocationReviewContext(project, budgetLines, allocation);
    return functionCodesMatch(budgetLine.functionCode, context.functionCode) && objectBucketFromCode(context.objectCode) === budgetLine.objectBucket;
  });
}

function filterBudgetAccountItems(project: Project, items: Allocation[], query: string): Allocation[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return items;
  return items.filter((allocation) => reviewAccountItemSearchText(project, allocation).includes(normalizedQuery));
}

function reviewAccountItemLabel(project: Project, allocation: Allocation): string {
  const purchase = project.purchases.find((item) => item.id === allocation.purchaseId);
  const variance = project.controlVariances.find((item) => item.id === allocation.accountSummaryId);
  if (purchase) return `${spendingName(purchase)} / ${purchase.accountNumber}`;
  return `${variance?.accountNumber ?? "Account variance"} / ${variance?.accountDescription ?? ""}`;
}

function reviewAccountItemSearchText(project: Project, allocation: Allocation): string {
  const purchase = project.purchases.find((item) => item.id === allocation.purchaseId);
  const variance = project.controlVariances.find((item) => item.id === allocation.accountSummaryId);
  return [
    reviewAccountItemLabel(project, allocation),
    purchase ? spendingReference(purchase) : "",
    purchase?.accountDescription,
    variance?.accountDescription,
    allocation.matchBasis,
    allocation.status,
    allocation.reviewNote,
    ...allocation.reasons,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function compactFunctionCode(functionCode: string): string {
  return functionCode.split(":")[0]?.trim() || functionCode;
}

function allocationReviewContext(project: Project, budgetLines: BudgetLine[], allocation: Allocation) {
  const purchase = project.purchases.find((item) => item.id === allocation.purchaseId);
  const variance = project.controlVariances.find((item) => item.id === allocation.accountSummaryId);
  const line = budgetLines.find((item) => item.id === allocation.budgetLineId);
  const functionCode = purchase?.functionCode ?? variance?.functionCode ?? line?.functionCode ?? "";
  const objectCode = purchase?.objectCode ?? variance?.objectCode ?? "";
  const keywordText = [
    purchase ? spendingName(purchase) : "",
    purchase?.accountNumber,
    purchase ? spendingReference(purchase) : "",
    purchase?.accountDescription,
    variance?.accountNumber,
    variance?.accountDescription,
    line?.description,
    allocation.status,
    allocation.matchBasis,
    allocation.reviewNote,
    ...allocation.reasons,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return { functionCode, objectCode, keywordText };
}

function reviewedAllocation(allocation: Allocation, amount: number, status: ReviewStatus): Allocation {
  const allowableAmount = status === "Allowable" ? amount : status === "Partially Allowable" ? allocation.allowableAmount : 0;
  const nonAllowableAmount =
    status === "Not Allowable" ? amount : status === "Partially Allowable" ? Math.max(0, amount - allowableAmount) : 0;
  return { ...allocation, status, allowableAmount, nonAllowableAmount, matchBasis: "manual" };
}

function BudgetLines({ rollups }: { rollups: ReturnType<typeof rollupBudgetLines> }) {
  const [filters, setFilters] = useState<BudgetLineFilters>({
    state: "",
    functionCode: "",
    object: "",
    needsReview: "",
    remaining: "",
    keyword: "",
  });
  const filterOptions = useMemo(() => budgetLineFilterOptions(rollups), [rollups]);
  const filteredRollups = useMemo(() => filterBudgetLineRows(rollups, filters), [rollups, filters]);

  function updateFilter(update: Partial<BudgetLineFilters>) {
    setFilters((current) => ({ ...current, ...update }));
  }

  return (
    <div className="screen">
      <ScreenHeader title="Budget Lines" subtitle="Compare each approved budget line to confirmed spending and items still needing review." />
      <BudgetLineFiltersToolbar
        filters={filters}
        options={filterOptions}
        rowCount={filteredRollups.length}
        totalCount={rollups.length}
        onChange={updateFilter}
        onClear={() =>
          setFilters({ state: "", functionCode: "", object: "", needsReview: "", remaining: "", keyword: "" })
        }
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>State</th>
              <th>Function</th>
              <th>Object</th>
              <th>Description</th>
              <th>Approved</th>
              <th>Confirmed Spending</th>
              <th>Needs Review</th>
              <th>Remaining</th>
            </tr>
          </thead>
          <tbody>
            {filteredRollups.map((row) => (
              <tr key={row.line.id}>
                <td><StatusPill status={simpleBudgetState(row.state)} /></td>
                <td>{row.line.functionCode}</td>
                <td>{row.line.objectBucket}</td>
                <td>{row.line.description}</td>
                <td>{currency(row.line.approvedAmount)}</td>
                <td>{currency(row.totalAgainstBudget)}</td>
                <td>{currency(row.currentReview)}</td>
                <td>{currency(row.remainingBeforeFlex)}</td>
              </tr>
            ))}
            {!filteredRollups.length && (
              <tr>
                <td colSpan={8}>No budget lines match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="footnote">* Means the line is over the approved amount but within 10%. Open advanced detail for the 10% ceiling and prior-year split.</p>
      <details className="advanced-panel">
        <summary>Advanced line detail</summary>
        <div className="table-wrap embedded">
          <table>
            <thead>
              <tr>
                <th>Function</th>
                <th>Object</th>
                <th>Description</th>
                <th>Prior Confirmed</th>
                <th>Current Confirmed</th>
                <th>All Confirmed</th>
                <th>10% Ceiling</th>
                <th>10% Margin Left</th>
                <th>Internal State</th>
              </tr>
            </thead>
            <tbody>
              {rollups.map((row) => (
                <tr key={row.line.id}>
                  <td>{row.line.functionCode}</td>
                  <td>{row.line.objectBucket}</td>
                  <td>{row.line.description}</td>
                  <td>{currency(row.priorCarryover)}</td>
                  <td>{currency(row.currentAllowable)}</td>
                  <td>{currency(row.totalAgainstBudget)}</td>
                  <td>{currency(row.flexCeiling)}</td>
                  <td>{currency(row.flexRemaining)}</td>
                  <td><StatusPill status={row.state} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

interface BudgetLineFilterOptions {
  states: string[];
  functionCodes: string[];
  objects: string[];
}

function BudgetLineFiltersToolbar({
  filters,
  options,
  rowCount,
  totalCount,
  onChange,
  onClear,
}: {
  filters: BudgetLineFilters;
  options: BudgetLineFilterOptions;
  rowCount: number;
  totalCount: number;
  onChange: (update: Partial<BudgetLineFilters>) => void;
  onClear: () => void;
}) {
  const hasFilters = Boolean(
    filters.state || filters.functionCode || filters.object || filters.needsReview || filters.remaining || filters.keyword,
  );
  return (
    <section className="budget-line-filters">
      <strong>{hasFilters ? `${rowCount} of ${totalCount}` : `${totalCount} lines`}</strong>
      <select value={filters.state} onChange={(event) => onChange({ state: event.target.value })}>
        <option value="">All states</option>
        {options.states.map((state) => (
          <option key={state} value={state}>
            {simpleBudgetState(state)}
          </option>
        ))}
      </select>
      <select value={filters.functionCode} onChange={(event) => onChange({ functionCode: event.target.value })}>
        <option value="">All functions</option>
        {options.functionCodes.map((functionCode) => (
          <option key={functionCode} value={functionCode}>
            {functionCode}
          </option>
        ))}
      </select>
      <select value={filters.object} onChange={(event) => onChange({ object: event.target.value })}>
        <option value="">All objects</option>
        {options.objects.map((object) => (
          <option key={object} value={object}>
            {object}
          </option>
        ))}
      </select>
      <select value={filters.needsReview} onChange={(event) => onChange({ needsReview: event.target.value as BudgetLineFilters["needsReview"] })}>
        <option value="">Any review amount</option>
        <option value="has-review">Has review</option>
        <option value="no-review">No review</option>
      </select>
      <select value={filters.remaining} onChange={(event) => onChange({ remaining: event.target.value as BudgetLineFilters["remaining"] })}>
        <option value="">Any remaining</option>
        <option value="available">Remaining available</option>
        <option value="none">No remaining</option>
        <option value="over-budget">Over budget</option>
      </select>
      <input
        type="search"
        placeholder="Keyword"
        value={filters.keyword}
        onChange={(event) => onChange({ keyword: event.target.value })}
      />
      <button className="small-action" type="button" disabled={!hasFilters} onClick={onClear}>
        Clear
      </button>
    </section>
  );
}

function budgetLineFilterOptions(rollups: ReturnType<typeof rollupBudgetLines>): BudgetLineFilterOptions {
  return {
    states: uniqueSorted([...new Set(rollups.map((row) => row.state))]),
    functionCodes: uniqueSorted([...new Set(rollups.map((row) => row.line.functionCode))]),
    objects: uniqueSorted([...new Set(rollups.map((row) => row.line.objectBucket))]),
  };
}

function filterBudgetLineRows(rollups: ReturnType<typeof rollupBudgetLines>, filters: BudgetLineFilters) {
  const keyword = filters.keyword.trim().toLowerCase();
  return rollups.filter((row) => {
    if (filters.state && row.state !== filters.state) return false;
    if (filters.functionCode && row.line.functionCode !== filters.functionCode) return false;
    if (filters.object && row.line.objectBucket !== filters.object) return false;
    if (filters.needsReview === "has-review" && row.currentReview <= 0.01) return false;
    if (filters.needsReview === "no-review" && row.currentReview > 0.01) return false;
    if (filters.remaining === "available" && row.remainingBeforeFlex <= 0.01) return false;
    if (filters.remaining === "none" && Math.abs(row.remainingBeforeFlex) > 0.01) return false;
    if (filters.remaining === "over-budget" && row.remainingBeforeFlex >= -0.01) return false;
    return !keyword || budgetLineKeywordText(row).includes(keyword);
  });
}

function budgetLineKeywordText(row: ReturnType<typeof rollupBudgetLines>[number]) {
  return [
    row.state,
    simpleBudgetState(row.state),
    row.line.functionCode,
    row.line.objectBucket,
    row.line.description,
    row.line.entity,
    row.line.columnLabel,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function Accounts({
  project,
  sourceVariances,
  onFunctionCodeMappingChange,
}: {
  project: Project;
  sourceVariances: BudgetAccountVariance[];
  onFunctionCodeMappingChange: (sourceFunctionCode: string, targetFunctionCode: string) => void;
}) {
  const functionCodeMappings = project.functionCodeMappings ?? {};
  const budgetFunctionCodes = uniqueSorted(activeBudgetLines(project).map((line) => line.functionCode));
  const accountFunctionRows = accountFunctionSummaries(project.accounts, functionCodeMappings);
  const accountSummary = budgetAccountSummary(activeBudgetLines(project), project.accounts, functionCodeMappings);
  return (
    <div className="screen">
      <ScreenHeader title="Accounts" subtitle="Obligated amount is YTD Actual + YTD Encum + Req Reserve." />
      <section className="panel">
        <div className="panel-heading">
          <h3>Function Code Remapping</h3>
          <span className="muted">Use when account files use a different function code than the approved budget.</span>
        </div>
        <div className="carryover-metrics">
          <Metric label="Approved budget" value={currency(accountSummary.approvedTotal)} />
          <Metric label="Loaded account budget" value={currency(accountSummary.accountBudgetTotal)} />
          <Metric label="Net difference" value={signedCurrency(accountSummary.netDifference)} />
          <Metric label="Setup mismatches" value={currency(accountSummary.absoluteMismatchTotal)} />
          <Metric label="Active remaps" value={String(Object.keys(functionCodeMappings).length)} />
        </div>
        <div className="table-wrap embedded remap-table">
          <table>
            <thead>
              <tr>
                <th>Account FC</th>
                <th>Account Budget</th>
                <th>Compare As</th>
                <th>Accounts</th>
              </tr>
            </thead>
            <tbody>
              {accountFunctionRows.map((row) => (
                <tr key={row.functionCode}>
                  <td>{row.functionCode}</td>
                  <td>{currency(row.accountBudget)}</td>
                  <td>
                    <select
                      value={functionCodeMappings[row.functionCode] ?? ""}
                      onChange={(event) => onFunctionCodeMappingChange(row.functionCode, event.target.value)}
                    >
                      <option value="">Use {row.functionCode}</option>
                      {budgetFunctionCodes.map((functionCode) => (
                        <option key={functionCode} value={functionCode}>
                          {functionCode}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h3>Budget vs Accounts Gaps</h3>
          <span className="muted">Approved budget compared to loaded account budgets by mapped function and object.</span>
        </div>
        <div className="table-wrap embedded">
          <table>
            <thead>
              <tr>
                <th>Issue</th>
                <th>Function</th>
                <th>Object</th>
                <th>Approved Budget</th>
                <th>Account Budget</th>
                <th>Difference</th>
                <th>Likely Budget Line</th>
              </tr>
            </thead>
            <tbody>
              {sourceVariances.length ? (
                sourceVariances.map((variance) => (
                  <tr key={variance.id}>
                    <td><StatusPill status={variance.type} /></td>
                    <td>{variance.functionCode}</td>
                    <td>{variance.objectBucket}</td>
                    <td>{currency(variance.approvedAmount)}</td>
                    <td>{currency(variance.accountBudgetAmount)}</td>
                    <td>{currency(variance.differenceAmount)}</td>
                    <td>
                      {variance.likelyBudgetLines[0] ? (
                        <>
                          <strong>Budget row {variance.likelyBudgetLines[0].sourceRow}</strong>
                          <span className="muted block">{variance.likelyBudgetLines[0].description}</span>
                          <span className="muted block">
                            Line amount {currency(variance.likelyBudgetLines[0].approvedAmount)}
                          </span>
                        </>
                      ) : (
                        variance.note
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>No budget/account setup gaps found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Description</th>
              <th>Compare FC</th>
              <th>Budget</th>
              <th>Actual</th>
              <th>Encum</th>
              <th>Reserved</th>
              <th>Obligated</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {project.accounts.map((account) => (
              <tr key={account.id}>
                <td>{account.accountNumber}</td>
                <td>{account.description}</td>
                <td>{mappedFunctionCode(account.functionCode, functionCodeMappings)}</td>
                <td>{currency(account.ytdBudget)}</td>
                <td>{currency(account.ytdActual)}</td>
                <td>{currency(account.ytdEncum)}</td>
                <td>{currency(account.reqReserve)}</td>
                <td>{currency(account.obligated)}</td>
                <td>{currency(account.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Breakdown({ project, mode }: { project: Project; mode: "function" | "object" }) {
  const rows = useMemo(() => {
    const map = new Map<string, { payments: number; allowable: number; review: number; approved: number }>();
    const budgetLines = activeBudgetLines(project);
    for (const line of budgetLines) {
      const key = mode === "function" ? line.functionCode : line.objectBucket;
      const row = map.get(key) ?? { payments: 0, allowable: 0, review: 0, approved: 0 };
      row.approved += line.approvedAmount;
      map.set(key, row);
    }
    for (const purchase of project.purchases) {
      const key = mode === "function" ? purchase.functionCode : purchase.objectBucket;
      const allocation = project.allocations.find((item) => item.purchaseId === purchase.id);
      const row = map.get(key) ?? { payments: 0, allowable: 0, review: 0, approved: 0 };
      row.payments += purchase.paymentAmount;
      row.allowable += allocation?.allowableAmount ?? 0;
      if (allocation?.status === "Review Required") row.review += purchase.paymentAmount;
      map.set(key, row);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [mode, project]);

  return (
    <div className="screen">
      <ScreenHeader title={mode === "function" ? "Function View" : "Object View"} subtitle="Breakdown of budget and spending." />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{mode === "function" ? "Function" : "Object"}</th>
              <th>Approved</th>
              <th>Current Spending</th>
              <th>Confirmed Spending</th>
              <th>Needs Review</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, row]) => (
              <tr key={key}>
                <td>{key}</td>
                <td>{currency(row.approved)}</td>
                <td>{currency(row.payments)}</td>
                <td>{currency(row.allowable)}</td>
                <td>{currency(row.review)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Carryover({
  project,
  rollups,
  totals,
  onImport,
}: {
  project: Project;
  rollups: ReturnType<typeof rollupBudgetLines>;
  totals: ReturnType<typeof projectTotals>;
  onImport: (file?: File) => void;
}) {
  const carryoverRows = rollups.filter((row) => row.priorCarryover > 0.01);
  return (
    <div className="screen">
      <ScreenHeader title="Carryover" subtitle="Import prior-year projects when the same approved budget continues across fiscal years." />
      <section className="panel">
        <div className="panel-heading">
          <h3>Carryover Summary</h3>
        </div>
        <p className="plain-note in-panel">
          Imported prior-year confirmed spending is included in Confirmed Spending and Budget Remaining when it maps
          to this budget. If the prior project still has unresolved review items, the carryover total may be incomplete.
        </p>
        <div className="carryover-metrics">
          <Metric label="Approved budget" value={currency(totals.approved)} />
          <Metric label="Imported prior spending" value={currency(totals.carryover)} />
          <Metric label="Current confirmed spending" value={currency(totals.allowable)} />
          <Metric label="All confirmed spending" value={currency(totals.grantToDate)} />
          <Metric label="Budget remaining" value={currency(totals.remainingBeforeFlex)} />
        </div>
      </section>
      <label className="file-drop compact">
        <span>Import prior .recon project</span>
        <input type="file" accept=".recon" onChange={(event) => onImport(event.target.files?.[0])} />
      </label>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Prior Project</th>
              <th>Fiscal Year</th>
              <th>Mapped Amount</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {project.carryovers.map((carryover) => (
              <tr key={carryover.id}>
                <td>{carryover.projectName}</td>
                <td>{carryover.fiscalYear}</td>
                <td>{currency(Object.values(carryover.allowableByBudgetLine).reduce((sum, value) => sum + value, 0))}</td>
                <td>{carryover.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="advanced-panel">
        <summary>Advanced carryover detail</summary>
        <section className="panel">
        <div className="panel-heading">
          <h3>Carryover By Budget Line</h3>
          <span className="muted">Prior-year confirmed spending mapped onto this year&apos;s active budget.</span>
        </div>
        <div className="table-wrap embedded">
          <table>
            <thead>
              <tr>
                <th>Function</th>
                <th>Object</th>
                <th>Budget Line</th>
                <th>Approved</th>
                <th>Prior Confirmed</th>
                <th>Current Confirmed</th>
                <th>All Confirmed</th>
                <th>Remaining</th>
              </tr>
            </thead>
            <tbody>
              {carryoverRows.length ? (
                carryoverRows.map((row) => (
                  <tr key={row.line.id}>
                    <td>{row.line.functionCode}</td>
                    <td>{row.line.objectBucket}</td>
                    <td>{row.line.description}</td>
                    <td>{currency(row.line.approvedAmount)}</td>
                    <td>{currency(row.priorCarryover)}</td>
                    <td>{currency(row.currentAllowable)}</td>
                    <td>{currency(row.totalAgainstBudget)}</td>
                    <td>{currency(row.remainingBeforeFlex)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8}>No carryover has been mapped to active budget lines yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </section>
      </details>
    </div>
  );
}

function ExportView({ project, onSave, onExport }: { project: Project; onSave: () => void; onExport: () => void }) {
  return (
    <div className="screen">
      <ScreenHeader title="Export" subtitle="Save the working project or download a reconciliation workbook." />
      <div className="export-actions">
        <button className="primary" onClick={onSave}>Save .recon Project</button>
        <button className="secondary" onClick={onExport}>Download Excel Workbook</button>
      </div>
      <section className="panel">
        <h3>Export includes</h3>
        <p>
          Summary, budget-line reconciliation, spending allocations, account/function/object breakdowns, review log,
          carryover detail, source checks, and account-control variances for {project.fiscalYear}.
        </p>
      </section>
    </div>
  );
}

function ScreenHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="screen-header">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </header>
  );
}

function Kpi({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "warn" | "bad" }) {
  return (
    <div className={`kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function signedCurrency(value: number): string {
  if (Math.abs(value) < 0.01) return currency(0);
  return `${value > 0 ? "+" : "-"}${currency(Math.abs(value))}`;
}

function StatusPill({ status }: { status: string }) {
  const className = status.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
  return <span className={`pill ${className}`}>{status}</span>;
}

function simpleBudgetState(state: string): string {
  if (state === "Flex Used") return "Within 10%*";
  return state;
}

function priority(allocation: Allocation): number {
  if (allocation.matchBasis === "none") return 5;
  if (allocation.matchBasis === "account-control-variance") return 4;
  if (allocation.matchBasis === "function-object") return 3;
  if (allocation.status === "Review Required") return 2;
  return 1;
}

function accountFunctionSummaries(accounts: AccountSummary[], functionCodeMappings: Record<string, string>) {
  const rows = new Map<string, { functionCode: string; mappedFunctionCode: string; accountBudget: number; count: number }>();
  for (const account of accounts) {
    const row = rows.get(account.functionCode) ?? {
      functionCode: account.functionCode,
      mappedFunctionCode: mappedFunctionCode(account.functionCode, functionCodeMappings),
      accountBudget: 0,
      count: 0,
    };
    row.mappedFunctionCode = mappedFunctionCode(account.functionCode, functionCodeMappings);
    row.accountBudget += account.ytdBudget;
    row.count += 1;
    rows.set(account.functionCode, row);
  }
  return [...rows.values()].sort((a, b) => a.functionCode.localeCompare(b.functionCode, undefined, { numeric: true }));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function tabIcon(tab: Tab): string {
  const icons: Record<Tab, string> = {
    Dashboard: "D",
    "Review Queue": "R",
    Spending: "S",
    "Budget Lines": "B",
    Accounts: "A",
    Functions: "F",
    Objects: "O",
    Carryover: "C",
    Export: "E",
  };
  return icons[tab];
}
