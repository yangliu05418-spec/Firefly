export type TextRecord = { id: string; model: string; prompt: string; text: string; status: "streaming" | "completed" | "stopped" | "failed"; createdAt: number; error?: string; finishReason?: string | null };
export type TextDraft = { prompt: string; model: string; records: TextRecord[] };
const databaseName = "firefly-text-playground-v1";
const closedUsers = new Set<string>();
const deletedSessions = new Set<string>();
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("sessions");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readTextDraft(userId: string, sessionId: string): Promise<TextDraft | undefined> {
  closedUsers.delete(userId);
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction("sessions").objectStore("sessions").get(`${userId}:${sessionId}`);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
export async function saveTextDraft(userId: string, sessionId: string, draft: TextDraft) {
  if (closedUsers.has(userId) || deletedSessions.has(`${userId}:${sessionId}`)) return;
  const db = await database();
  if (closedUsers.has(userId) || deletedSessions.has(`${userId}:${sessionId}`)) { db.close(); return; }
  try { await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("sessions", "readwrite");
    transaction.objectStore("sessions").put(draft, `${userId}:${sessionId}`);
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
  }); } finally { db.close(); }
}
export async function clearTextDrafts(userId: string, sessionId?: string) {
  if (sessionId) deletedSessions.add(`${userId}:${sessionId}`);
  else closedUsers.add(userId);
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("sessions", "readwrite");
    const store = transaction.objectStore("sessions");
    if (sessionId) store.delete(`${userId}:${sessionId}`);
    else {
      const request = store.openCursor();
      request.onsuccess = () => { const cursor = request.result; if (!cursor) return; if (String(cursor.key).startsWith(`${userId}:`)) cursor.delete(); cursor.continue(); };
    }
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
  }); } finally { db.close(); }
}
export function textModeSelected(userId: string, sessionId: string) {
  try { return localStorage.getItem(`firefly:text-mode:${userId}:${sessionId}`) === "text"; } catch { return false; }
}
export function rememberTextMode(userId: string, sessionId: string, enabled: boolean) {
  try { const key = `firefly:text-mode:${userId}:${sessionId}`; if (enabled) localStorage.setItem(key, "text"); else localStorage.removeItem(key); } catch { /* preference is optional */ }
}
