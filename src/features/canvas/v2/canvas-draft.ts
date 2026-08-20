import type { CanvasDocumentV2 } from "../canvas-v2-types";

const DB_NAME = "firefly-canvas-v2";
const STORE = "drafts";
const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "canvasId" });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export type CanvasDraft = { canvasId: string; revision: number; document: CanvasDocumentV2; savedAt: number };

export const readCanvasDraft = async (canvasId: string) => {
  const database = await openDatabase();
  try {
    return await new Promise<CanvasDraft | undefined>((resolve, reject) => {
      const request = database.transaction(STORE, "readonly").objectStore(STORE).get(canvasId);
      request.onsuccess = () => resolve(request.result as CanvasDraft | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
};

export const writeCanvasDraft = async (draft: CanvasDraft) => {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(STORE, "readwrite").objectStore(STORE).put(draft);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
};

export const deleteCanvasDraft = async (canvasId: string) => {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(STORE, "readwrite").objectStore(STORE).delete(canvasId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
};
