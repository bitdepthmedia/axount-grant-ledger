import { describe, expect, it } from "vitest";
import { createAllocations, createVarianceAllocations, rollupBudgetLines } from "./matching";
import type { BudgetLine, ControlVariance, Purchase } from "./types";

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

    expect(allocations[0].status).toBe("Review Required");
    expect(allocations[0].matchBasis).toBe("specific-budget-line");
    expect(allocations[0].budgetLineId).toBe("line-ipads");
    expect(allocations[0].allowableAmount).toBe(0);
  });

  it("marks function/object-only matches for review", () => {
    const allocations = createAllocations([purchase({ vendorName: "Generic Tablet Seller" })], budgetLines);

    expect(allocations[0].status).toBe("Review Required");
    expect(allocations[0].matchBasis).toBe("function-object");
    expect(allocations[0].budgetLineId).toBeUndefined();
  });

  it("does not match staff payroll solely because one budget line exists for the function and object bucket", () => {
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

    expect(allocations[0].status).toBe("Review Required");
    expect(allocations[0].matchBasis).toBe("function-object");
    expect(allocations[0].budgetLineId).toBeUndefined();
  });

  it("matches plain actual function codes to labeled budget function codes without review decisions", () => {
    const allocations = createAllocations(
      [
        purchase({
          functionCode: "125",
          objectCode: "3220",
          objectBucket: "Purchased Services",
          accountDescription: "Conference and workshops",
          vendorName: "Generic Conference",
        }),
      ],
      [
        {
          id: "line-labeled-function",
          functionCode: "125: Compensatory Education",
          objectBucket: "Purchased Services",
          description: "Conference and workshop registration",
          approvedAmount: 1200,
          sourceRow: 9,
          columnLabel: "Purchased Services 3000, 4000",
        },
      ],
    );

    expect(allocations[0].budgetLineId).toBe("line-labeled-function");
    expect(allocations[0].status).toBe("Review Required");
    expect(allocations[0].allowableAmount).toBe(0);
    expect(allocations[0].nonAllowableAmount).toBe(0);
  });

  it("marks missing function/object budgets for review", () => {
    const allocations = createAllocations([purchase({ functionCode: "999" })], budgetLines);

    expect(allocations[0].status).toBe("Review Required");
    expect(allocations[0].matchBasis).toBe("none");
    expect(allocations[0].nonAllowableAmount).toBe(0);
  });

  it("assigns account-control variance rows to labeled budget lines without review decisions", () => {
    const allocations = createVarianceAllocations(
      [
        {
          id: "variance-125-supplies",
          accountNumber: "11-125-5110-001-000-3070",
          accountDescription: "SUPPLIES ELL",
          obligatedAmount: 600,
          invoicePaymentAmount: 0,
          varianceAmount: 600,
          functionCode: "125",
          objectCode: "5110",
          objectBucket: "Supplies",
        } satisfies ControlVariance,
      ],
      [
        {
          id: "line-labeled-supplies",
          functionCode: "125: Compensatory Education",
          objectBucket: "Supplies",
          description: "Consumable supplies for EL rooms",
          approvedAmount: 1000,
          sourceRow: 35,
          columnLabel: "Supplies 5000",
        },
      ],
    );

    expect(allocations[0].budgetLineId).toBe("line-labeled-supplies");
    expect(allocations[0].status).toBe("Review Required");
    expect(allocations[0].allowableAmount).toBe(0);
    expect(allocations[0].nonAllowableAmount).toBe(0);
  });

  it("does not force generic payroll titles onto one of several similar salary budget lines", () => {
    const allocations = createAllocations(
      [
        purchase({
          sourceType: "staff",
          vendorName: "FARHAN, ELHAM (102242)",
          accountNumber: "11-125-1240-004-307-3070",
          accountDescription: "SAL ELL TEACHER DE",
          paymentAmount: 55062,
          functionCode: "125",
          objectCode: "1240",
          objectBucket: "Salaries",
        }),
      ],
      [
        {
          id: "line-ell-teacher-a",
          functionCode: "125: Compensatory Education",
          objectBucket: "Salaries",
          description: "ELL Teacher: support ELL students in Reading, Writing, Speaking and Listening",
          approvedAmount: 64170,
          sourceRow: 6,
          columnLabel: "Salaries 1000",
        },
        {
          id: "line-ell-teacher-b",
          functionCode: "125: Compensatory Education",
          objectBucket: "Salaries",
          description: "ELL Teacher: support ELL students in Reading, Writing, Speaking and Listening",
          approvedAmount: 77157,
          sourceRow: 7,
          columnLabel: "Salaries 1000",
        },
      ],
    );

    expect(allocations[0].matchBasis).toBe("function-object");
    expect(allocations[0].budgetLineId).toBeUndefined();
    expect(allocations[0].candidateLineIds).toEqual(["line-ell-teacher-a", "line-ell-teacher-b"]);
  });

  it("uses specific payroll account titles when one budget line has the same job title", () => {
    const allocations = createAllocations(
      [
        purchase({
          sourceType: "staff",
          vendorName: "ALAVI, AFRIN (101902)",
          accountNumber: "11-226-1160-001-307-3070",
          accountDescription: "MLD DIRECTOR",
          paymentAmount: 50815.42,
          functionCode: "226",
          objectCode: "1160",
          objectBucket: "Salaries",
        }),
      ],
      [
        {
          id: "line-building-coordinator",
          functionCode: "226: Supervision and Direction of Instructional Staff",
          objectBucket: "Salaries",
          description: "ML Building Coordinator Stipends",
          approvedAmount: 40000,
          sourceRow: 38,
          columnLabel: "Salaries 1000",
        },
        {
          id: "line-director",
          functionCode: "226: Supervision and Direction of Instructional Staff",
          objectBucket: "Salaries",
          description: "ELL Director: oversee and monitor the district Multilingual Learner program",
          approvedAmount: 67062,
          sourceRow: 59,
          columnLabel: "Salaries 1000",
        },
      ],
    );

    expect(allocations[0].matchBasis).toBe("specific-budget-line");
    expect(allocations[0].budgetLineId).toBe("line-director");
    expect(allocations[0].status).toBe("Review Required");
  });

  it("does not match a payroll specialist account to an instructional coach budget line by a weak token", () => {
    const allocations = createAllocations(
      [
        purchase({
          sourceType: "staff",
          vendorName: "SALEH, AFAF (100492)",
          accountNumber: "11-221-1250-001-307-3070",
          accountDescription: "SAL MLD SPECIALIST DIST WIDE",
          paymentAmount: 11344,
          functionCode: "221",
          objectCode: "1250",
          objectBucket: "Salaries",
        }),
      ],
      [
        {
          id: "line-instructional-coach",
          functionCode: "221: Improvement of Instruction",
          objectBucket: "Salaries",
          description: "(.5) ML Instructional Coach: remaining .5 FTE from 31a as MTSS Specialist",
          approvedAmount: 47500,
          sourceRow: 56,
          columnLabel: "Salaries 1000",
        },
      ],
    );

    expect(allocations[0].matchBasis).toBe("function-object");
    expect(allocations[0].budgetLineId).toBeUndefined();
  });

  it("does not match payroll stipend rows to a pooled mentor stipend line by broad title words", () => {
    const allocations = createAllocations(
      [
        purchase({
          sourceType: "staff",
          vendorName: "BELL, SAMUEL D (101407)",
          accountNumber: "21-221-1920-001-145-7640",
          accountDescription: "MENTOR STIPEND TT2 DIST",
          paymentAmount: 495.24,
          functionCode: "221",
          objectCode: "1920",
          objectBucket: "Salaries",
        }),
      ],
      [
        {
          id: "line-mentor-stipends",
          functionCode: "221: Improvement of Instruction",
          objectBucket: "Salaries",
          description: "AMEND: Tchr Mentor Stipends beyond dept/grd lvl work, incl doc mtng hr",
          approvedAmount: 42000,
          sourceRow: 41,
          columnLabel: "Salaries 1000",
        },
      ],
    );

    expect(allocations[0].matchBasis).toBe("function-object");
    expect(allocations[0].budgetLineId).toBeUndefined();
  });

  it("does not assign salary account-control variances to a single budget line without specific title evidence", () => {
    const allocations = createVarianceAllocations(
      [
        {
          id: "variance-221-salary",
          accountNumber: "21-221-1920-001-145-7640",
          accountDescription: "PAYROLL TT2 DIST",
          obligatedAmount: 600,
          invoicePaymentAmount: 0,
          varianceAmount: 600,
          functionCode: "221",
          objectCode: "1920",
          objectBucket: "Salaries",
        } satisfies ControlVariance,
      ],
      [
        {
          id: "line-mentor-stipends",
          functionCode: "221: Improvement of Instruction",
          objectBucket: "Salaries",
          description: "AMEND: Tchr Mentor Stipends beyond dept/grd lvl work, incl doc mtng hr",
          approvedAmount: 42000,
          sourceRow: 41,
          columnLabel: "Salaries 1000",
        },
      ],
    );

    expect(allocations[0].budgetLineId).toBeUndefined();
    expect(allocations[0].candidateLineIds).toEqual(["line-mentor-stipends"]);
  });

  it("does not force account-control variances onto closest lines without title evidence", () => {
    const allocations = createVarianceAllocations(
      [
        {
          id: "variance-125-supplies",
          accountNumber: "11-125-5110-001-000-3070",
          accountDescription: "SUPPLIES ELL",
          obligatedAmount: 600,
          invoicePaymentAmount: 0,
          varianceAmount: 600,
          functionCode: "125",
          objectCode: "5110",
          objectBucket: "Supplies",
        } satisfies ControlVariance,
      ],
      [
        {
          id: "line-headsets",
          functionCode: "125: Compensatory Education",
          objectBucket: "Supplies",
          description: "HamiltonBuhl headsets for supplemental ML usage",
          approvedAmount: 19075,
          sourceRow: 33,
          columnLabel: "Supplies 5000",
        },
        {
          id: "line-consumables",
          functionCode: "125: Compensatory Education",
          objectBucket: "Supplies",
          description: "Consumable classroom supplies such as pencils, paper, books, and folders",
          approvedAmount: 26115,
          sourceRow: 35,
          columnLabel: "Supplies 5000",
        },
      ],
    );

    expect(allocations[0].budgetLineId).toBeUndefined();
    expect(allocations[0].candidateLineIds).toEqual(["line-headsets", "line-consumables"]);
  });

  it("supports partial allowable decisions and overage rollups", () => {
    const allocations = [
      {
        ...createAllocations([purchase({ vendorName: "Amazon", paymentAmount: 1050 })], budgetLines)[0],
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
