import { describe, expect, it } from "vitest";
import { parseAccountsWorkbook, parseBudgetWorkbook } from "./parser";
import { budgetAccountSummary, budgetAccountVariances } from "./sourceChecks";
import { syntheticAccountsWorkbook, syntheticBudgetWorkbook } from "./testFixtures";
import type { AccountSummary, BudgetLine } from "./types";

describe("source budget vs account checks", () => {
  it("pinpoints the missing account budget amount", () => {
    const budget = parseBudgetWorkbook(syntheticBudgetWorkbook(), "synthetic-approved-budget.xlsx", "Synthetic budget");
    const accounts = parseAccountsWorkbook(syntheticAccountsWorkbook());

    const variances = budgetAccountVariances(budget.lines, accounts);
    const missing225 = variances.find(
      (variance) => variance.functionCode === "225" && variance.objectBucket === "Supplies",
    );
    const objectMismatch111 = variances.find(
      (variance) => variance.functionCode === "111" && variance.objectBucket === "Supplies",
    );

    expect(missing225?.type).toBe("Missing In Accounts");
    expect(missing225?.differenceAmount).toBeCloseTo(2000, 2);
    expect(missing225?.likelyBudgetLines[0]?.sourceRow).toBe(11);
    expect(missing225?.likelyBudgetLines[0]?.description).toContain("i-pads");
    expect(objectMismatch111?.differenceAmount).toBeCloseTo(445, 2);
  });

  it("reports net account budget difference separately from absolute mismatches", () => {
    const budget = parseBudgetWorkbook(syntheticBudgetWorkbook(), "synthetic-approved-budget.xlsx", "Synthetic budget");
    const accounts = parseAccountsWorkbook(syntheticAccountsWorkbook());

    const summary = budgetAccountSummary(budget.lines, accounts);

    expect(summary.approvedTotal).toBeCloseTo(47739, 2);
    expect(summary.accountBudgetTotal).toBeCloseTo(45739, 2);
    expect(summary.netDifference).toBeCloseTo(-2000, 2);
    expect(summary.absoluteMismatchTotal).toBeGreaterThan(Math.abs(summary.netDifference));
  });

  it("uses account function code remaps when comparing loaded account budgets to approved budget", () => {
    const budgetLines: BudgetLine[] = [
      budgetLine("125", "Supplies", 1000),
    ];
    const accounts: AccountSummary[] = [
      account("11-119-5110-001-000-3660", 1000),
    ];

    expect(budgetAccountVariances(budgetLines, accounts)).toHaveLength(2);
    expect(budgetAccountVariances(budgetLines, accounts, { "119": "125" })).toHaveLength(0);
  });
});

function budgetLine(functionCode: string, objectBucket: BudgetLine["objectBucket"], approvedAmount: number): BudgetLine {
  return {
    id: `budget-${functionCode}-${objectBucket}`,
    functionCode,
    objectBucket,
    description: `${functionCode} ${objectBucket}`,
    approvedAmount,
    sourceRow: 2,
    columnLabel: objectBucket,
  };
}

function account(accountNumber: string, ytdBudget: number): AccountSummary {
  return {
    id: `account-${accountNumber}`,
    accountNumber,
    description: accountNumber,
    functionCode: accountNumber.split("-")[1] ?? "",
    objectCode: accountNumber.split("-")[2] ?? "",
    objectBucket: "Supplies",
    ytdBudget,
    ytdActual: 0,
    ytdEncum: 0,
    reqReserve: 0,
    obligated: 0,
    balance: ytdBudget,
  };
}
