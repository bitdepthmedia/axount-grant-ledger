import { useEffect, useMemo, useRef, useState } from "react";
import axountLogo from "../img/axount_logo-bw-400w.png";
import { clearLatestDraft, draftSummary, loadLatestDraft, saveLatestDraft, type DraftSummary } from "./lib/draftStore";
import { exportFileName, exportReconciliationWorkbook, projectTotals } from "./lib/exportWorkbook";
import { rollupBudgetLines } from "./lib/matching";
import { currency } from "./lib/money";
import { parseAllWorkbooks } from "./lib/parser";
import {
  activeBudgetLines,
  audit,
  createProject,
  downloadBlob,
  loadProjectBundle,
  projectFileName,
  saveProjectBundle,
  updateAllocation,
} from "./lib/project";
import { budgetAccountVariances, type BudgetAccountVariance } from "./lib/sourceChecks";
import { normalizeText } from "./lib/text";
import type { Allocation, BudgetLine, CarryoverSource, Project, ReviewStatus } from "./lib/types";

const tabs = ["Dashboard", "Review Queue", "Purchases", "Budget Lines", "Accounts", "Functions", "Objects", "Carryover", "Export"];

type Tab = (typeof tabs)[number];
const SIDEBAR_COLLAPSED_KEY = "axount-grant-ledger-sidebar-collapsed";

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
  const autosaveTimer = useRef<number | null>(null);
  const [setup, setSetup] = useState({
    grantName: "35a5 Grant",
    grantCode: "35a5",
    budgetVersionLabel: "Original budget",
    ...defaultFiscalYear(),
  });
  const [files, setFiles] = useState<{ budget?: File; accounts?: File; invoices?: File }>({});

  const budgetLines = useMemo(() => (project ? activeBudgetLines(project) : []), [project]);
  const totals = useMemo(() => (project ? projectTotals(project) : null), [project]);
  const rollups = useMemo(
    () => (project ? rollupBudgetLines(budgetLines, project.allocations, project.carryovers) : []),
    [budgetLines, project],
  );
  const sourceVariances = useMemo(
    () => (project ? budgetAccountVariances(budgetLines, project.accounts) : []),
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
    if (!files.budget || !files.accounts || !files.invoices) {
      setMessage("Choose the budget, account, and invoice workbooks first.");
      return;
    }
    setBusy(true);
    setMessage("Importing workbooks...");
    try {
      const imports = await parseAllWorkbooks({
        budgetFile: files.budget,
        accountsFile: files.accounts,
        invoicesFile: files.invoices,
        budgetVersionLabel: setup.budgetVersionLabel,
      });
      const created = createProject({ ...setup, imports });
      setProject(created);
      setTab("Dashboard");
      setMessage("Project imported and autosaved locally. Use Save Project to download a portable .recon file.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  async function openProject(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const loaded = await loadProjectBundle(file);
      setProject(loaded);
      setTab("Dashboard");
      setMessage("Project reopened and autosaved locally.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Project open failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProject() {
    if (!project) return;
    const blob = await saveProjectBundle(project);
    downloadBlob(blob, projectFileName(project));
    setMessage("Portable .recon project file downloaded. Local autosave is also active.");
  }

  async function exportWorkbook() {
    if (!project) return;
    const blob = await exportReconciliationWorkbook(project);
    downloadBlob(blob, exportFileName(project));
    setMessage("Excel reconciliation workbook downloaded.");
  }

  function applyAllocation(allocation: Allocation) {
    if (!project) return;
    setProject(updateAllocation(project, allocation));
  }

  function resumeDraft() {
    if (!draft) return;
    setProject(draft);
    setTab("Dashboard");
    setMessage("Autosaved local draft resumed. Use Save Project to download a portable .recon file.");
  }

  async function discardDraft() {
    await clearLatestDraft();
    setDraft(null);
    setDraftStatus("Autosaved draft cleared.");
  }

  async function importCarryover(file?: File) {
    if (!file || !project) return;
    const prior = await loadProjectBundle(file);
    const currentLines = activeBudgetLines(project);
    const mapped: Record<string, number> = {};
    let unmatched = 0;
    for (const allocation of prior.allocations) {
      if (allocation.allowableAmount <= 0 || !allocation.budgetLineId) continue;
      const oldLine = activeBudgetLines(prior).find((line) => line.id === allocation.budgetLineId);
      const currentLine = oldLine ? findCarryoverLine(oldLine, currentLines) : undefined;
      if (currentLine) mapped[currentLine.id] = (mapped[currentLine.id] ?? 0) + allocation.allowableAmount;
      else unmatched += allocation.allowableAmount;
    }
    const carryover: CarryoverSource = {
      id: `carryover-${Date.now()}`,
      projectName: prior.grantName,
      fiscalYear: prior.fiscalYear,
      importedAt: new Date().toISOString(),
      allowableByBudgetLine: mapped,
      notes: unmatched
        ? `${currency(unmatched)} could not be mapped to the active budget version and should be reviewed.`
        : "Mapped by matching function, object bucket, and budget description.",
    };
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
        <div className="brand">
          <div className="mark">
            <img src={axountLogo} alt="" />
          </div>
          <div className="brand-copy">
            <h1>aXount: Grant Ledger</h1>
            <p>Local grant reconciliation</p>
          </div>
        </div>
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
                  title={item}
                  onClick={() => setTab(item)}
                >
                  <span className="nav-icon">{tabIcon(item)}</span>
                  <span className="nav-label">{item}</span>
                </button>
              ))}
            </nav>
            <button className="secondary" onClick={saveProject}>
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
            onResumeDraft={resumeDraft}
            onDiscardDraft={discardDraft}
            draft={draft ? draftSummary(draft) : null}
            draftStatus={draftStatus}
            busy={busy}
          />
        ) : (
          <>
            <SaveNotice draftStatus={draftStatus} onSave={saveProject} />
            {tab === "Dashboard" && (
              <Dashboard
                project={project}
                totals={totals!}
                rollups={rollups}
                sourceVariances={sourceVariances}
                onOpenTab={setTab}
              />
            )}
            {tab === "Review Queue" && (
              <ReviewQueue project={project} budgetLines={budgetLines} onChange={applyAllocation} />
            )}
            {tab === "Purchases" && <Purchases project={project} budgetLines={budgetLines} onChange={applyAllocation} />}
            {tab === "Budget Lines" && <BudgetLines rollups={rollups} />}
            {tab === "Accounts" && <Accounts project={project} sourceVariances={sourceVariances} />}
            {tab === "Functions" && <Breakdown project={project} mode="function" />}
            {tab === "Objects" && <Breakdown project={project} mode="object" />}
            {tab === "Carryover" && <Carryover project={project} onImport={importCarryover} />}
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
  files: { budget?: File; accounts?: File; invoices?: File };
  setFiles: (files: { budget?: File; accounts?: File; invoices?: File }) => void;
  onImport: () => void;
  onOpen: (file?: File) => void;
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
          Import the approved budget, account totals, and invoice detail. Grant Ledger matches purchases to budget
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
          <FileInput label="Approved budget" file={files.budget} onFile={(budget) => setFiles({ ...files, budget })} />
          <FileInput label="Account summary" file={files.accounts} onFile={(accounts) => setFiles({ ...files, accounts })} />
          <FileInput label="Invoice detail" file={files.invoices} onFile={(invoices) => setFiles({ ...files, invoices })} />
        </div>
        <button className="primary" disabled={busy} onClick={onImport}>
          {busy ? "Importing..." : "Import and Match"}
        </button>
      </section>
    </div>
  );
}

