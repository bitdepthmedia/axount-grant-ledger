import type { ObjectBucket } from "./types";

export function objectBucketFromCode(objectCode: unknown): ObjectBucket {
  const code = String(objectCode ?? "").trim();
  if (code.startsWith("1")) return "Salaries";
  if (code.startsWith("2")) return "Benefits";
  if (code.startsWith("3") || code.startsWith("4")) return "Purchased Services";
  if (code.startsWith("5")) return "Supplies";
  if (code.startsWith("6")) return "Capital Outlay";
  if (code.startsWith("7") || code.startsWith("8")) return "Other";
  return "Unknown";
}

export function objectBucketFromBudgetColumn(columnLabel: string): ObjectBucket {
  const normalized = columnLabel.toLowerCase();
  if (normalized.includes("salaries")) return "Salaries";
  if (normalized.includes("benefits")) return "Benefits";
  if (normalized.includes("purchased")) return "Purchased Services";
  if (normalized.includes("supplies")) return "Supplies";
  if (normalized.includes("capital")) return "Capital Outlay";
  if (normalized.includes("other")) return "Other";
  return "Unknown";
}

export function accountParts(accountNumber: string): { functionCode: string; objectCode: string } {
  const parts = accountNumber.split("-");
  return {
    functionCode: parts[1] ?? "",
    objectCode: parts[2] ?? "",
  };
}

export function functionCodeRoot(functionCode: string): string {
  return functionCode.split(":")[0]?.trim() ?? "";
}

export function functionCodesMatch(left: string, right: string): boolean {
  return functionCodeRoot(left) === functionCodeRoot(right);
}
