import ExcelJS from "exceljs";
import { parseAccountsWorkbook, parseBudgetWorkbook, parseInvoiceWorkbook } from "./parser";
import type { WorkbookImportResult } from "./types";

export async function syntheticImports(): Promise<WorkbookImportResult> {
  const budgetWorkbook = syntheticBudgetWorkbook();
  const accountsWorkbook = syntheticAccountsWorkbook();
  const invoicesWorkbook = syntheticInvoicesWorkbook();

  return {
    budgetVersion: parseBudgetWorkbook(budgetWorkbook, "synthetic-approved-budget.xlsx", "Synthetic approved budget"),
    accounts: parseAccountsWorkbook(accountsWorkbook),
    purchases: parseInvoiceWorkbook(invoicesWorkbook),
    sourceFiles: [
      { id: "budget", role: "budget", name: "synthetic-approved-budget.xlsx", importedAt: new Date().toISOString() },
      { id: "accounts", role: "accounts", name: "synthetic-accounts.xlsx", importedAt: new Date().toISOString() },
      { id: "invoices", role: "invoices", name: "synthetic-invoices.xlsx", importedAt: new Date().toISOString() },
    ],
  };
}

export function syntheticBudgetWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Results");
  sheet.addRow([
    "Function Code",
    "Description",
    "Entity",
    "FTE/Hours",
    "Salaries 1000",
    "Benefits 2000",
    "Purchased Services 3000, 4000",
    "Supplies 5000",
    "Capital Outlay 6000",
    "Other Expenses 7000, 8000",
    "Total",
  ]);
  sheet.addRow(["110 - Basic Programs"]);
  sheet.addRow(["111", "Hameray oral language development materials - ECE", "Synthetic District", "0 / 0", 0, 0, 0, 475, 0, 0, 475]);
  sheet.addRow(["111", "Literacy night books and family engagement supplies - DE", "Synthetic District", "0 / 0", 0, 0, 0, 4000, 0, 0, 4000]);
  sheet.addRow(["111", "Learning Gizmos family night activity supplies - DE", "Synthetic District", "0 / 0", 0, 0, 0, 1500, 0, 0, 1500]);
  sheet.addRow(["111", "Books for library - HOL", "Synthetic District", "0 / 0", 0, 0, 0, 445, 0, 0, 445]);
  sheet.addRow(["120 - Added Needs"]);
  sheet.addRow(["125", "Author visits and family literacy programs", "Synthetic District", "0 / 0", 0, 0, 5308, 0, 0, 0, 5308]);
  sheet.addRow(["125", "Decodable texts, instructional supplies, and reading materials", "Synthetic District", "0 / 0", 0, 0, 0, 31225, 0, 0, 31225]);
  sheet.addRow(["225 - Instructional Staff"]);
  sheet.addRow(["225", "Apple i-pads 9th generation on Amazon, Quantity 10 at $199 each - Tau Beta K-5", "Synthetic District", "0 / 0", 0, 0, 0, 2000, 0, 0, 2000]);
  sheet.addRow(["225", "Apple i-pads 9th generation on Amazon, Quantity 14 at $199 each - DW", "Synthetic District", "0 / 0", 0, 0, 0, 2786, 0, 0, 2786]);
  return workbook;
}

export function syntheticAccountsWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow([
    "Account",
    "Description",
    "Resp",
    "FC",
    "AC",
    "YTD Budget",
    "YTD Actual",
    "YTD Encum",
    "Req Reserve",
    "Balance",
  ]);
  sheet.addRow(["11-111-3110-005-000-3660", "INST PUR SVC 35a5-HOL", "E00", "G", "E", 445, 0, 0, 0, 445]);
  sheet.addRow(["11-111-5110-004-000-3660", "INST MATERIALS 35a5-DE", "A00", "G", "E", 5500, 0, 0, 0, 5500]);
  sheet.addRow(["11-111-5110-017-000-3660", "INST MATERIALS 35a5-ECE", "P15", "G", "E", 475, 500, 0, 0, -25]);
  sheet.addRow(["11-125-3110-005-000-3660", "IMP OF INST PUR SVC 35a5-HB", "E00", "G", "E", 5308, 2676.7, 0, 0, 2631.3]);
  sheet.addRow(["11-125-5110-004-000-3660", "IMP OF INST MATERIALS 35a5-DE", "A00", "G", "E", 31225, 13988.26, 0, 0, 17236.74]);
  sheet.addRow(["11-225-5110-010-000-3660", "INSTR RELAT TECH SPPLY 35a5 DW", "C00", "G", "E", 2786, 0, 0, 0, 2786]);
  sheet.addRow(["Count: 6", "", "", "", "", 45739, 17164.96, 0, 0, 28574.04]);
  return workbook;
}

export function syntheticInvoicesWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow([
    " ",
    "PO #",
    "Display Account",
    "Acct Desc",
    "Date",
    "Vendor",
    "Name",
    "Rev Amount",
    "Payments",
    "In-Process",
    "Balance",
    "Status",
    "Req Created By",
    "Req #",
    "Fund",
    "Class",
    "Function",
    "Object",
  ]);
  sheet.addRow([1, "33577", "11-111-5110-017-000-3660", "INST MATERIALS 35a5-ECE", new Date("2025-04-28"), "H0270", "HAMERAY PUBLISHING GROUP", 500, 500, 0, 0, "Closed", "", "226317", "1", "1", "111", "5110"]);
  sheet.addRow([1, "33423", "11-125-3110-005-000-3660", "IMP OF INST PUR SVC 35a5-HB", new Date("2025-04-17"), "D2055", "KELLY DIPUCCHIO", 1500, 1500, 0, 0, "Closed", "", "225391", "1", "1", "125", "3110"]);
  sheet.addRow([1, "33422", "11-125-3110-005-000-3660", "IMP OF INST PUR SVC 35a5-HB", new Date("2025-04-17"), "K0452", "KATHRYN KLIMCZUK", 1176.7, 1176.7, 0, 0, "Closed", "", "225372", "1", "1", "125", "3110"]);
  sheet.addRow([1, "33402", "11-125-5110-004-000-3660", "IMP OF INST MATERIALS 35a5-DE", new Date("2025-04-15"), "L0840", "LEARNING GIZMOS", 1294, 1294, 0, 0, "Closed", "", "226110", "1", "1", "125", "5110"]);
  sheet.addRow([1, "33596", "11-125-5110-004-000-3660", "IMP OF INST MATERIALS 35a5-DE", new Date("2025-05-06"), "C1575", "CENTER FOR COLLABORATIVE CLASSROOM", 12694.26, 12694.26, 0, 0, "Closed", "", "226760", "1", "1", "125", "5110"]);
  sheet.addRow(["", "", "Count: 5", "", "", "", "", 17164.96, 17164.96, 0, 0]);
  return workbook;
}
