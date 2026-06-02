import type { NativeFileBridge, NativeProjectFileHandle, NativeSaveResult } from "./fileSave";

interface NativeOpenResult extends NativeSaveResult {
  bytes: number[];
}

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type Unlisten = () => void;

export interface NativeOpenedProject {
  file: File;
  handle: NativeProjectFileHandle;
}

export function createDesktopFileBridge(): NativeFileBridge | null {
  if (!isTauriRuntime()) return null;

  return {
    saveProjectFile: ({ bytes, suggestedName, path }) =>
      invokeCommand<NativeSaveResult | null>("save_recon_file", { bytes, suggestedName, path }),
    saveExcelFile: ({ bytes, suggestedName }) =>
      invokeCommand<NativeSaveResult | null>("save_excel_file", { bytes, suggestedName }),
  };
}

export async function openNativeProjectFile(): Promise<NativeOpenedProject | null> {
  if (!isTauriRuntime()) return null;
  const opened = await invokeCommand<NativeOpenResult | null>("open_recon_file");
  return nativeOpenResultToProject(opened);
}

export async function openNativeProjectPath(path: string): Promise<NativeOpenedProject | null> {
  if (!isTauriRuntime()) return null;
  const opened = await invokeCommand<NativeOpenResult>("read_recon_file", { path });
  return nativeOpenResultToProject(opened);
}

export async function takePendingNativeProjectPaths(): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  return invokeCommand<string[]>("take_pending_recon_paths");
}

export async function listenNativeProjectOpen(onPath: (path: string) => void): Promise<Unlisten | null> {
  if (!isTauriRuntime()) return null;
  const { listen } = (await import("@tauri-apps/api/event")) as {
    listen: <T>(event: string, handler: (event: { payload: T }) => void) => Promise<Unlisten>;
  };
  return listen<string[]>("recon-file-opened", (event) => {
    for (const path of event.payload) onPath(path);
  });
}

function nativeOpenResultToProject(opened: NativeOpenResult | null): NativeOpenedProject | null {
  if (!opened) return null;
  const bytes = new Uint8Array(opened.bytes);
  return {
    file: new File([bytes], opened.name, { type: "application/zip" }),
    handle: { name: opened.name, nativePath: opened.path },
  };
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = (await import("@tauri-apps/api/core")) as { invoke: Invoke };
  return invoke<T>(command, args);
}
