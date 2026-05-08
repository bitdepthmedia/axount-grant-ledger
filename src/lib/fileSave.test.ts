import { describe, expect, it, vi } from "vitest";
import { saveProjectFile, type ProjectFileHandle } from "./fileSave";

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
