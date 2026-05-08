export interface WritableProjectFile {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

export interface ProjectFileHandle {
  name: string;
  createWritable(): Promise<WritableProjectFile>;
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
  handle?: ProjectFileHandle;
  fileName: string;
  mode: "downloaded" | "picked" | "overwritten" | "cancelled";
}

export async function saveProjectFile(input: {
  blob: Blob;
  suggestedName: string;
  handle?: ProjectFileHandle | null;
  picker?: ProjectSavePicker;
  fallbackDownload: (blob: Blob, fileName: string) => void;
}): Promise<ProjectSaveResult> {
  if (input.handle) {
    await writeBlob(input.handle, input.blob);
    return { handle: input.handle, fileName: input.handle.name, mode: "overwritten" };
  }

  if (input.picker?.showSaveFilePicker) {
    try {
      const handle = await input.picker.showSaveFilePicker({
        suggestedName: input.suggestedName,
        types: [
          {
            description: "Grant Ledger project",
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
