import ExcelJS from "exceljs";
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { accountParts, objectBucketFromBudgetColumn, objectBucketFromCode } from "./codes";
import { stableId } from "./ids";
import { parseMoney } from "./money";
import type { AccountSummary, BudgetLine, BudgetVersion, ObjectBucket, Purchase, SourceFileSnapshot, WorkbookImportResult } from "./types";

const BUDGET_AMOUNT_COLUMNS = [
  "Salaries 1000",
  "Benefits 2000",
  "Purchased Services 3000, 4000",
  "Supplies 5000",
  "Capital Outlay 6000",
  "Other Expenses 7000, 8000",
];

interface StaffGroup {
  firstRowNumber: number;
  employeeId: string;
  employeeName: string;
  accountNumber: string;
  accountDescription: string;
  firstDate: string;
  lastDate: string;
  functionCode: string;
  objectCode: string;
  objectBucket: ObjectBucket;
  paymentAmount: number;
  payItemCodes: Set<string>;
  sourceAccounts: Set<string>;
  sourceAccountAmounts: Map<string, number>;
}

export async function workbookFromBuffer(buffer: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

export async function parseBudgetBuffer(buffer: ArrayBuffer, sourceFileName: string, label: string): Promise<BudgetVersion> {
  try {
    return parseBudgetWorkbook(await workbookFromBuffer(buffer), sourceFileName, label);
  } catch {
    return parseBudgetRows(await simpleRowsFromXlsx(buffer), sourceFileName, label);
  }
}

export async function parseAccountsBuffer(buffer: ArrayBuffer): Promise<AccountSummary[]> {
  try {
    return parseAccountsWorkbook(await workbookFromBuffer(buffer));
  } catch {
    return parseAccountsRows(await simpleRowsFromXlsx(buffer));
  }
}

export async function parseInvoiceBuffer(buffer: ArrayBuffer): Promise<Purchase[]> {
  try {
    return parseInvoiceWorkbook(await workbookFromBuffer(buffer));
  } catch {
    return parseInvoiceRows(await simpleRowsFromXlsx(buffer));
  }
}

export async function parseStaffBuffer(buffer: ArrayBuffer): Promise<Purchase[]> {
  try {
    return parseStaffWorkbook(await workbookFromBuffer(buffer));
  } catch {
    return parseStaffRows(await simpleRowsFromXlsx(buffer));
  }
}

export async function fileToSourceSnapshot(file: File, role: SourceFileSnapshot["role"]): Promise<SourceFileSnapshot> {
  const bytesBase64 = await arrayBufferToBase64(await file.arrayBuffer());
  return {
    id: stableId("source", [role, file.name]),
    role,
    name: file.name,
    bytesBase64,
    importedAt: new Date().toISOString(),
  };
}

export async function parseAllWorkbooks(input: {
  budgetFile: File;
  accountsFile: File;
  invoicesFile?: File;
  staffFile?: File;
  budgetVersionLabel: string;
}): Promise<WorkbookImportResult> {
  const [budgetBuffer, accountsBuffer, invoicesBuffer, staffBuffer] = await Promise.all([
    input.budgetFile.arrayBuffer(),
    input.accountsFile.arrayBuffer(),
    input.invoicesFile?.arrayBuffer(),
    input.staffFile?.arrayBuffer(),
  ]);

  const [budgetWorkbook, accounts, invoices, staff, sourceFiles] = await Promise.all([
    parseBudgetBuffer(budgetBuffer, input.budgetFile.name, input.budgetVersionLabel),
    parseAccountsBuffer(accountsBuffer),
    invoicesBuffer ? parseInvoiceBuffer(invoicesBuffer) : [],
    staffBuffer ? parseStaffBuffer(staffBuffer) : [],
    Promise.all([
      fileToSourceSnapshot(input.budgetFile, "budget"),
      fileToSourceSnapshot(input.accountsFile, "accounts"),
      input.invoicesFile ? fileToSourceSnapshot(input.invoicesFile, "invoices") : undefined,
      input.staffFile ? fileToSourceSnapshot(input.staffFile, "staff") : undefined,
    ]),
  ]);

  return {
    budgetVersion: budgetWorkbook,
    accounts,
    purchases: [...invoices, ...staff],
    sourceFiles: sourceFiles.filter((sourceFile): sourceFile is SourceFileSnapshot => Boolean(sourceFile)),
  };
}

export function parseBudgetWorkbook(workbook: ExcelJS.Workbook, sourceFileName: string, label: string): BudgetVersion {
  const sheet = workbook.getWorksheet("Results") ?? workbook.worksheets[0];
  if (!sheet) throw new Error("Budget workbook has no worksheets.");
  const header = rowValues(sheet.getRow(1));
  const matrix = sheetToMatrix(sheet);
  return parseBudgetRows(matrix, sourceFileName, label, header);
}

function parseBudgetRows(rows: string[][], sourceFileName: string, label: string, providedHeader?: string[]): BudgetVersion {
  const header = providedHeader ?? rows[0] ?? [];
  const amountIndexes = BUDGET_AMOUNT_COLUMNS.map((columnLabel) => ({
    columnLabel,
    index: header.findIndex((value) => normalizeHeader(value) === normalizeHeader(columnLabel)),
  })).filter((column) => column.index > 0);

  const lines: BudgetLine[] = [];
  rows.forEach((row, rowIndex) => {
    if (rowIndex === 0) return;
    const rowNumber = rowIndex + 1;
    const functionCode = String(row[0] ?? "").trim();
    const description = String(row[1] ?? "").trim();
    if (!functionCode || !description || description.toLowerCase() === "sub-total") return;
    if (functionCode.includes("-")) return;

    for (const amountColumn of amountIndexes) {
      const approvedAmount = parseMoney(row[amountColumn.index]);
      if (Math.abs(approvedAmount) < 0.005) continue;
      lines.push({
        id: stableId("budget-line", [rowNumber, functionCode, amountColumn.columnLabel]),
        functionCode,
        objectBucket: objectBucketFromBudgetColumn(amountColumn.columnLabel),
        description,
        entity: String(row[2] ?? "").trim(),
        approvedAmount,
        sourceRow: rowNumber,
        columnLabel: amountColumn.columnLabel,
      });
    }
  });

  return {
    id: stableId("budget-version", [sourceFileName, label || "original"]),
    label: label || "Original budget",
    sourceFileName,
    importedAt: new Date().toISOString(),
    lines,
  };
}

function sheetToMatrix(sheet: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  sheet.eachRow((row, rowNumber) => {
    rows[rowNumber - 1] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      rows[rowNumber - 1][colNumber - 1] = cellText(cell);
    });
  });
  return rows;
}

