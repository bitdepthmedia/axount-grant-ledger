import { makeId, stableId } from "./ids";
import { tokenOverlap } from "./text";
import type {
  AccountSummary,
  Allocation,
  BudgetLine,
  BudgetLineRollup,
  CarryoverSource,
  ControlVariance,
  MatchCandidate,
  Purchase,
} from "./types";

export function createAllocations(purchases: Purchase[], budgetLines: BudgetLine[]): Allocation[] {
  return purchases.map((purchase) => {
    const candidates = scoreCandidates(purchase, budgetLines);
    const best = candidates[0];
    const sameBucket = budgetLines.filter(
      (line) => line.functionCode === purchase.functionCode && line.objectBucket === purchase.objectBucket,
    );

    if (purchase.sourceType === "staff" && sameBucket.length === 1) {
      return {
        id: stableId("allocation", [purchase.id]),
        purchaseId: purchase.id,
        budgetLineId: sameBucket[0].id,
        status: "Allowable",
        matchBasis: "specific-budget-line",
        confidence: 75,
        allowableAmount: purchase.paymentAmount,
        nonAllowableAmount: 0,
        reviewNote: "",
        candidateLineIds: [sameBucket[0].id],
        reasons: ["Staff payroll matched the only approved budget line for this function and object bucket."],
      };
    }

    if (best && best.score >= 70) {
      return {
        id: stableId("allocation", [purchase.id]),
        purchaseId: purchase.id,
        budgetLineId: best.budgetLineId,
        status: "Allowable",
        matchBasis: "specific-budget-line",
        confidence: best.score,
        allowableAmount: purchase.paymentAmount,
        nonAllowableAmount: 0,
        reviewNote: "",
        candidateLineIds: candidates.slice(0, 5).map((candidate) => candidate.budgetLineId),
        reasons: best.reasons,
      };
    }

    if (sameBucket.length > 0) {
      return {
        id: stableId("allocation", [purchase.id]),
        purchaseId: purchase.id,
        budgetLineId: best?.budgetLineId,
        status: "Review Required",
        matchBasis: "function-object",
        confidence: best?.score ?? 40,
        allowableAmount: 0,
        nonAllowableAmount: 0,
        reviewNote: "Function and object match only. Specific budget-line review required.",
        candidateLineIds: candidates.slice(0, 5).map((candidate) => candidate.budgetLineId),
        reasons: ["Function and object bucket match, but no strong line-item evidence."],
      };
    }

    return {
      id: stableId("allocation", [purchase.id]),
      purchaseId: purchase.id,
      status: "Review Required",
      matchBasis: "none",
      confidence: 0,
      allowableAmount: 0,
      nonAllowableAmount: purchase.paymentAmount,
      reviewNote: "No approved budget line found for this function and object bucket.",
      candidateLineIds: [],
      reasons: ["No function/object budget match."],
    };
  });
}

export function scoreCandidates(purchase: Purchase, budgetLines: BudgetLine[]): MatchCandidate[] {
  return budgetLines
    .filter((line) => line.functionCode === purchase.functionCode && line.objectBucket === purchase.objectBucket)
    .map((line) => {
      const reasons: string[] = ["Function and object bucket match."];
      let score = 50;

      const vendorHits = tokenOverlap(purchase.vendorName, line.description);
      if (vendorHits.length) {
        score += Math.min(30, vendorHits.length * 12);
        reasons.push(`Vendor/name overlaps budget description: ${vendorHits.join(", ")}.`);
      }

      const accountHits = tokenOverlap(purchase.accountDescription, line.description);
      if (accountHits.length) {
        score += Math.min(18, accountHits.length * 6);
        reasons.push(`Account description overlaps budget description: ${accountHits.join(", ")}.`);
      }

      if (purchase.paymentAmount > 0 && purchase.paymentAmount <= line.approvedAmount * 1.1 + 0.01) {
        score += 10;
        reasons.push("Payment fits within approved line plus 10% flexibility.");
      }

      if (Math.abs(purchase.paymentAmount - line.approvedAmount) <= Math.max(5, line.approvedAmount * 0.03)) {
        score += 10;
        reasons.push("Payment is close to the approved line amount.");
      }

      return {
        budgetLineId: line.id,
        score: Math.min(100, score),
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function createControlVariances(accounts: AccountSummary[], purchases: Purchase[]): ControlVariance[] {
  const paidByAccount = new Map<string, number>();
  for (const purchase of purchases) {
    if (purchase.sourceAccountAmounts) {
      for (const [accountNumber, amount] of Object.entries(purchase.sourceAccountAmounts)) {
        paidByAccount.set(accountNumber, (paidByAccount.get(accountNumber) ?? 0) + amount);
      }
    } else {
      paidByAccount.set(purchase.accountNumber, (paidByAccount.get(purchase.accountNumber) ?? 0) + purchase.paymentAmount);
    }
  }

  return accounts
    .map((account) => {
      const invoicePaymentAmount = paidByAccount.get(account.accountNumber) ?? 0;
      const varianceAmount = account.obligated - invoicePaymentAmount;
      return {
        id: stableId("variance", [account.accountNumber]),
        accountNumber: account.accountNumber,
        accountDescription: account.description,
        obligatedAmount: account.obligated,
        invoicePaymentAmount,
        varianceAmount,
        functionCode: account.functionCode,
        objectCode: account.objectCode,
        objectBucket: account.objectBucket,
      };
    })
    .filter((variance) => variance.varianceAmount > 0.01);
}

export function createVarianceAllocations(variances: ControlVariance[]): Allocation[] {
  return variances.map((variance) => ({
    id: makeId("allocation-variance"),
    accountSummaryId: variance.id,
    status: "Review Required",
    matchBasis: "account-control-variance",
    confidence: 0,
    allowableAmount: 0,
    nonAllowableAmount: 0,
    reviewNote: "Account file shows obligated spending not supported by uploaded spending detail.",
    candidateLineIds: [],
    reasons: ["Account obligated amount exceeds uploaded spending total for this account."],
  }));
}

export function rollupBudgetLines(
  budgetLines: BudgetLine[],
  allocations: Allocation[],
  carryovers: CarryoverSource[],
): BudgetLineRollup[] {
  return budgetLines.map((line) => {
    const lineAllocations = allocations.filter((allocation) => allocation.budgetLineId === line.id);
    const currentAllowable = sum(lineAllocations.map((allocation) => allocation.allowableAmount));
    const currentReview = sum(
      lineAllocations
        .filter((allocation) => allocation.status === "Review Required")
        .map((allocation) => Math.max(allocation.allowableAmount, allocation.nonAllowableAmount)),
    );
    const currentNotAllowable = sum(lineAllocations.map((allocation) => allocation.nonAllowableAmount));
    const priorCarryover = sum(carryovers.map((carryover) => carryover.allowableByBudgetLine[line.id] ?? 0));
    const totalAgainstBudget = currentAllowable + priorCarryover;
    const remainingBeforeFlex = line.approvedAmount - totalAgainstBudget;
    const flexCeiling = line.approvedAmount * 1.1;
    const flexRemaining = flexCeiling - totalAgainstBudget;
    const state =
      totalAgainstBudget > flexCeiling + 0.01
        ? "Over Budget"
        : totalAgainstBudget > line.approvedAmount + 0.01
          ? "Flex Used"
          : totalAgainstBudget === 0
            ? "Under Budget"
            : "Within Budget";

    return {
      line,
      currentAllowable,
      currentReview,
      currentNotAllowable,
      priorCarryover,
      totalAgainstBudget,
      remainingBeforeFlex,
      flexCeiling,
      flexRemaining,
      state,
    };
  });
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
