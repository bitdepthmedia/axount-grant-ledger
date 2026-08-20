import type { Project } from "./types";

const DB_NAME = "reconsile-drafts";
const DB_VERSION = 1;
const STORE_NAME = "drafts";
const LATEST_KEY = "latest";

export interface DraftSummary {
  grantName: string;
  grantCode: string;
  fiscalYear: string;
  updatedAt: string;
}

export async function saveLatestDraft(project: Project): Promise<void> {
  const db = await openDraftDb();
  await transaction(db, "readwrite", (store) => store.put(project, LATEST_KEY));
  db.close();
}

export async function loadLatestDraft(): Promise<Project | null> {
  const db = await openDraftDb();
  const draft = await transaction<Project | undefined>(db, "readonly", (store) => store.get(LATEST_KEY));
  db.close();
  return draft ?? null;
}

export async function clearLatestDraft(): Promise<void> {
  const db = await openDraftDb();
  await transaction(db, "readwrite", (store) => store.delete(LATEST_KEY));
  db.close();
}

export function draftSummary(project: Project): DraftSummary {
  return {
    grantName: project.grantName,
    grantCode: project.grantCode,
    fiscalYear: project.fiscalYear,
    updatedAt: project.updatedAt,
  };
}

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local draft storage."));
  });
}

function transaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = action(tx.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local draft storage failed."));
    tx.onerror = () => reject(tx.error ?? new Error("Local draft transaction failed."));
  });
}