export function parseAccountsWorkbook(workbook: ExcelJS.Workbook): AccountSummary[] {
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Account workbook has no worksheets.");
  return parseAccountsRows(sheetToMatrix(sheet));
}

function parseAccountsRows(matrix: string[][]): AccountSummary[] {
  const headers = headerMapValues(matrix[0] ?? []);
  const rows: AccountSummary[] = [];

  matrix.forEach((row, rowIndex) => {
    if (rowIndex === 0) return;
    const accountNumber = textAt(row, headers.Account);
    if (!isAccountNumber(accountNumber)) return;
    const parts = accountParts(accountNumber);
    const ytdBudget = parseMoney(textAt(row, headers["YTD Budget"]));
    const ytdActual = parseMoney(textAt(row, headers["YTD Actual"]));
    const ytdEncum = parseMoney(textAt(row, headers["YTD Encum"]));
    const reqReserve = parseMoney(textAt(row, headers["Req Reserve"]));

    rows.push({
      id: stableId("account", [accountNumber]),
      accountNumber,
      description: textAt(row, headers.Description),
      functionCode: parts.functionCode,
      objectCode: parts.objectCode,
      objectBucket: objectBucketFromCode(parts.objectCode),
      ytdBudget,
      ytdActual,
      ytdEncum,
      reqReserve,
      obligated: ytdActual + ytdEncum + reqReserve,
      balance: parseMoney(textAt(row, headers.Balance)),
    });
  });

  return rows;
}

export function parseInvoiceWorkbook(workbook: ExcelJS.Workbook): Purchase[] {
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Invoice workbook has no worksheets.");
  return parseInvoiceRows(sheetToMatrix(sheet));
}

