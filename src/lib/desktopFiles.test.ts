import { afterEach, describe, expect, it, vi } from "vitest";
import { openNativeProjectPath } from "./desktopFiles";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command !== "read_recon_file") throw new Error(`Unexpected command: ${command}`);
    return { name: "finder-open.recon", path: args?.path, bytes: [80, 75, 3, 4] };
  }),
}));

describe("desktop native file handoff", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens a .recon project from a Finder document path", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });

    const opened = await openNativeProjectPath("/tmp/finder-open.recon");

    expect(opened?.handle).toEqual({ name: "finder-open.recon", nativePath: "/tmp/finder-open.recon" });
    expect(opened?.file.name).toBe("finder-open.recon");
  });
});
