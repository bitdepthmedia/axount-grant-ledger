import { describe, expect, it } from "vitest";
import { createAllocations, rollupBudgetLines } from "./matching";
import type { BudgetLine, Purchase } from "./types";

const budgetLines: BudgetLine[] = [
  {
    id: "line-ipads",
    functionCode: "225",
    objectBucket: "Supplies",
    description: "Apple i-pads 9th generation on Amazon, Quantity 35",
    approvedAmount: 1000,
    sourceRow: 1,
    columnLabel: "Supplies 5000",
  },
  {
    id: "line-contract",
    functionCode: "125",
    objectBucket: "Purchased Services",
    description: "Author visit with Kelly DiPucchio",
    approvedAmount: 1500,
    sourceRow: 2,
    columnLabel: "Purchased Services 3000, 4000",
  },
  {
    id: "line-salary",
    functionCode: "125",
    objectBucket: "Salaries",
    description: "Summer school teachers",
    approvedAmount: 4000,
    sourceRow: 3,
    columnLabel: "Salaries 1000",
  },
];

function purchase(overrides: Partial<Purchase>): Purchase {
  return {
    id: "purchase-1",
    poNumber: "1",
    accountNumber: "11-225-5110-010-000-3660",
    accountDescription: "INSTR RELAT TECH SPPLY",
    date: "2025-05-01",
    vendorCode: "A3485",
    vendorName: "Amazon",
    revAmount: 900,
    paymentAmount: 900,
    inProcessAmount: 0,
    status: "Closed",
    requisitionNumber: "1",
    functionCode: "225",
    objectCode: "5110",
    objectBucket: "Supplies",
    ...overrides,
  };
}

describe("matching engine", () => {
  it("auto-matches a specific budget line when descriptive evidence exists", () => {
    const allocations = createAllocations([purchase({ vendorName: "Amazon" })], budgetLines);

    expect(allocations[0].status).toBe("Allowable");
    expect(allocations[0].matchBasis).toBe("specific-budget-line");
    expect(allocations[0].budgetLineId).toBe("line-ipads");
  });

  it("marks function/object-only matches for review", () => {
    const allocations = createAllocations([purchase({ vendorName: "Generic Tablet Seller" })], budgetLines);

    expect(allocations[0].status).toBe("Review Required");
    expect(allocations[0].matchBasis).toBe("function-object");
  });

  it("auto-matches staff payroll when a single budget line exists for the function and object bucket", () => {
    const allocations = createAllocations([
      purchase({
        sourceType: "staff",
        vendorName: "Ramsey, Michele D (102148)",
        accountNumber: "11-125-1970-001-000-2904",
        accountDescription: "23G SMMR SCH TCHRS",
        paymentAmount: 1755,
        functionCode: "125",
        objectCode: "1970",
        objectBucket: "Salaries",
      }),
    ], budgetLines);

    expect(allocations[0].status).toBe("Allowable");
    expect(allocations[0].matchBasis).toBe("specific-budget-line");
    expect(allocations[0].budgetLineId).toBe("line-salary");
  });

  it("marks missing function/object budgets for review", () => {
    const allocations = createAllocations([purchase({ functionCode: "999" })], budgetLines);

    expect(allocations[0].status).toBe("Review Required");
    expect(allocations[0].matchBasis).toBe("none");
    expect(allocations[0].nonAllowableAmount).toBe(900);
  });

  it("supports partial allowable decisions and overage rollups", () => {
    const allocations = [
      {
        ...createAllocations([purchase({ paymentAmount: 1200 })], budgetLines)[0],
        status: "Partially Allowable" as const,
        allowableAmount: 1050,
        nonAllowableAmount: 150,
      },
    ];
    const rollup = rollupBudgetLines(budgetLines, allocations, [])[0];

    expect(rollup.state).toBe("Flex Used");
    expect(rollup.flexCeiling).toBe(1100);
    expect(rollup.flexRemaining).toBe(50);
  });
});
