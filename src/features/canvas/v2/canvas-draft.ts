import type { CanvasDocumentV2 } from "../canvas-v2-types";

const DB_NAME = "firefly-canvas-v2";
const STORE = "drafts";
let databasePromise: Promise<IDBDatabase> | undefined;

const openDatabase = () => {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "canvasId" });
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = undefined;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = undefined;
      reject(request.error);
    };
  });
  return databasePromise;
};

const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error ?? new Error("本地草稿事务已中止"));
});

export type CanvasDraft = { canvasId: string; revision: number; document: CanvasDocumentV2; savedAt: number };

export const readCanvasDraft = async (canvasId: string) => {
  const database = await openDatabase();
  const transaction = database.transaction(STORE, "readonly");
  const request = transaction.objectStore(STORE).get(canvasId);
  let draft: CanvasDraft | undefined;
  request.onsuccess = () => { draft = request.result as CanvasDraft | undefined; };
  await transactionDone(transaction);
  return draft;
};

export const writeCanvasDraft = async (draft: CanvasDraft) => {
  const database = await openDatabase();
  const transaction = database.transaction(STORE, "readwrite");
  transaction.objectStore(STORE).put(draft);
  await transactionDone(transaction);
};

export const deleteCanvasDraft = async (canvasId: string) => {
  const database = await openDatabase();
  const transaction = database.transaction(STORE, "readwrite");
  transaction.objectStore(STORE).delete(canvasId);
  await transactionDone(transaction);
};
