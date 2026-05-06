import ExcelJS from "exceljs";
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { accountParts, objectBucketFromBudgetColumn, objectBucketFromCode } from "./codes";
import { stableId } from "./ids";
import { parseMoney } from "./money";
import type { AccountSummary, BudgetLine, BudgetVersion, Purchase, SourceFileSnapshot, WorkbookImportResult } from "./types";

const BUDGET_AMOUNT_COLUMNS = [
  "Salaries 1000",
  "Benefits 2000",
  "Purchased Services 3000, 4000",
  "Supplies 5000",
  "Capital Outlay 6000",
  "Other Expenses 7000, 8000",
];

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
  invoicesFile: File;
  budgetVersionLabel: string;
}): Promise<WorkbookImportResult> {
  const [budgetBuffer, accountsBuffer, invoicesBuffer] = await Promise.all([
    input.budgetFile.arrayBuffer(),
    input.accountsFile.arrayBuffer(),
    input.invoicesFile.arrayBuffer(),
  ]);

  const [budgetWorkbook, accountsWorkbook, invoicesWorkbook, sourceFiles] = await Promise.all([
    parseBudgetBuffer(budgetBuffer, input.budgetFile.name, input.budgetVersionLabel),
    workbookFromBuffer(accountsBuffer),
    workbookFromBuffer(invoicesBuffer),
    Promise.all([
      fileToSourceSnapshot(input.budgetFile, "budget"),
      fileToSourceSnapshot(input.accountsFile, "accounts"),
      fileToSourceSnapshot(input.invoicesFile, "invoices"),
    ]),
  ]);

  return {
    budgetVersion: budgetWorkbook,
    accounts: parseAccountsWorkbook(accountsWorkbook),
    purchases: parseInvoiceWorkbook(invoicesWorkbook),
    sourceFiles,
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
  const headers = headerMap(sheet.getRow(1));
  const rows: AccountSummary[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const accountNumber = cellText(row.getCell(headers.Account));
    if (!isAccountNumber(accountNumber)) return;
    const parts = accountParts(accountNumber);
    const ytdBudget = parseMoney(row.getCell(headers["YTD Budget"]).value);
    const ytdActual = parseMoney(row.getCell(headers["YTD Actual"]).value);
    const ytdEncum = parseMoney(row.getCell(headers["YTD Encum"]).value);
    const reqReserve = parseMoney(row.getCell(headers["Req Reserve"]).value);

    rows.push({
      id: stableId("account", [accountNumber]),
      accountNumber,
      description: cellText(row.getCell(headers.Description)),
      functionCode: parts.functionCode,
      objectCode: parts.objectCode,
      objectBucket: objectBucketFromCode(parts.objectCode),
      ytdBudget,
      ytdActual,
      ytdEncum,
      reqReserve,
      obligated: ytdActual + ytdEncum + reqReserve,
      balance: parseMoney(row.getCell(headers.Balance).value),
    });
  });

  return rows;
}

export function parseInvoiceWorkbook(workbook: ExcelJS.Workbook): Purchase[] {
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Invoice workbook has no worksheets.");
  const headers = headerMap(sheet.getRow(1));
  const rows: Purchase[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const accountNumber = cellText(row.getCell(headers["Display Account"]));
    if (!isAccountNumber(accountNumber)) return;
    const parts = accountParts(accountNumber);
    const functionCode = cellText(row.getCell(headers.Function)) || parts.functionCode;
    const objectCode = cellText(row.getCell(headers.Object)) || parts.objectCode;
    const poNumber = cellText(row.getCell(headers["PO #"]));
    const requisitionNumber = cellText(row.getCell(headers["Req #"]));

    rows.push({
      id: stableId("purchase", [rowNumber, poNumber || requisitionNumber || accountNumber]),
      poNumber,
      accountNumber,
      accountDescription: cellText(row.getCell(headers["Acct Desc"])),
      date: dateText(row.getCell(headers.Date).value),
      vendorCode: cellText(row.getCell(headers.Vendor)),
      vendorName: cellText(row.getCell(headers.Name)),
      revAmount: parseMoney(row.getCell(headers["Rev Amount"]).value),
      paymentAmount: parseMoney(row.getCell(headers.Payments).value),
      inProcessAmount: parseMoney(row.getCell(headers["In-Process"]).value),
      status: cellText(row.getCell(headers.Status)),
      requisitionNumber,
      functionCode,
      objectCode,
      objectBucket: objectBucketFromCode(objectCode),
    });
  });

  return rows;
}

function headerMap(row: ExcelJS.Row): Record<string, number> {
  const map: Record<string, number> = {};
  row.eachCell((cell, colNumber) => {
    const label = cellText(cell);
    if (label) map[label] = colNumber;
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

function dateText(value: ExcelJS.CellValue): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "").slice(0, 10);
}

function isAccountNumber(value: string): boolean {
  return /^\d{2}-\d{3}-\d{4}-/.test(value);
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
