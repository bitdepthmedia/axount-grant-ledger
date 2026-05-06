import JSZip from "jszip";
import { makeId } from "./ids";
import { createAllocations, createControlVariances, createVarianceAllocations } from "./matching";
import type { Allocation, AuditEvent, Project, WorkbookImportResult } from "./types";

export function createProject(input: {
  grantName: string;
  grantCode: string;
  fiscalYear: string;
  fiscalYearStart: string;
  fiscalYearEnd: string;
  budgetVersionLabel: string;
  imports: WorkbookImportResult;
}): Project {
  const now = new Date().toISOString();
  const baseAllocations = createAllocations(input.imports.purchases, input.imports.budgetVersion.lines);
  const controlVariances = createControlVariances(input.imports.accounts, input.imports.purchases);
  const allocations = [...baseAllocations, ...createVarianceAllocations(controlVariances)];
  return {
    schemaVersion: 1,
    id: makeId("project"),
    grantName: input.grantName,
    grantCode: input.grantCode,
    fiscalYear: input.fiscalYear,
    fiscalYearStart: input.fiscalYearStart,
    fiscalYearEnd: input.fiscalYearEnd,
    budgetVersionLabel: input.budgetVersionLabel,
    createdAt: now,
    updatedAt: now,
    sourceFiles: input.imports.sourceFiles,
    budgetVersions: [input.imports.budgetVersion],
    activeBudgetVersionId: input.imports.budgetVersion.id,
    accounts: input.imports.accounts,
    purchases: input.imports.purchases,
    allocations,
    carryovers: [],
    controlVariances,
    auditLog: [audit("Project created", "Imported budget, account, and invoice workbooks.")],
  };
}

export function activeBudgetLines(project: Project) {
  return project.budgetVersions.find((budget) => budget.id === project.activeBudgetVersionId)?.lines ?? [];
}

export function updateAllocation(project: Project, allocation: Allocation): Project {
  return {
    ...project,
    updatedAt: new Date().toISOString(),
    allocations: project.allocations.map((existing) => (existing.id === allocation.id ? allocation : existing)),
    auditLog: [
      audit(
        "Review decision updated",
        `${allocation.status}${allocation.budgetLineId ? ` on ${allocation.budgetLineId}` : ""}`,
      ),
      ...project.auditLog,
    ],
  };
}

export async function saveProjectBundle(project: Project): Promise<Blob> {
  const zip = new JSZip();
  zip.file("project.json", JSON.stringify(project, null, 2));
  const sources = zip.folder("sources");
  for (const source of project.sourceFiles) {
    if (source.bytesBase64) sources?.file(source.name, source.bytesBase64, { base64: true });
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export async function loadProjectBundle(file: File): Promise<Project> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const json = await zip.file("project.json")?.async("string");
  if (!json) throw new Error("Project bundle is missing project.json.");
  const project = JSON.parse(json) as Project;
  if (project.schemaVersion !== 1) throw new Error(`Unsupported project schema version ${project.schemaVersion}.`);
  return project;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function audit(action: string, details: string): AuditEvent {
  return {
    id: makeId("audit"),
    at: new Date().toISOString(),
    action,
    details,
  };
}

export function projectFileName(project: Project): string {
  const safe = `${project.grantCode || project.grantName}-${project.fiscalYear}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${safe || "grant-ledger-project"}.recon`;
}