function SaveNotice({ draftStatus, onSave }: { draftStatus: string; onSave: () => void }) {
  return (
    <div className="save-notice">
      <div>
        <strong>Autosave is local to this browser.</strong>
        <span>
          {draftStatus} Download a `.recon` file when you need a portable project backup or want to move it to
          another computer.
        </span>
      </div>
      <button className="primary" onClick={onSave}>
        Save Project File
      </button>
    </div>
  );
}

function FileInput({ label, file, onFile }: { label: string; file?: File; onFile: (file?: File) => void }) {
  return (
    <label className="file-drop">
      <span>{label}</span>
      <strong>{file?.name ?? "Choose .xlsx file"}</strong>
      <input type="file" accept=".xlsx" onChange={(event) => onFile(event.target.files?.[0])} />
    </label>
  );
}

function Dashboard({
  project,
  totals,
  rollups,
  sourceVariances,
  onOpenTab,
}: {
  project: Project;
  totals: ReturnType<typeof projectTotals>;
  rollups: ReturnType<typeof rollupBudgetLines>;
  sourceVariances: BudgetAccountVariance[];
  onOpenTab: (tab: Tab) => void;
}) {
  const overBudget = rollups.filter((row) => row.state === "Over Budget");
  const flexUsed = rollups.filter((row) => row.state === "Flex Used");
  const reviewItems = project.allocations
    .filter((allocation) => allocation.status === "Review Required" || allocation.matchBasis !== "specific-budget-line")
    .sort((a, b) => priority(b) - priority(a));
  const budgetAttention = [...overBudget, ...flexUsed].slice(0, 6);
  return (
    <div className="screen">
      <ScreenHeader title="Dashboard" subtitle={`${project.grantName} / ${project.fiscalYear}`} />
      <div className="kpi-grid">
        <Kpi label="Approved Budget" value={currency(totals.approved)} />
        <Kpi label="Invoice Payments" value={currency(totals.payments)} />
        <Kpi label="Allowable" value={currency(totals.allowable)} />
        <Kpi label="Needs Review" value={currency(totals.review)} tone="warn" />
        <Kpi label="Not Allowable" value={currency(totals.notAllowable)} tone="bad" />
        <Kpi label="Account Variance" value={currency(totals.variance)} tone={totals.variance ? "warn" : "good"} />
      </div>
      <div className="split">
        <section className="panel">
          <h3>Budget Flex Exposure</h3>
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
        <section className="panel">
          <div className="panel-heading">
            <h3>Attention Needed</h3>
            <button className="small-action" onClick={() => onOpenTab("Review Queue")}>Open Review Queue</button>
          </div>
          <div className="attention-actions">
            <button onClick={() => onOpenTab("Review Queue")}>
              <strong>{reviewItems.length}</strong>
              <span>items require purchase review</span>
            </button>
            <button onClick={() => onOpenTab("Budget Lines")}>
              <strong>{overBudget.length}</strong>
              <span>budget lines over 10% ceiling</span>
            </button>
            <button onClick={() => onOpenTab("Budget Lines")}>
              <strong>{flexUsed.length}</strong>
              <span>budget lines using flex</span>
            </button>
            <button onClick={() => onOpenTab("Accounts")}>
              <strong>{sourceVariances.length}</strong>
              <span>budget/account setup gaps</span>
            </button>
          </div>
        </section>
      </div>
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
  if (!rows.length) return <p className="muted">No review-required purchase items.</p>;
  return (
    <div className="compact-list">
      {rows.map((allocation) => {
        const purchase = project.purchases.find((item) => item.id === allocation.purchaseId);
        const variance = project.controlVariances.find((item) => item.id === allocation.accountSummaryId);
        const amount = purchase?.paymentAmount ?? variance?.varianceAmount ?? 0;
        return (
          <div className="compact-row" key={allocation.id}>
            <div>
              <strong>{purchase?.vendorName || variance?.accountNumber || "Review item"}</strong>
              <span>
                {purchase
                  ? `${purchase.functionCode} / ${purchase.objectCode} / PO ${purchase.poNumber}`
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
  if (!rows.length) return <p className="muted">No budget lines are over budget or using flexibility.</p>;
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
            <StatusPill status={row.state} />
            <strong>{currency(row.totalAgainstBudget)}</strong>
            <span>ceiling {currency(row.flexCeiling)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReviewQueue({ project, budgetLines, onChange }: ReviewProps) {
  const rows = project.allocations
    .filter((allocation) => allocation.status === "Review Required" || allocation.matchBasis !== "specific-budget-line")
    .sort((a, b) => priority(b) - priority(a));
  return (
    <AllocationTable
      title="Review Queue"
      rows={rows}
      project={project}
      budgetLines={budgetLines}
      onChange={onChange}
    />
  );
}

function Purchases({ project, budgetLines, onChange }: ReviewProps) {
  return <AllocationTable title="Purchases" rows={project.allocations.filter((row) => row.purchaseId)} project={project} budgetLines={budgetLines} onChange={onChange} />;
}

interface ReviewProps {
  project: Project;
  budgetLines: BudgetLine[];
  onChange: (allocation: Allocation) => void;
}

function AllocationTable({ title, rows, project, budgetLines, onChange }: ReviewProps & { title: string; rows: Allocation[] }) {
  return (
    <div className="screen">
      <ScreenHeader title={title} subtitle="Open every auto-match, weak match, and variance." />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Basis</th>
              <th>Purchase / Variance</th>
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
              const amount = purchase?.paymentAmount ?? variance?.varianceAmount ?? 0;
              return (
                <tr key={allocation.id}>
                  <td><StatusPill status={allocation.status} /></td>
                  <td>{allocation.matchBasis}</td>
                  <td>
                    <strong>{purchase?.vendorName || variance?.accountNumber}</strong>
                    <span className="muted block">
                      {purchase ? `${purchase.accountNumber} / PO ${purchase.poNumber}` : variance?.accountDescription}
                    </span>
                    <span className="muted block">{allocation.reasons.join(" ")}</span>
                  </td>
                  <td>{currency(amount)}</td>
                  <td>
                    <select
                      value={allocation.budgetLineId ?? ""}
                      onChange={(event) =>
                        onChange({ ...allocation, budgetLineId: event.target.value || undefined, matchBasis: "manual" })
                      }
                    >
                      <option value="">No budget line</option>
                      {budgetLines.map((budgetLine) => (
                        <option key={budgetLine.id} value={budgetLine.id}>
                          {budgetLine.functionCode} / {budgetLine.objectBucket} / {budgetLine.description.slice(0, 70)}
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
    </div>
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
    const allowableAmount =
      status === "Allowable" ? amount : status === "Partially Allowable" ? allocation.allowableAmount : 0;
    const nonAllowableAmount =
      status === "Not Allowable" ? amount : status === "Partially Allowable" ? Math.max(0, amount - allowableAmount) : 0;
    onChange({ ...allocation, status, allowableAmount, nonAllowableAmount, matchBasis: "manual" });
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

function BudgetLines({ rollups }: { rollups: ReturnType<typeof rollupBudgetLines> }) {
  return (
    <div className="screen">
      <ScreenHeader title="Budget Lines" subtitle="Approved budget is the source of truth for line ceilings." />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>State</th>
              <th>Function</th>
              <th>Object</th>
              <th>Description</th>
              <th>Approved</th>
              <th>10% Ceiling</th>
              <th>Against Budget</th>
              <th>Remaining</th>
            </tr>
          </thead>
          <tbody>
            {rollups.map((row) => (
              <tr key={row.line.id}>
                <td><StatusPill status={row.state} /></td>
                <td>{row.line.functionCode}</td>
                <td>{row.line.objectBucket}</td>
                <td>{row.line.description}</td>
                <td>{currency(row.line.approvedAmount)}</td>
                <td>{currency(row.flexCeiling)}</td>
                <td>{currency(row.totalAgainstBudget)}</td>
                <td>{currency(row.remainingBeforeFlex)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Accounts({ project, sourceVariances }: { project: Project; sourceVariances: BudgetAccountVariance[] }) {
  return (
    <div className="screen">
      <ScreenHeader title="Accounts" subtitle="Obligated amount is YTD Actual + YTD Encum + Req Reserve." />
      <section className="panel">
        <div className="panel-heading">
          <h3>Budget vs Accounts Gaps</h3>
          <span className="muted">Approved budget compared to loaded account budgets by function and object.</span>
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
              <th>Payments</th>
              <th>Allowable</th>
              <th>Review</th>
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

function Carryover({ project, onImport }: { project: Project; onImport: (file?: File) => void }) {
  return (
    <div className="screen">
      <ScreenHeader title="Carryover" subtitle="Bring prior fiscal-year allowable spending forward against the active budget." />
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
    </div>
  );
}

function ExportView({ project, onSave, onExport }: { project: Project; onSave: () => void; onExport: () => void }) {
  return (
    <div className="screen">
      <ScreenHeader title="Export" subtitle="Save the working project or download a reconciliation workbook." />
      <div className="export-actions">
        <button className="primary" onClick={onSave}>Download .recon Project</button>
        <button className="secondary" onClick={onExport}>Download Excel Workbook</button>
      </div>
      <section className="panel">
        <h3>Export includes</h3>
        <p>
          Summary, budget-line reconciliation, purchase allocations, account/function/object breakdowns, review log,
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

function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${status.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{status}</span>;
}

function priority(allocation: Allocation): number {
  if (allocation.matchBasis === "none") return 5;
  if (allocation.matchBasis === "account-control-variance") return 4;
  if (allocation.matchBasis === "function-object") return 3;
  if (allocation.status === "Review Required") return 2;
  return 1;
}

function findCarryoverLine(oldLine: BudgetLine, currentLines: BudgetLine[]): BudgetLine | undefined {
  return currentLines.find(
    (line) =>
      line.functionCode === oldLine.functionCode &&
      line.objectBucket === oldLine.objectBucket &&
      normalizeText(line.description) === normalizeText(oldLine.description),
  );
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
    Purchases: "P",
    "Budget Lines": "B",
    Accounts: "A",
    Functions: "F",
    Objects: "O",
    Carryover: "C",
    Export: "E",
  };
  return icons[tab];
}
