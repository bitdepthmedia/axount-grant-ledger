import ExcelJS from "exceljs";
import { activeBudgetLines } from "./project";
import { rollupBudgetLines } from "./matching";
import { currency } from "./money";
import { budgetAccountSummary, budgetAccountVariances } from "./sourceChecks";
import type { Allocation, BudgetLine, Project, Purchase } from "./types";

const HEADERS = {
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9EEF5" } },
  font: { bold: true, color: { argb: "FF18202F" } },
} as const;

export async function exportReconciliationWorkbook(project: Project): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Reconsile";
  workbook.created = new Date();

  addSummarySheet(workbook, project);
  addBudgetLinesSheet(workbook, project);
  addSpendingSheet(workbook, project);
  addBreakdownSheet(workbook, "By Account", project, "account");
  addBreakdownSheet(workbook, "By Function", project, "function");
  addBreakdownSheet(workbook, "By Object", project, "object");
  addBudgetAccountGapsSheet(workbook, project);
  addReviewLogSheet(workbook, project);
  addCarryoverSheet(workbook, project);
  addChecksSheet(workbook, project);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function addSummarySheet(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Summary");
  const totals = projectTotals(project);
  sheet.addRows([
    ["Reconsile"],
    ["Grant", project.grantName],
    ["Grant code", project.grantCode],
    ["Fiscal year", project.fiscalYear],
    ["Budget version", project.budgetVersionLabel],
    [],
    ["Metric", "Amount"],
    ["Approved budget", totals.approved],
    ["Current-year spending", totals.payments],
    ["Imported prior confirmed spending", totals.carryover],
    ["Current confirmed spending", totals.allowable],
    ["All confirmed spending", totals.grantToDate],
    ["Review-required dollars", totals.review],
    ["Not allowable dollars", totals.notAllowable],
    ["Budget remaining", totals.remainingBeforeFlex],
    ["Account control variance", totals.variance],
  ]);
  styleSheet(sheet, [1, 7]);
  sheet.getColumn(1).width = 34;
  sheet.getColumn(2).width = 20;
  moneyColumn(sheet, 2);
}

function addBudgetLinesSheet(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Budget Lines");
  sheet.addRow([
    "Function",
    "Object bucket",
    "Description",
    "Approved",
    "Approved + 10% reference",
    "Prior confirmed spending",
    "Current confirmed spending",
    "Review required",
    "Not allowable",
    "All confirmed spending",
    "Budget remaining",
    "10% margin remaining",
    "State",
  ]);
  for (const row of rollupBudgetLines(activeBudgetLines(project), project.allocations, project.carryovers)) {
    sheet.addRow([
      row.line.functionCode,
      row.line.objectBucket,
      row.line.description,
      row.line.approvedAmount,
      row.flexCeiling,
      row.priorCarryover,
      row.currentAllowable,
      row.currentReview,
      row.currentNotAllowable,
      row.totalAgainstBudget,
      row.remainingBeforeFlex,
      row.flexRemaining,
      row.state,
    ]);
  }
  styleSheet(sheet, [1]);
  sheet.getColumn(3).width = 60;
  for (let col = 4; col <= 12; col++) moneyColumn(sheet, col);
}

function addSpendingSheet(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Spending");
  sheet.addRow([
    "Status",
    "Match basis",
    "Source",
    "Reference",
    "Date",
    "Vendor / Employee",
    "Account",
    "Function",
    "Object",
    "Rev Amount",
    "Payments",
    "Confirmed",
    "Not Allowable",
    "Matched budget description",
    "Review note",
  ]);
  for (const purchase of project.purchases) {
    const allocation = project.allocations.find((item) => item.purchaseId === purchase.id);
    const line = activeBudgetLines(project).find((budgetLine) => budgetLine.id === allocation?.budgetLineId);
    sheet.addRow([
      allocation?.status ?? "Review Required",
      allocation?.matchBasis ?? "none",
      spendingSource(purchase),
      spendingReference(purchase),
      purchase.date,
      spendingName(purchase),
      purchase.accountNumber,
      purchase.functionCode,
      purchase.objectCode,
      purchase.revAmount,
      purchase.paymentAmount,
      allocation?.allowableAmount ?? 0,
      allocation?.nonAllowableAmount ?? 0,
      line?.description ?? "",
      allocation?.reviewNote ?? "",
    ]);
  }
  styleSheet(sheet, [1]);
  sheet.getColumn(6).width = 32;
  sheet.getColumn(14).width = 60;
  sheet.getColumn(15).width = 42;
  for (let col = 10; col <= 13; col++) moneyColumn(sheet, col);
}

function addBreakdownSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  project: Project,
  mode: "account" | "function" | "object",
) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(["Group", "Approved budget", "Current spending", "Confirmed spending", "Review required", "Not allowable"]);
  const rows = new Map<string, { approved: number; payments: number; allowable: number; review: number; notAllowable: number }>();
  const budgetLines = activeBudgetLines(project);
  for (const line of budgetLines) {
    const key = groupKey(line, undefined, mode);
    getRow(rows, key).approved += line.approvedAmount;
  }
  for (const purchase of project.purchases) {
    const allocation = project.allocations.find((item) => item.purchaseId === purchase.id);
    const line = budgetLines.find((budgetLine) => budgetLine.id === allocation?.budgetLineId);
    const key = groupKey(line, purchase, mode);
    const row = getRow(rows, key);
    row.payments += purchase.paymentAmount;
    row.allowable += allocation?.allowableAmount ?? 0;
    if (allocation?.status === "Review Required") row.review += purchase.paymentAmount;
    row.notAllowable += allocation?.nonAllowableAmount ?? 0;
  }
  for (const [key, row] of [...rows.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    sheet.addRow([key, row.approved, row.payments, row.allowable, row.review, row.notAllowable]);
  }
  styleSheet(sheet, [1]);
  sheet.getColumn(1).width = 34;
  for (let col = 2; col <= 6; col++) moneyColumn(sheet, col);
}

function addReviewLogSheet(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Review Log");
  sheet.addRow(["When", "Action", "Details"]);
  for (const event of project.auditLog) sheet.addRow([event.at, event.action, event.details]);
  styleSheet(sheet, [1]);
  sheet.getColumn(1).width = 26;
  sheet.getColumn(2).width = 28;
  sheet.getColumn(3).width = 72;
}

function addBudgetAccountGapsSheet(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Budget vs Accounts");
  sheet.addRow([
    "Issue",
    "Function",
    "Object bucket",
    "Approved budget",
    "Account budget",
    "Difference",
    "Likely budget row",
    "Likely budget line",
    "Note",
  ]);
  for (const variance of budgetAccountVariances(activeBudgetLines(project), project.accounts, project.functionCodeMappings)) {
    const likely = variance.likelyBudgetLines[0];
    sheet.addRow([
      variance.type,
      variance.functionCode,
      variance.objectBucket,
      variance.approvedAmount,
      variance.accountBudgetAmount,
      variance.differenceAmount,
      likely?.sourceRow ?? "",
      likely?.description ?? "",
      variance.note,
    ]);
  }
  styleSheet(sheet, [1]);
  sheet.getColumn(8).width = 70;
  sheet.getColumn(9).width = 60;
  for (let col = 4; col <= 6; col++) moneyColumn(sheet, col);
}

function addCarryoverSheet(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Carryover");
  sheet.addRow(["Project", "Fiscal year", "Imported at", "Budget line id", "Confirmed amount", "Notes"]);
  for (const carryover of project.carryovers) {
    for (const [budgetLineId, amount] of Object.entries(carryover.allowableByBudgetLine)) {
      sheet.addRow([carryover.projectName, carryover.fiscalYear, carryover.importedAt, budgetLineId, amount, carryover.notes]);
    }
  }
  styleSheet(sheet, [1]);
  sheet.getColumn(1).width = 30;
  sheet.getColumn(6).width = 50;
  moneyColumn(sheet, 5);
}

