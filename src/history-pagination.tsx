import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { CreationSession, ImageResultBundle } from "./types";

export const HISTORY_PAGE_SIZE = 100;
type Cursor = { id: string; createdAt: number };
export const readImageHistoryPage = (sessionId?: string, before?: Cursor) => {
  const query = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE) });
  if (sessionId) query.set("sessionId", sessionId);
  if (before) { query.set("beforeCreatedAt", String(before.createdAt)); query.set("beforeId", before.id); }
  return api.get<ImageResultBundle[]>(`/api/image-generations?${query}`);
};
export const readSessionPage = (before?: CreationSession) => {
  const query = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE) });
  if (before) { query.set("beforeUpdatedAt", String(before.updatedAt)); query.set("beforeId", before.id); }
  return api.get<CreationSession[]>(`/api/creation-sessions?${query}`);
};
export const appendHistory = <T extends { id: string }>(current: T[], older: T[]) => {
  const ids = new Set(current.map((item) => item.id));
  return [...current, ...older.filter((item) => !ids.has(item.id))];
};

/** Failed pages leave loaded results intact; navigation invalidates late responses. */
export function HistoryMore<T extends { id: string }>({ scope, items, read, append, label }: {
  scope: string; items: T[]; read: (before: T) => Promise<T[]>; append: (page: T[]) => void; label: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [finished, setFinished] = useState(false);
  const cursor = useRef<T | undefined>(undefined);
  const epoch = useRef(0);
  useEffect(() => { epoch.current++; cursor.current = undefined; setBusy(false); setError(false); setFinished(false); return () => { epoch.current++; }; }, [scope]);
  if (items.length < HISTORY_PAGE_SIZE || finished) return null;
  const more = async () => {
    if (busy) return;
    const version = epoch.current;
    setBusy(true); setError(false);
    try {
      const page = await read(cursor.current ?? items[HISTORY_PAGE_SIZE - 1]);
      if (version !== epoch.current) return;
      append(page); cursor.current = page.at(-1) ?? cursor.current; setFinished(page.length < HISTORY_PAGE_SIZE);
    } catch { if (version === epoch.current) setError(true); }
    finally { if (version === epoch.current) setBusy(false); }
  };
  return <div className="history-pagination"><button disabled={busy} onClick={() => void more()}>{busy ? "正在载入…" : error ? `重试载入${label}` : `加载更多${label}`}</button>{error && <span role="status">已加载的记录仍可使用</span>}</div>;
}
