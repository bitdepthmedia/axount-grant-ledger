import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createControlVariances } from "./matching";
import {
  parseAccountsBuffer,
  parseAccountsWorkbook,
  parseBudgetWorkbook,
  parseInvoiceBuffer,
  parseInvoiceWorkbook,
  parseBudgetBuffer,
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

  it("parses approved budget lines from the custom budget upload CSV template", async () => {
    const csv = [
      "Func. Code,Description,FTE,Hours,Entity,Salaries - 1000,Benefits - 2000,Purchased Services - 3000/4000,Supplies & Materials -5000,Capital Outlay -6000,Other Expenses - 7000/8000,Total,Notes",
      "111,Literacy supplies,0,0,Synthetic District,0,0,0,1500,0,0,1500,",
      "125,Family literacy consultant,0,0,Synthetic District,0,0,5308,0,0,0,5308,",
      "225,Instructional coach,1,0,Synthetic District,2000,700,0,0,0,0,2700,",
    ].join("\n");

    const budget = await parseBudgetBuffer(textBuffer(csv), "custom-budget-upload-template.csv", "Template budget");

    expect(budget.lines).toHaveLength(4);
    expect(sum(budget.lines.map((line) => line.approvedAmount))).toBeCloseTo(9508, 2);
    expect(budget.lines.map((line) => line.objectBucket)).toEqual([
      "Supplies",
      "Purchased Services",
      "Salaries",
      "Benefits",
    ]);
    expect(budget.lines[0].entity).toBe("Synthetic District");
  });

  it("keeps amount-bearing budget rows with labeled function codes", async () => {
    const csv = [
      "Function Code,Description,Entity,FTE/Hours,Salaries 1000,Benefits 2000,\"Purchased Services 3000, 4000\",Supplies 5000,\"Capital Outlay 6000\",\"Other Expenses 7000, 8000\",Total",
      "370 - Support Services,,,,,,,,,,",
      "\"371: Non-Public School Pupils\",Private-school instructional supplies,Synthetic District,0 / 0,0,0,0,6312,0,0,6312",
      "\"371: Non-Public School Pupils\",Private-school contracted instruction,Synthetic District,0 / 0,0,0,400,0,0,0,400",
    ].join("\n");

    const budget = await parseBudgetBuffer(textBuffer(csv), "wide-371-budget.csv", "Wide budget");

    expect(budget.lines.filter((line) => line.functionCode === "371: Non-Public School Pupils")).toHaveLength(2);
    expect(budget.lines.map((line) => line.objectBucket)).toEqual(["Supplies", "Purchased Services"]);
    expect(sum(budget.lines.map((line) => line.approvedAmount))).toBeCloseTo(6712, 2);
  });

  it("parses approved budget rows from line-item CSV exports", async () => {
    const csv = [
      "Grant Name,Line Item Description,Object Code,Function Code,Program Code Override,Status,Account Number,Entities,Amount,Benefits,FTE,Hours",
      "Title I,Private-school instructional supplies,supplies,371,,ADD ITEM NOW,,district-office,6312,,0,0",
      "Title I,Private-school contracted instruction,purchased-services,371,,ADD ITEM NOW,,district-office,400,,0,0",
      "Title I,Private-school teacher,salaries,371,,ADD ITEM NOW,,district-office,9000,2200,1,0",
      "Title I,Private-school benefits,benefits,371,,ADD ITEM NOW,,district-office,0,100,0,0",
    ].join("\n");

    const budget = await parseBudgetBuffer(textBuffer(csv), "line-items-371-budget.csv", "Line items");

    expect(budget.lines).toHaveLength(5);
    expect(budget.lines.map((line) => [line.functionCode, line.objectBucket, line.approvedAmount])).toEqual([
      ["371", "Supplies", 6312],
      ["371", "Purchased Services", 400],
      ["371", "Salaries", 9000],
      ["371", "Benefits", 2200],
      ["371", "Benefits", 100],
    ]);
    expect(budget.lines[0].entity).toBe("district-office");
  });

  it("rejects unsupported approved budget CSVs instead of importing an empty budget", async () => {
    const csv = [
      "Function Code,Description,Amount",
      "371,Private-school instructional supplies,6312",
    ].join("\n");

    await expect(parseBudgetBuffer(textBuffer(csv), "unsupported-budget.csv", "Unsupported")).rejects.toThrow(
      /Unsupported approved budget format/,
    );
  });

  it("rejects line-item budget rows with amount-bearing unknown object categories", async () => {
    const csv = [
      "Grant Name,Line Item Description,Object Code,Function Code,Entities,Amount,Benefits,FTE,Hours",
      "Title I,Private-school instructional supplies,supplies,371,district-office,6312,,0,0",
      "Title I,Private-school unsupported item,unknown-category,371,district-office,400,,0,0",
    ].join("\n");

    await expect(parseBudgetBuffer(textBuffer(csv), "line-items-unknown-object.csv", "Line items")).rejects.toThrow(
      /Rejected 1 amount-bearing row/,
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

function textBuffer(value: string): ArrayBuffer {
  const buffer = new TextEncoder().encode(value).buffer;
  return buffer.slice(0);
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
