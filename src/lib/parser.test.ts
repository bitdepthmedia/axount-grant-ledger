import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createControlVariances } from "./matching";
import {
  parseAccountsBuffer,
  parseAccountsWorkbook,
  parseBudgetWorkbook,
  parseInvoiceBuffer,
  parseInvoiceWorkbook,
  parseStaffBuffer,
  parseStaffWorkbook,
} from "./parser";
import { syntheticAccountsWorkbook, syntheticBudgetWorkbook, syntheticInvoicesWorkbook, syntheticStaffWorkbook } from "./testFixtures";

describe("source workbook parsers", () => {
  it("parses approved budget lines from the approved budget only", () => {
    const budget = parseBudgetWorkbook(syntheticBudgetWorkbook(), "synthetic-approved-budget.xlsx", "Synthetic budget");

    expect(sum(budget.lines.map((line) => line.approvedAmount))).toBeCloseTo(47739, 2);
    expect(sum(budget.lines.filter((line) => line.functionCode === "225").map((line) => line.approvedAmount))).toBeCloseTo(
      4786,
      2,
    );
  });

  it("parses account obligated spending and excludes count rows", () => {
    const accounts = parseAccountsWorkbook(syntheticAccountsWorkbook());

    expect(accounts).toHaveLength(6);
    expect(sum(accounts.map((account) => account.ytdBudget))).toBeCloseTo(45739, 2);
    expect(sum(accounts.map((account) => account.obligated))).toBeCloseTo(17164.96, 2);
    expect(accounts.find((account) => account.accountNumber === "11-111-3110-005-000-3660")?.objectBucket).toBe(
      "Purchased Services",
    );
  });

  it("parses invoice payments and excludes count rows", () => {
    const purchases = parseInvoiceWorkbook(syntheticInvoicesWorkbook());

    expect(purchases).toHaveLength(5);
    expect(sum(purchases.map((purchase) => purchase.paymentAmount))).toBeCloseTo(17164.96, 2);
    expect(sum(purchases.filter((purchase) => purchase.functionCode === "111").map((purchase) => purchase.paymentAmount))).toBeCloseTo(
      500,
      2,
    );
  });

  it("groups staff payroll by full account and employee, pooling benefits into one employee benefit row", () => {
    const staff = parseStaffWorkbook(syntheticStaffWorkbook());

    expect(staff).toHaveLength(2);
    expect(staff.map((purchase) => purchase.sourceType)).toEqual(["staff", "staff"]);
    expect(staff.map((purchase) => purchase.vendorName)).toEqual([
      "Ramsey, Michele D (102148)",
      "Ramsey, Michele D (102148)",
    ]);
    expect(staff.find((purchase) => purchase.objectBucket === "Salaries")?.paymentAmount).toBeCloseTo(1755, 2);
    expect(staff.find((purchase) => purchase.objectBucket === "Benefits")?.paymentAmount).toBeCloseTo(260.21, 2);
    expect(staff.find((purchase) => purchase.objectBucket === "Benefits")?.objectCode).toBe("2000");
    expect(staff.find((purchase) => purchase.objectBucket === "Benefits")?.sourceAccountAmounts).toEqual({
      "11-125-2820-001-000-2904": 211.85,
      "11-125-2830-001-000-2904": 48.36,
    });
  });

  it("falls back to direct xlsx rows when ExcelJS cannot load source metadata", async () => {
    const accounts = await parseAccountsBuffer(
      await simpleXlsx([
        ["Account", "Description", "Resp", "FC", "AC", "YTD Budget", "YTD Actual", "YTD Encum", "Req Reserve", "Balance"],
        ["11-125-1970-001-000-2904", "23G SMMR SCH TCHRS", "E00", "G", "E", 2500, 195, 0, 0, 2305],
      ]),
    );
    const invoices = await parseInvoiceBuffer(
      await simpleXlsx([
        [" ", "PO #", "Display Account", "Acct Desc", "Date", "Vendor", "Name", "Rev Amount", "Payments", "In-Process", "Balance", "Status", "Req Created By", "Req #", "Fund", "Class", "Function", "Object"],
        [1, "P1", "11-125-5110-004-000-2904", "23G SUPPLIES", 45919, "V1", "Vendor One", 159.4, 159.4, 0, 0, "Closed", "", "R1", "1", "1", "125", "5110"],
      ]),
    );
    const staff = await parseStaffBuffer(
      await simpleXlsx([
        ["Account", "Description", "Trans Date", "Emp #", "Employee", "Amount", "Pay Item Code", "Trans Master ID", "Trans #", "Plan ID", "Option Code"],
        ["11-125-1970-001-000-2904", "23G SMMR SCH TCHRS", 45841, "102148", "Ramsey, Michele D", 195, "0570", "268609", "", "", ""],
      ]),
    );

    expect(accounts).toHaveLength(1);
    expect(accounts[0].obligated).toBeCloseTo(195, 2);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].date).toBe("2025-09-19");
    expect(staff).toHaveLength(1);
    expect(staff[0].date).toBe("2025-07-03");
  });

  it("surfaces known account and budget mismatches", () => {
    const budget = parseBudgetWorkbook(syntheticBudgetWorkbook(), "synthetic-approved-budget.xlsx", "Synthetic budget");
    const accounts = parseAccountsWorkbook(syntheticAccountsWorkbook());
    const purchases = parseInvoiceWorkbook(syntheticInvoicesWorkbook());
    const variances = createControlVariances(accounts, purchases);

    expect(sum(budget.lines.map((line) => line.approvedAmount)) - sum(accounts.map((account) => account.ytdBudget))).toBeCloseTo(
      2000,
      2,
    );
    expect(
      accounts.some(
        (account) =>
          account.functionCode === "111" && account.objectBucket === "Purchased Services" && account.ytdBudget === 445,
      ),
    ).toBe(true);
    expect(variances).toHaveLength(0);
  });
});

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

async function simpleXlsx(rows: (string | number)[][]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const sharedStrings: string[] = [];
  const sharedIndex = new Map<string, number>();
  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const ref = `${columnName(columnIndex + 1)}${rowIndex + 1}`;
          if (typeof value === "number") return `<x:c r="${ref}" t="n"><x:v>${value}</x:v></x:c>`;
          const index = sharedIndex.get(value) ?? sharedStrings.length;
          if (!sharedIndex.has(value)) {
            sharedIndex.set(value, index);
            sharedStrings.push(value);
          }
          return `<x:c r="${ref}" t="s"><x:v>${index}</x:v></x:c>`;
        })
        .join("");
      return `<x:row r="${rowIndex + 1}">${cells}</x:row>`;
    })
    .join("");
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" /><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml" /><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" /></Types>`,
  );
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml" Id="rId1" /></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="utf-8"?><x:workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets><x:sheet name="Sheet1" sheetId="1" r:id="rId1" /></x:sheets></x:workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="rId1" /><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="/xl/sharedStrings.xml" Id="rId2" /></Relationships>`);
  zip.file("xl/sharedStrings.xml", `<?xml version="1.0" encoding="utf-8"?><x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">${sharedStrings.map((value) => `<x:si><x:t>${escapeXml(value)}</x:t></x:si>`).join("")}</x:sst>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${sheetRows}</x:sheetData></x:worksheet>`);
  return zip.generateAsync({ type: "arraybuffer" });
}

function columnName(column: number): string {
  let name = "";
  while (column > 0) {
    const remainder = (column - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    column = Math.floor((column - 1) / 26);
  }
  return name;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