function parseInvoiceRows(matrix: string[][]): Purchase[] {
  const headers = headerMapValues(matrix[0] ?? []);
  const rows: Purchase[] = [];

  matrix.forEach((row, rowIndex) => {
    if (rowIndex === 0) return;
    const rowNumber = rowIndex + 1;
    const accountNumber = textAt(row, headers["Display Account"]);
    if (!isAccountNumber(accountNumber)) return;
    const parts = accountParts(accountNumber);
    const functionCode = textAt(row, headers.Function) || parts.functionCode;
    const objectCode = textAt(row, headers.Object) || parts.objectCode;
    const poNumber = textAt(row, headers["PO #"]);
    const requisitionNumber = textAt(row, headers["Req #"]);

    rows.push({
      id: stableId("purchase", [rowNumber, poNumber || requisitionNumber || accountNumber]),
      sourceType: "invoice",
      poNumber,
      accountNumber,
      accountDescription: textAt(row, headers["Acct Desc"]),
      date: dateText(textAt(row, headers.Date)),
      vendorCode: textAt(row, headers.Vendor),
      vendorName: textAt(row, headers.Name),
      revAmount: parseMoney(textAt(row, headers["Rev Amount"])),
      paymentAmount: parseMoney(textAt(row, headers.Payments)),
      inProcessAmount: parseMoney(textAt(row, headers["In-Process"])),
      status: textAt(row, headers.Status),
      requisitionNumber,
      functionCode,
      objectCode,
      objectBucket: objectBucketFromCode(objectCode),
    });
  });

  return rows;
}

export function parseStaffWorkbook(workbook: ExcelJS.Workbook): Purchase[] {
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Staff workbook has no worksheets.");
  return parseStaffRows(sheetToMatrix(sheet));
}

function parseStaffRows(matrix: string[][]): Purchase[] {
  const headers = headerMapValues(matrix[0] ?? []);
  const groups = new Map<string, StaffGroup>();

  matrix.forEach((row, rowIndex) => {
    if (rowIndex === 0) return;
    const rowNumber = rowIndex + 1;
    const sourceAccountNumber = textAt(row, headers.Account);
    if (!isAccountNumber(sourceAccountNumber)) return;
    const parts = accountParts(sourceAccountNumber);
    const normalized = normalizedStaffAccount(sourceAccountNumber, parts.objectCode);
    const employeeId = textAt(row, headers["Emp #"]);
    const employeeName = textAt(row, headers.Employee).replace(/\s+/g, " ");
    const functionCode = parts.functionCode;
    const objectCode = normalized.objectCode;
    const key = [employeeId, normalized.accountNumber, functionCode, objectCode].join("::");
    const group = groups.get(key) ?? {
      firstRowNumber: rowNumber,
      employeeId,
      employeeName,
      accountNumber: normalized.accountNumber,
      accountDescription: normalized.isBenefits
        ? `Pooled benefits for ${employeeName || employeeId}`
        : textAt(row, headers.Description),
      firstDate: dateText(textAt(row, headers["Trans Date"])),
      lastDate: dateText(textAt(row, headers["Trans Date"])),
      functionCode,
      objectCode,
      objectBucket: objectBucketFromCode(objectCode),
      paymentAmount: 0,
      payItemCodes: new Set<string>(),
      sourceAccounts: new Set<string>(),
      sourceAccountAmounts: new Map<string, number>(),
    };
    const amount = parseMoney(textAt(row, headers.Amount));
    group.paymentAmount += amount;
    group.firstDate = minDateText(group.firstDate, dateText(textAt(row, headers["Trans Date"])));
    group.lastDate = maxDateText(group.lastDate, dateText(textAt(row, headers["Trans Date"])));
    const payItemCode = textAt(row, headers["Pay Item Code"]);
    if (payItemCode) group.payItemCodes.add(payItemCode);
    group.sourceAccounts.add(sourceAccountNumber);
    group.sourceAccountAmounts.set(sourceAccountNumber, (group.sourceAccountAmounts.get(sourceAccountNumber) ?? 0) + amount);
    groups.set(key, group);
  });

  return [...groups.values()]
    .map((group) => ({
      id: stableId("staff-purchase", [group.employeeId, group.accountNumber, group.functionCode, group.objectCode]),
      sourceType: "staff" as const,
      poNumber: "",
      accountNumber: group.accountNumber,
      sourceAccountAmounts: Object.fromEntries(group.sourceAccountAmounts),
      accountDescription:
        group.sourceAccounts.size > 1
          ? `${group.accountDescription} (${group.sourceAccounts.size} benefit accounts)`
          : group.accountDescription,
      date: group.firstDate === group.lastDate ? group.firstDate : `${group.firstDate} to ${group.lastDate}`,
      vendorCode: group.employeeId,
      vendorName: group.employeeName ? `${group.employeeName} (${group.employeeId})` : group.employeeId,
      employeeId: group.employeeId,
      employeeName: group.employeeName,
      revAmount: group.paymentAmount,
      paymentAmount: group.paymentAmount,
      inProcessAmount: 0,
      status: `Payroll${group.payItemCodes.size ? ` / ${[...group.payItemCodes].sort().join(", ")}` : ""}`,
      requisitionNumber: "",
      functionCode: group.functionCode,
      objectCode: group.objectCode,
      objectBucket: group.objectBucket,
    }))
    .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber) || a.vendorName.localeCompare(b.vendorName));
}

