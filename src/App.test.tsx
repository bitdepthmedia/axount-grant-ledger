import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { reviewBudgetLineLabel, reviewBudgetLineOptions, reviewItemsForBudgetLine } from "./App";
import type { Allocation, BudgetLine, Project, Purchase } from "./lib/types";

describe("review budget line dropdown options", () => {
  it("renders budget line choices only for the open row picker", async () => {
    const app = (await import("./App")) as typeof import("./App") & {
      BudgetLinePicker?: ComponentType<{
        allocation: Allocation;
        budgetLines: BudgetLine[];
        currentLine?: BudgetLine;
        open: boolean;
        onChange: (allocation: Allocation) => void;
        onOpenChange: (open: boolean) => void;
      }>;
    };
    expect(app.BudgetLinePicker).toBeTypeOf("function");
    if (!app.BudgetLinePicker) throw new Error("BudgetLinePicker is unavailable");

    const lines = Array.from({ length: 100 }, (_, index) => budgetLine(`line-${index}`, "125", "Supplies"));
    const markup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        ...Array.from({ length: 50 }, (_, index) =>
          createElement(app.BudgetLinePicker!, {
            key: index,
            allocation: allocation(`allocation-${index}`, `purchase-${index}`),
            budgetLines: lines,
            open: index === 0,
            onChange: vi.fn(),
            onOpenChange: vi.fn(),
          }),
        ),
      ),
    );

    expect(markup.match(/<summary/g)).toHaveLength(50);
    expect(markup.match(/role="option"/g)).toHaveLength(101);
  });

  it("does not render budget account choices until their dropdown is opened", async () => {
    const app = (await import("./App")) as typeof import("./App") & {
      BudgetAccountMultiSelect?: ComponentType<{
        project: Project;
        budgetLine: BudgetLine;
        items: Allocation[];
        onChange: (allocation: Allocation) => void;
      }>;
    };
    expect(app.BudgetAccountMultiSelect).toBeTypeOf("function");
    if (!app.BudgetAccountMultiSelect) throw new Error("BudgetAccountMultiSelect is unavailable");

    const purchases = Array.from({ length: 100 }, (_, index) =>
      purchase(`purchase-${index}`, "125", "5110", "Supplies"),
    );
    const project = reviewProject(
      purchases,
      purchases.map((item, index) => allocation(`allocation-${index}`, item.id)),
    );
    const markup = renderToStaticMarkup(
      createElement(app.BudgetAccountMultiSelect, {
        project,
        budgetLine: budgetLine("line-125-supplies", "125", "Supplies"),
        items: project.allocations,
        onChange: vi.fn(),
      }),
    );

    expect(markup).toContain("Match account items");
    expect(markup).not.toContain('type="checkbox"');
  });

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

  it("scopes budget-first account item options to the budget line function and object bucket", () => {
    const line = budgetLine("line-221-services", "221: Improvement of Instruction", "Purchased Services");
    const project = reviewProject(
      [
        purchase("purchase-221-services", "221", "3220", "Purchased Services"),
        purchase("purchase-221-supplies", "221", "5110", "Supplies"),
        purchase("purchase-283-services", "283", "3220", "Purchased Services"),
      ],
      [
        allocation("allocation-221-services", "purchase-221-services"),
        allocation("allocation-221-supplies", "purchase-221-supplies"),
        allocation("allocation-283-services", "purchase-283-services"),
      ],
    );

    expect(reviewItemsForBudgetLine(project, [line], project.allocations, line).map((item) => item.id)).toEqual([
      "allocation-221-services",
    ]);
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

function purchase(id: string, functionCode: string, objectCode: string, objectBucket: Purchase["objectBucket"]): Purchase {
  return {
    id,
    sourceType: "invoice",
    poNumber: id,
    accountNumber: `21-${functionCode}-${objectCode}-001-145-7640`,
    accountDescription: id,
    date: "2026-01-01",
    vendorCode: id,
    vendorName: id,
    revAmount: 100,
    paymentAmount: 100,
    inProcessAmount: 0,
    status: "Paid",
    requisitionNumber: "",
    functionCode,
    objectCode,
    objectBucket,
  };
}

function allocation(id: string, purchaseId: string): Allocation {
  return {
    id,
    purchaseId,
    status: "Review Required",
    matchBasis: "function-object",
    confidence: 40,
    allowableAmount: 0,
    nonAllowableAmount: 0,
    reviewNote: "",
    candidateLineIds: [],
    reasons: [],
  };
}

function reviewProject(purchases: Purchase[], allocations: Allocation[]): Project {
  return {
    schemaVersion: 1,
    id: "project",
    grantName: "Grant",
    grantCode: "T2",
    fiscalYear: "FY26",
    fiscalYearStart: "2025-07-01",
    fiscalYearEnd: "2026-06-30",
    budgetVersionLabel: "Budget",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sourceFiles: [],
    budgetVersions: [],
    activeBudgetVersionId: "",
    accounts: [],
    purchases,
    allocations,
    carryovers: [],
    functionCodeMappings: {},
    controlVariances: [],
    auditLog: [],
  };
}
