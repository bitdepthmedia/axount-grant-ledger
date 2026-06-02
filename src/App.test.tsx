import { describe, expect, it } from "vitest";
import { reviewBudgetLineLabel, reviewBudgetLineOptions } from "./App";
import type { BudgetLine } from "./lib/types";

describe("review budget line dropdown options", () => {
  it("compounds review queue function and object filters", () => {
    const lines: BudgetLine[] = [
      budgetLine("line-125-services", "125", "Purchased Services"),
      budgetLine("line-125-supplies", "125", "Supplies"),
      budgetLine("line-225-services", "225", "Purchased Services"),
    ];

    expect(optionIds(lines, { functionCode: "", objectCode: "3220" })).toEqual([
      "line-125-services",
      "line-225-services",
    ]);
    expect(optionIds(lines, { functionCode: "125", objectCode: "" })).toEqual([
      "line-125-services",
      "line-125-supplies",
    ]);
    expect(optionIds(lines, { functionCode: "125", objectCode: "3220" })).toEqual(["line-125-services"]);
  });

  it("shows compact function code and approved amount in budget line labels", () => {
    expect(
      reviewBudgetLineLabel({
        ...budgetLine("line-221-services", "221: Improvement of Instruction", "Purchased Services"),
        approvedAmount: 16000,
        description: "Sub for Vertical Alignment Training Equip subject area tchrs with the",
      }),
    ).toBe(
      "221 / Purchased Services / $16,000.00 / Sub for Vertical Alignment Training Equip subject area tchrs with the",
    );
  });
});

function optionIds(lines: BudgetLine[], filters: { functionCode: string; objectCode: string }) {
  return reviewBudgetLineOptions(lines, filters).map((line) => line.id);
}

function budgetLine(id: string, functionCode: string, objectBucket: BudgetLine["objectBucket"]): BudgetLine {
  return {
    id,
    functionCode,
    objectBucket,
    description: id,
    approvedAmount: 100,
    sourceRow: 1,
    columnLabel: objectBucket,
  };
}
