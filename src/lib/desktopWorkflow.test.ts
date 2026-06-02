import { describe, expect, it } from "vitest";
import { exportFileName, exportReconciliationWorkbook } from "./exportWorkbook";
import { saveExportFile, saveProjectFile, type NativeFileBridge } from "./fileSave";
import { createProject, loadProjectBundle, projectFileName, saveProjectBundle } from "./project";
import { syntheticImports } from "./testFixtures";

describe("desktop file workflow smoke", () => {
  it("imports, saves, overwrites, reopens, and exports without browser downloads", async () => {
    const savedFiles = new Map<string, number[]>();
    const desktop: NativeFileBridge = {
      async saveProjectFile({ bytes, suggestedName, path }) {
        const target = path ?? `/tmp/${suggestedName}`;
        savedFiles.set(target, bytes);
        return { name: target.split("/").pop() ?? suggestedName, path: target };
      },
      async saveExcelFile({ bytes, suggestedName }) {
        const target = `/tmp/${suggestedName}`;
        savedFiles.set(target, bytes);
        return { name: suggestedName, path: target };
      },
    };
    const fallbackDownload = () => {
      throw new Error("Browser download fallback should not be used in the desktop workflow.");
    };

    const project = createProject({
      grantName: "Synthetic Grant",
      grantCode: "35a5",
      fiscalYear: "FY25",
      fiscalYearStart: "2024-07-01",
      fiscalYearEnd: "2025-06-30",
      budgetVersionLabel: "Synthetic budget",
      imports: await syntheticImports(),
    });

    const firstSave = await saveProjectFile({
      blob: await saveProjectBundle(project),
      suggestedName: projectFileName(project),
      desktop,
      fallbackDownload,
    });
    expect(firstSave.mode).toBe("picked");

    const overwrite = await saveProjectFile({
      blob: await saveProjectBundle({ ...project, grantName: "Synthetic Grant Updated" }),
      suggestedName: projectFileName(project),
      handle: firstSave.handle,
      desktop,
      fallbackDownload,
    });
    expect(overwrite.mode).toBe("overwritten");

    const savedBytes = savedFiles.get("/tmp/35a5-fy25.recon");
    expect(savedBytes).toBeDefined();
    const reopened = await loadProjectBundle(new File([new Uint8Array(savedBytes!)], "35a5-fy25.recon"));
    expect(reopened.grantName).toBe("Synthetic Grant Updated");

    const exportResult = await saveExportFile({
      blob: await exportReconciliationWorkbook(reopened),
      suggestedName: exportFileName(reopened),
      desktop,
      fallbackDownload,
    });
    expect(exportResult.mode).toBe("picked");
    expect(savedFiles.has(`/tmp/${exportFileName(reopened)}`)).toBe(true);
  });
});
