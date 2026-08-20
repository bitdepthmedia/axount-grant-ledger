import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { exportReconciliationWorkbook, projectTotals } from "./exportWorkbook";
import { buildCarryoverSource, createProject, loadProjectBundle, projectFileName, saveProjectBundle } from "./project";
import { syntheticImports } from "./testFixtures";
import type { Project } from "./types";

describe("project persistence and export", () => {
  it("saves and reopens a .recon project bundle", async () => {
    const project = createProject({
      grantName: "Synthetic Grant",
      grantCode: "35a5",
      fiscalYear: "FY25",
      fiscalYearStart: "2024-07-01",
      fiscalYearEnd: "2025-06-30",
      budgetVersionLabel: "Synthetic budget",
      imports: await syntheticImports(),
    });

    const blob = await saveProjectBundle(project);
    const file = new File([blob], "fy25.recon");
    const reopened = await loadProjectBundle(file);

    expect(reopened.id).toBe(project.id);
    expect(reopened.budgetVersions[0].lines.length).toBeGreaterThan(0);
    expect(reopened.purchases).toHaveLength(5);
    expect(reopened.allocations.length).toBeGreaterThanOrEqual(5);
  });

  it("uses a Reconsile default name for unnamed .recon project bundles", () => {
    expect(projectFileName({ grantName: "", grantCode: "", fiscalYear: "" } as Project)).toBe("reconsile-project.recon");
  });

  it("exports an Excel workbook with required reconciliation tabs", async () => {
    const project = createProject({
      grantName: "Synthetic Grant",
      grantCode: "35a5",
      fiscalYear: "FY25",
      fiscalYearStart: "2024-07-01",
      fiscalYearEnd: "2025-06-30",
      budgetVersionLabel: "Synthetic budget",
      imports: await syntheticImports(),
    });

    const blob = await exportReconciliationWorkbook(project);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());

    expect(workbook.creator).toBe("Reconsile");
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Summary",
      "Budget Lines",
      "Spending",
      "By Account",
      "By Function",
      "By Object",
      "Budget vs Accounts",
      "Review Log",
      "Carryover",
      "Source Checks",
    ]);
    expect(workbook.getWorksheet("Summary")?.getCell("A1").value).toBe("Reconsile");
  });

  it("subtracts carryover from grant-to-date remaining budget", async () => {
    const project = createProject({
      grantName: "Synthetic Grant",
      grantCode: "35a5",
      fiscalYear: "FY26",
      fiscalYearStart: "2025-07-01",
      fiscalYearEnd: "2026-06-30",
      budgetVersionLabel: "Synthetic budget",
      imports: await syntheticImports(),
    });
    const firstLine = project.budgetVersions[0].lines[0];
    const withCarryover = {
      ...project,
      carryovers: [
        {
          id: "carryover-test",
          projectName: "Synthetic Grant",
          fiscalYear: "FY25",
          importedAt: new Date().toISOString(),
          allowableByBudgetLine: { [firstLine.id]: 100 },
          notes: "Test carryover",
        },
      ],
    };

    const totals = projectTotals(withCarryover);

    expect(totals.carryover).toBe(100);
    expect(totals.grantToDate).toBeCloseTo(totals.allowable + 100, 2);
    expect(totals.remainingBeforeFlex).toBeCloseTo(totals.approved - totals.allowable - 100, 2);
  });

  it("rolls prior carryover forward when importing a multi-year carryover project", async () => {
    const year1 = createProject({
      grantName: "Synthetic Grant",
      grantCode: "23g",
      fiscalYear: "FY25",
      fiscalYearStart: "2024-07-01",
      fiscalYearEnd: "2025-06-30",
      budgetVersionLabel: "Synthetic budget",
      imports: await syntheticImports(),
    });
    const year2 = createProject({
      grantName: "Synthetic Grant",
      grantCode: "23g",
      fiscalYear: "FY26",
      fiscalYearStart: "2025-07-01",
      fiscalYearEnd: "2026-06-30",
      budgetVersionLabel: "Synthetic budget",
      imports: await syntheticImports(),
    });
    const year3 = createProject({
      grantName: "Synthetic Grant",
      grantCode: "23g",
      fiscalYear: "FY27",
      fiscalYearStart: "2026-07-01",
      fiscalYearEnd: "2027-06-30",
      budgetVersionLabel: "Synthetic budget",
      imports: await syntheticImports(),
    });
    const year1Line = year1.budgetVersions[0].lines[0];
    const year2Line = year2.budgetVersions[0].lines[0];
    const year3Line = year3.budgetVersions[0].lines[0];
    const year1Confirmed = {
      ...year1,
      allocations: [
        {
          id: "year-1-confirmed",
          budgetLineId: year1Line.id,
          status: "Allowable" as const,
          matchBasis: "manual" as const,
          confidence: 100,
          allowableAmount: 100,
          nonAllowableAmount: 0,
          reviewNote: "",
          candidateLineIds: [],
          reasons: [],
        },
      ],
    };
    const year2WithPrior = {
      ...year2,
      allocations: [
        {
          id: "year-2-confirmed",
          budgetLineId: year2Line.id,
          status: "Allowable" as const,
          matchBasis: "manual" as const,
          confidence: 100,
          allowableAmount: 25,
          nonAllowableAmount: 0,
          reviewNote: "",
          candidateLineIds: [],
          reasons: [],
        },
      ],
      carryovers: [buildCarryoverSource(year2, year1Confirmed)],
    };

    const rollForward = buildCarryoverSource(year3, year2WithPrior);

    expect(rollForward.allowableByBudgetLine[year3Line.id]).toBe(125);
  });

  it("applies prior project carryover while creating a new project", async () => {
    const prior = createProject({
      grantName: "Synthetic Grant",
      grantCode: "23g",
      fiscalYear: "FY25",
      fiscalYearStart: "2024-07-01",
      fiscalYearEnd: "2025-06-30",
      budgetVersionLabel: "Synthetic budget",
      imports: await syntheticImports(),
    });
    const priorLine = prior.budgetVersions[0].lines[0];
    const priorConfirmed = {
      ...prior,
      allocations: [
        {
          id: "prior-confirmed",
          budgetLineId: priorLine.id,
          status: "Allowable" as const,
          matchBasis: "manual" as const,
          confidence: 100,
          allowableAmount: 100,
          nonAllowableAmount: 0,
          reviewNote: "",
          candidateLineIds: [],
          reasons: [],
        },
      ],
    };

    const current = createProject({
      grantName: "Synthetic Grant",
      grantCode: "23g",
      fiscalYear: "FY26",
      fiscalYearStart: "2025-07-01",
      fiscalYearEnd: "2026-06-30",
      budgetVersionLabel: "Synthetic budget",
      imports: await syntheticImports(),
      priorProject: priorConfirmed,
    });

    expect(current.carryovers).toHaveLength(1);
    expect(current.carryovers[0].allowableByBudgetLine[current.budgetVersions[0].lines[0].id]).toBe(100);
    expect(current.auditLog[0].action).toBe("Carryover imported");
  });
});
