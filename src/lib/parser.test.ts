import { describe, expect, it } from "vitest";
import { createControlVariances } from "./matching";
import { parseAccountsWorkbook, parseBudgetWorkbook, parseInvoiceWorkbook } from "./parser";
import { syntheticAccountsWorkbook, syntheticBudgetWorkbook, syntheticInvoicesWorkbook } from "./testFixtures";

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
