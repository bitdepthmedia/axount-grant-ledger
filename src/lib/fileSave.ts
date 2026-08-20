export interface WritableProjectFile {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

export interface ProjectFileHandle {
  name: string;
  createWritable(): Promise<WritableProjectFile>;
}

export interface NativeProjectFileHandle {
  name: string;
  nativePath: string;
}

export type SavedProjectFileHandle = ProjectFileHandle | NativeProjectFileHandle;

export interface NativeSaveResult {
  name: string;
  path: string;
}

export interface NativeFileBridge {
  saveProjectFile(input: { bytes: number[]; suggestedName: string; path?: string }): Promise<NativeSaveResult | null>;
  saveExcelFile?(input: { bytes: number[]; suggestedName: string }): Promise<NativeSaveResult | null>;
}

export interface ProjectSaveFilePickerOptions {
  suggestedName: string;
  types: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
}

export interface ProjectSavePicker {
  showSaveFilePicker?: (options: ProjectSaveFilePickerOptions) => Promise<ProjectFileHandle>;
}

export interface ProjectSaveResult {
  handle?: SavedProjectFileHandle;
  fileName: string;
  mode: "downloaded" | "picked" | "overwritten" | "cancelled";
}

export async function saveProjectFile(input: {
  blob: Blob;
  suggestedName: string;
  handle?: SavedProjectFileHandle | null;
  desktop?: NativeFileBridge | null;
  picker?: ProjectSavePicker;
  fallbackDownload: (blob: Blob, fileName: string) => void;
}): Promise<ProjectSaveResult> {
  if (input.handle) {
    if (isNativeHandle(input.handle)) {
      if (!input.desktop) throw new Error("Native save is unavailable.");
      const saved = await input.desktop.saveProjectFile({
        bytes: await blobBytes(input.blob),
        suggestedName: input.suggestedName,
        path: input.handle.nativePath,
      });
      if (!saved) return { fileName: input.handle.name, mode: "cancelled" };
      return { handle: { name: saved.name, nativePath: saved.path }, fileName: saved.name, mode: "overwritten" };
    }
    await writeBlob(input.handle, input.blob);
    return { handle: input.handle, fileName: input.handle.name, mode: "overwritten" };
  }

  if (input.desktop) {
    const saved = await input.desktop.saveProjectFile({
      bytes: await blobBytes(input.blob),
      suggestedName: input.suggestedName,
    });
    if (!saved) return { fileName: input.suggestedName, mode: "cancelled" };
    return { handle: { name: saved.name, nativePath: saved.path }, fileName: saved.name, mode: "picked" };
  }

  if (input.picker?.showSaveFilePicker) {
    try {
      const handle = await input.picker.showSaveFilePicker({
        suggestedName: input.suggestedName,
        types: [
          {
            description: "Reconsile project",
            accept: { "application/zip": [".recon"] },
          },
        ],
      });
      await writeBlob(handle, input.blob);
      return { handle, fileName: handle.name, mode: "picked" };
    } catch (error) {
      if (isAbortError(error)) return { fileName: input.suggestedName, mode: "cancelled" };
      throw error;
    }
  }

  input.fallbackDownload(input.blob, input.suggestedName);
  return { fileName: input.suggestedName, mode: "downloaded" };
}

export async function saveExportFile(input: {
  blob: Blob;
  suggestedName: string;
  desktop?: NativeFileBridge | null;
  fallbackDownload: (blob: Blob, fileName: string) => void;
}): Promise<Pick<ProjectSaveResult, "fileName" | "mode">> {
  if (input.desktop?.saveExcelFile) {
    const saved = await input.desktop.saveExcelFile({
      bytes: await blobBytes(input.blob),
      suggestedName: input.suggestedName,
    });
    if (!saved) return { fileName: input.suggestedName, mode: "cancelled" };
    return { fileName: saved.name, mode: "picked" };
  }

  input.fallbackDownload(input.blob, input.suggestedName);
  return { fileName: input.suggestedName, mode: "downloaded" };
}

async function writeBlob(handle: ProjectFileHandle, blob: Blob): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function isNativeHandle(handle: SavedProjectFileHandle): handle is NativeProjectFileHandle {
  return "nativePath" in handle;
}

async function blobBytes(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}