function addChecksSheet(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Source Checks");
  const totals = projectTotals(project);
  const accountSummary = budgetAccountSummary(activeBudgetLines(project), project.accounts, project.functionCodeMappings);
  sheet.addRows([
    ["Check", "Value"],
    ["Approved budget source total", totals.approved],
    ["Account YTD budget total", accountSummary.accountBudgetTotal],
    ["Net account budget difference", accountSummary.netDifference],
    ["Account obligated total", project.accounts.reduce((total, account) => total + account.obligated, 0)],
    ["Current spending total", totals.payments],
    ["Account control variance total", totals.variance],
    ["Function/object setup mismatch total", accountSummary.absoluteMismatchTotal],
  ]);
  styleSheet(sheet, [1]);
  sheet.getColumn(1).width = 34;
  moneyColumn(sheet, 2);
}

export function projectTotals(project: Project) {
  const budgetLines = activeBudgetLines(project);
  return {
    approved: budgetLines.reduce((total, line) => total + line.approvedAmount, 0),
    payments: project.purchases.reduce((total, purchase) => total + purchase.paymentAmount, 0),
    allowable: project.allocations.reduce((total, allocation) => total + allocation.allowableAmount, 0),
    notAllowable: project.allocations.reduce((total, allocation) => total + allocation.nonAllowableAmount, 0),
    review: project.allocations.reduce((total, allocation) => {
      if (allocation.status !== "Review Required") return total;
      const purchase = project.purchases.find((item) => item.id === allocation.purchaseId);
      return total + (purchase?.paymentAmount ?? 0);
    }, 0),
    carryover: project.carryovers.reduce(
      (total, carryover) => total + Object.values(carryover.allowableByBudgetLine).reduce((sum, value) => sum + value, 0),
      0,
    ),
    variance: project.controlVariances.reduce((total, variance) => total + variance.varianceAmount, 0),
    grantToDate:
      project.allocations.reduce((total, allocation) => total + allocation.allowableAmount, 0) +
      project.carryovers.reduce(
        (total, carryover) => total + Object.values(carryover.allowableByBudgetLine).reduce((sum, value) => sum + value, 0),
        0,
      ),
    remainingBeforeFlex:
      budgetLines.reduce((total, line) => total + line.approvedAmount, 0) -
      project.allocations.reduce((total, allocation) => total + allocation.allowableAmount, 0) -
      project.carryovers.reduce(
        (total, carryover) => total + Object.values(carryover.allowableByBudgetLine).reduce((sum, value) => sum + value, 0),
        0,
      ),
  };
}

function groupKey(line: BudgetLine | undefined, purchase: Purchase | undefined, mode: "account" | "function" | "object") {
  if (mode === "account") return purchase?.accountNumber ?? `${line?.functionCode ?? "Unknown"} / ${line?.objectBucket ?? "Unknown"}`;
  if (mode === "function") return purchase?.functionCode ?? line?.functionCode ?? "Unknown";
  return purchase?.objectBucket ?? line?.objectBucket ?? "Unknown";
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

function getRow(
  rows: Map<string, { approved: number; payments: number; allowable: number; review: number; notAllowable: number }>,
  key: string,
) {
  if (!rows.has(key)) rows.set(key, { approved: 0, payments: 0, allowable: 0, review: 0, notAllowable: 0 });
  return rows.get(key)!;
}

function styleSheet(sheet: ExcelJS.Worksheet, headerRows: number[]) {
  for (const rowNumber of headerRows) {
    const row = sheet.getRow(rowNumber);
    row.font = HEADERS.font;
    row.eachCell((cell) => {
      cell.fill = HEADERS.fill;
      cell.border = { bottom: { style: "thin", color: { argb: "FFCAD3DF" } } };
    });
  }
  sheet.views = [{ state: "frozen", ySplit: Math.max(...headerRows) }];
  for (const column of sheet.columns) {
    column.alignment = { vertical: "top", wrapText: true };
  }
}

function moneyColumn(sheet: ExcelJS.Worksheet, columnNumber: number) {
  sheet.getColumn(columnNumber).numFmt = '"$"#,##0.00;[Red]\\-"$"#,##0.00';
  sheet.getColumn(columnNumber).width = 16;
}

export function exportFileName(project: Project): string {
  return `${project.grantCode || project.grantName}-${project.fiscalYear}-reconciliation.xlsx`
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-");
}

export { currency };
