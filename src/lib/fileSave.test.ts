import { describe, expect, it, vi } from "vitest";
import { saveExportFile, saveProjectFile, type ProjectFileHandle } from "./fileSave";

describe("project file saving", () => {
  it("overwrites an existing save handle by default", async () => {
    const writes: Blob[] = [];
    const handle = fakeHandle("grant.recon", writes);
    const fallbackDownload = vi.fn();

    const result = await saveProjectFile({
      blob: new Blob(["updated"]),
      suggestedName: "grant.recon",
      handle,
      fallbackDownload,
    });

    expect(result.mode).toBe("overwritten");
    expect(result.handle).toBe(handle);
    expect(writes).toHaveLength(1);
    expect(await writes[0].text()).toBe("updated");
    expect(fallbackDownload).not.toHaveBeenCalled();
  });

  it("picks a file on first save and returns the handle for later overwrites", async () => {
    const writes: Blob[] = [];
    const handle = fakeHandle("renamed.recon", writes);
    const fallbackDownload = vi.fn();

    const result = await saveProjectFile({
      blob: new Blob(["first"]),
      suggestedName: "grant.recon",
      picker: { showSaveFilePicker: vi.fn().mockResolvedValue(handle) },
      fallbackDownload,
    });

    expect(result.mode).toBe("picked");
    expect(result.fileName).toBe("renamed.recon");
    expect(result.handle).toBe(handle);
    expect(await writes[0].text()).toBe("first");
    expect(fallbackDownload).not.toHaveBeenCalled();
  });

  it("picks a native desktop file on first save when available", async () => {
    const fallbackDownload = vi.fn();
    const desktop = {
      saveProjectFile: vi.fn().mockResolvedValue({ name: "native.recon", path: "/tmp/native.recon" }),
    };

    const result = await saveProjectFile({
      blob: new Blob(["native"]),
      suggestedName: "grant.recon",
      desktop,
      fallbackDownload,
    });

    expect(result.mode).toBe("picked");
    expect(result.fileName).toBe("native.recon");
    expect(result.handle).toEqual({ name: "native.recon", nativePath: "/tmp/native.recon" });
    expect(desktop.saveProjectFile).toHaveBeenCalledWith({
      bytes: [110, 97, 116, 105, 118, 101],
      suggestedName: "grant.recon",
    });
    expect(fallbackDownload).not.toHaveBeenCalled();
  });

  it("overwrites a native desktop path by default", async () => {
    const fallbackDownload = vi.fn();
    const desktop = {
      saveProjectFile: vi.fn().mockResolvedValue({ name: "native.recon", path: "/tmp/native.recon" }),
    };

    const result = await saveProjectFile({
      blob: new Blob(["updated"]),
      suggestedName: "grant.recon",
      handle: { name: "native.recon", nativePath: "/tmp/native.recon" },
      desktop,
      fallbackDownload,
    });

    expect(result.mode).toBe("overwritten");
    expect(result.fileName).toBe("native.recon");
    expect(desktop.saveProjectFile).toHaveBeenCalledWith({
      bytes: [117, 112, 100, 97, 116, 101, 100],
      suggestedName: "grant.recon",
      path: "/tmp/native.recon",
    });
    expect(fallbackDownload).not.toHaveBeenCalled();
  });

  it("does not download when native desktop save is cancelled", async () => {
    const fallbackDownload = vi.fn();
    const desktop = {
      saveProjectFile: vi.fn().mockResolvedValue(null),
    };

    const result = await saveProjectFile({
      blob: new Blob(["cancelled"]),
      suggestedName: "grant.recon",
      desktop,
      fallbackDownload,
    });

    expect(result.mode).toBe("cancelled");
    expect(fallbackDownload).not.toHaveBeenCalled();
  });

  it("falls back to a download when overwrite-capable saving is unavailable", async () => {
    const fallbackDownload = vi.fn();

    const result = await saveProjectFile({
      blob: new Blob(["download"]),
      suggestedName: "grant.recon",
      fallbackDownload,
    });

    expect(result.mode).toBe("downloaded");
    expect(fallbackDownload).toHaveBeenCalledOnce();
  });

  it("does not download when the first-save picker is cancelled", async () => {
    const fallbackDownload = vi.fn();
    const abort = new DOMException("Cancelled", "AbortError");

    const result = await saveProjectFile({
      blob: new Blob(["cancelled"]),
      suggestedName: "grant.recon",
      picker: { showSaveFilePicker: vi.fn().mockRejectedValue(abort) },
      fallbackDownload,
    });

    expect(result.mode).toBe("cancelled");
    expect(fallbackDownload).not.toHaveBeenCalled();
  });

  it("saves Excel exports through the native desktop bridge when available", async () => {
    const fallbackDownload = vi.fn();
    const desktop = {
      saveProjectFile: vi.fn(),
      saveExcelFile: vi.fn().mockResolvedValue({ name: "grant.xlsx", path: "/tmp/grant.xlsx" }),
    };

    const result = await saveExportFile({
      blob: new Blob(["xlsx"]),
      suggestedName: "grant.xlsx",
      desktop,
      fallbackDownload,
    });

    expect(result.mode).toBe("picked");
    expect(result.fileName).toBe("grant.xlsx");
    expect(desktop.saveExcelFile).toHaveBeenCalledWith({
      bytes: [120, 108, 115, 120],
      suggestedName: "grant.xlsx",
    });
    expect(fallbackDownload).not.toHaveBeenCalled();
  });
});

function fakeHandle(name: string, writes: Blob[]): ProjectFileHandle {
  return {
    name,
    async createWritable() {
      return {
        async write(data: Blob) {
          writes.push(data);
        },
        async close() {},
      };
    },
  };
}