function headerMapValues(row: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  row.forEach((label, index) => {
    if (label) map[label] = index;
  });
  return map;
}

function rowValues(row: ExcelJS.Row): string[] {
  const values: string[] = [];
  row.eachCell((cell) => values.push(cellText(cell)));
  return values;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null) return "";
  if (typeof value === "object" && "text" in value) return String(value.text).trim();
  if (typeof value === "object" && "result" in value) return String(value.result ?? "").trim();
  return String(value).trim();
}

function textAt(row: string[], column: number | undefined): string {
  if (column == null || column < 0) return "";
  return String(row[column] ?? "").trim();
}

function dateText(value: ExcelJS.CellValue | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?$/.test(value))) {
    const serial = Number(value);
    if (serial > 20000 && serial < 80000) {
      const date = new Date(Date.UTC(1899, 11, 30) + serial * 24 * 60 * 60 * 1000);
      return date.toISOString().slice(0, 10);
    }
  }
  return String(value ?? "").slice(0, 10);
}

function isAccountNumber(value: string): boolean {
  return /^\d{2}-\d{3}-\d{4}-/.test(value);
}

function normalizedStaffAccount(accountNumber: string, objectCode: string): { accountNumber: string; objectCode: string; isBenefits: boolean } {
  if (!objectCode.startsWith("2")) return { accountNumber, objectCode, isBenefits: false };
  const parts = accountNumber.split("-");
  parts[2] = "2000";
  return { accountNumber: parts.join("-"), objectCode: "2000", isBenefits: true };
}

function minDateText(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  return left < right ? left : right;
}

function maxDateText(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

async function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function simpleRowsFromXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const zip = await JSZip.loadAsync(buffer);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
  });
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string");
  const sharedStrings = sharedXml ? parseSharedStrings(parser.parse(sharedXml)) : [];
  const sheetXml = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
  if (!sheetXml) throw new Error("Budget workbook is missing xl/worksheets/sheet1.xml.");
  const parsed = parser.parse(sheetXml);
  const sheetRows = asArray(parsed.worksheet?.sheetData?.row);
  const rows: string[][] = [];
  for (const row of sheetRows) {
    const rowIndex = Number(row.r ?? rows.length + 1) - 1;
    rows[rowIndex] = rows[rowIndex] ?? [];
    for (const cell of asArray(row.c)) {
      const colIndex = columnIndex(String(cell.r ?? "A1"));
      rows[rowIndex][colIndex] = cellValue(cell, sharedStrings);
    }
  }
  return rows;
}

function parseSharedStrings(parsed: unknown): string[] {
  const root = parsed as { sst?: { si?: unknown } };
  return asArray(root.sst?.si).map((item) => xmlText(item));
}

function cellValue(cell: { t?: string; v?: unknown; is?: unknown }, sharedStrings: string[]): string {
  if (cell.t === "s") return sharedStrings[Number(cell.v)] ?? "";
  if (cell.t === "inlineStr") return xmlText(cell.is);
  return xmlText(cell.v);
}

function xmlText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(xmlText).join("");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record["#text"] != null) return String(record["#text"]);
    if (record.t != null) return xmlText(record.t);
    if (record.r != null) return xmlText(record.r);
  }
  return "";
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function columnIndex(reference: string): number {
  const letters = reference.replace(/[^A-Z]/gi, "").toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}
