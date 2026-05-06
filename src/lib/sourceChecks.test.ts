import { describe, expect, it } from "vitest";
import { parseAccountsWorkbook, parseBudgetWorkbook } from "./parser";
import { budgetAccountVariances } from "./sourceChecks";
import { syntheticAccountsWorkbook, syntheticBudgetWorkbook } from "./testFixtures";

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
});
