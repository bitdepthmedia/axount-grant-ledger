export type ObjectBucket =
  | "Salaries"
  | "Benefits"
  | "Purchased Services"
  | "Supplies"
  | "Capital Outlay"
  | "Other"
  | "Unknown";

export type ReviewStatus = "Allowable" | "Not Allowable" | "Partially Allowable" | "Review Required";

export type MatchBasis = "specific-budget-line" | "function-object" | "none" | "manual" | "account-control-variance";

export interface SourceFileSnapshot {
  id: string;
  role: "budget" | "accounts" | "invoices" | "staff";
  name: string;
  bytesBase64?: string;
  importedAt: string;
}

export interface BudgetLine {
  id: string;
  functionCode: string;
  objectBucket: ObjectBucket;
  description: string;
  entity?: string;
  approvedAmount: number;
  sourceRow: number;
  columnLabel: string;
}

export interface BudgetVersion {
  id: string;
  label: string;
  sourceFileName: string;
  importedAt: string;
  lines: BudgetLine[];
}

export interface AccountSummary {
  id: string;
  accountNumber: string;
  description: string;
  functionCode: string;
  objectCode: string;
  objectBucket: ObjectBucket;
  ytdBudget: number;
  ytdActual: number;
  ytdEncum: number;
  reqReserve: number;
  obligated: number;
  balance: number;
}

export interface Purchase {
  id: string;
  sourceType?: "invoice" | "staff";
  poNumber: string;
  accountNumber: string;
  sourceAccountAmounts?: Record<string, number>;
  accountDescription: string;
  date: string;
  vendorCode: string;
  vendorName: string;
  employeeId?: string;
  employeeName?: string;
  revAmount: number;
  paymentAmount: number;
  inProcessAmount: number;
  status: string;
  requisitionNumber: string;
  functionCode: string;
  objectCode: string;
  objectBucket: ObjectBucket;
}

export interface MatchCandidate {
  budgetLineId: string;
  score: number;
  reasons: string[];
}

export interface Allocation {
  id: string;
  purchaseId?: string;
  accountSummaryId?: string;
  budgetLineId?: string;
  status: ReviewStatus;
  matchBasis: MatchBasis;
  confidence: number;
  allowableAmount: number;
  nonAllowableAmount: number;
  reviewNote: string;
  candidateLineIds: string[];
  reasons: string[];
}

export interface CarryoverSource {
  id: string;
  projectName: string;
  fiscalYear: string;
  importedAt: string;
  allowableByBudgetLine: Record<string, number>;
  notes: string;
}

export interface ControlVariance {
  id: string;
  accountNumber: string;
  accountDescription: string;
  obligatedAmount: number;
  invoicePaymentAmount: number;
  varianceAmount: number;
  functionCode: string;
  objectCode: string;
  objectBucket: ObjectBucket;
}

export interface AuditEvent {
  id: string;
  at: string;
  action: string;
  details: string;
}

export interface Project {
  schemaVersion: 1;
  id: string;
  grantName: string;
  grantCode: string;
  fiscalYear: string;
  fiscalYearStart: string;
  fiscalYearEnd: string;
  budgetVersionLabel: string;
  createdAt: string;
  updatedAt: string;
  sourceFiles: SourceFileSnapshot[];
  budgetVersions: BudgetVersion[];
  activeBudgetVersionId: string;
  accounts: AccountSummary[];
  purchases: Purchase[];
  allocations: Allocation[];
  carryovers: CarryoverSource[];
  functionCodeMappings: Record<string, string>;
  controlVariances: ControlVariance[];
  auditLog: AuditEvent[];
}

export interface WorkbookImportResult {
  budgetVersion: BudgetVersion;
  accounts: AccountSummary[];
  purchases: Purchase[];
  sourceFiles: SourceFileSnapshot[];
}

export interface BudgetLineRollup {
  line: BudgetLine;
  currentAllowable: number;
  currentReview: number;
  currentNotAllowable: number;
  priorCarryover: number;
  totalAgainstBudget: number;
  remainingBeforeFlex: number;
  flexCeiling: number;
  flexRemaining: number;
  state: "Under Budget" | "Within Budget" | "Flex Used" | "Over Budget";
}
