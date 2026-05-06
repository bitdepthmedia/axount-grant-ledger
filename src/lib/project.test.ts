import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { exportReconciliationWorkbook } from "./exportWorkbook";
import { createProject, loadProjectBundle, saveProjectBundle } from "./project";
import { syntheticImports } from "./testFixtures";

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

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Summary",
      "Budget Lines",
      "Purchases",
      "By Account",
      "By Function",
      "By Object",
      "Budget vs Accounts",
      "Review Log",
      "Carryover",
      "Source Checks",
    ]);
  });
});
