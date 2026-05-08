import type { AccountSummary, BudgetLine, ObjectBucket } from "./types";

export type BudgetAccountVarianceType = "Missing In Accounts" | "Extra In Accounts";
export type FunctionCodeMappings = Record<string, string>;

export interface BudgetAccountVariance {
  id: string;
  type: BudgetAccountVarianceType;
  functionCode: string;
  objectBucket: ObjectBucket;
  approvedAmount: number;
  accountBudgetAmount: number;
  differenceAmount: number;
  likelyBudgetLines: BudgetLine[];
  note: string;
}

export function budgetAccountVariances(
  budgetLines: BudgetLine[],
  accounts: AccountSummary[],
  functionCodeMappings: FunctionCodeMappings = {},
): BudgetAccountVariance[] {
  const approvedByBucket = new Map<string, number>();
  const accountByBucket = new Map<string, number>();

  for (const line of budgetLines) {
    const key = varianceKey(line.functionCode, line.objectBucket);
    approvedByBucket.set(key, (approvedByBucket.get(key) ?? 0) + line.approvedAmount);
  }

  for (const account of accounts) {
    const key = varianceKey(mappedFunctionCode(account.functionCode, functionCodeMappings), account.objectBucket);
    accountByBucket.set(key, (accountByBucket.get(key) ?? 0) + account.ytdBudget);
  }

  const keys = new Set([...approvedByBucket.keys(), ...accountByBucket.keys()]);
  return [...keys]
    .map((key) => {
      const [functionCode, objectBucket] = key.split("::") as [string, ObjectBucket];
      const approvedAmount = approvedByBucket.get(key) ?? 0;
      const accountBudgetAmount = accountByBucket.get(key) ?? 0;
      const differenceAmount = approvedAmount - accountBudgetAmount;
      if (Math.abs(differenceAmount) < 0.01) return null;

      const type: BudgetAccountVarianceType = differenceAmount > 0 ? "Missing In Accounts" : "Extra In Accounts";
      const absDifference = Math.abs(differenceAmount);
      const candidates = budgetLines
        .filter((line) => line.functionCode === functionCode && line.objectBucket === objectBucket)
        .map((line) => ({ line, distance: Math.abs(line.approvedAmount - absDifference) }))
        .sort((a, b) => a.distance - b.distance || b.line.approvedAmount - a.line.approvedAmount)
        .slice(0, 4)
        .map((candidate) => candidate.line);

      return {
        id: `budget-account-${functionCode}-${objectBucket}`.replace(/[^a-z0-9-]+/gi, "-").toLowerCase(),
        type,
        functionCode,
        objectBucket,
        approvedAmount,
        accountBudgetAmount,
        differenceAmount,
        likelyBudgetLines: candidates,
        note: varianceNote(type, absDifference, candidates),
      };
    })
    .filter((variance): variance is BudgetAccountVariance => variance !== null)
    .sort((a, b) => Math.abs(b.differenceAmount) - Math.abs(a.differenceAmount));
}

export function budgetAccountSummary(
  budgetLines: BudgetLine[],
  accounts: AccountSummary[],
  functionCodeMappings: FunctionCodeMappings = {},
) {
  const approvedTotal = budgetLines.reduce((total, line) => total + line.approvedAmount, 0);
  const accountBudgetTotal = accounts.reduce((total, account) => total + account.ytdBudget, 0);
  const variances = budgetAccountVariances(budgetLines, accounts, functionCodeMappings);
  return {
    approvedTotal,
    accountBudgetTotal,
    netDifference: accountBudgetTotal - approvedTotal,
    absoluteMismatchTotal: variances.reduce((total, variance) => total + Math.abs(variance.differenceAmount), 0),
  };
}

export function mappedFunctionCode(functionCode: string, functionCodeMappings: FunctionCodeMappings): string {
  return functionCodeMappings[functionCode] || functionCode;
}

function varianceKey(functionCode: string, objectBucket: ObjectBucket): string {
  return `${functionCode}::${objectBucket}`;
}

function varianceNote(type: BudgetAccountVarianceType, amount: number, candidates: BudgetLine[]): string {
  const exact = candidates.find((line) => Math.abs(line.approvedAmount - amount) < 0.01);
  if (exact && type === "Missing In Accounts") {
    return `Likely missing account budget for approved line: ${exact.description}`;
  }
  if (exact && type === "Extra In Accounts") {
    return `Account budget has an extra amount equal to this approved line: ${exact.description}`;
  }
  if (type === "Missing In Accounts") return "Approved budget is higher than loaded account budget for this function/object.";
  return "Loaded account budget is higher than the approved budget for this function/object.";
}
