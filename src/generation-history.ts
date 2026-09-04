import { api } from "./api";
import type { Task } from "./types";

export const GENERATION_HISTORY_PAGE_SIZE = 100;

type GenerationPageReader = (url: string) => Promise<Task[]>;

export const readGenerationHistoryPage = (
  sessionId?: string,
  before?: Pick<Task, "id" | "createdAt">,
  readPage: GenerationPageReader = (url) => api.get<Task[]>(url),
) => {
  const query = new URLSearchParams({ pageSize: String(GENERATION_HISTORY_PAGE_SIZE) });
  if (sessionId) query.set("sessionId", sessionId);
  if (before) {
    query.set("beforeCreatedAt", String(before.createdAt));
    query.set("beforeId", before.id);
  }
  return readPage(`/api/generations?${query}`);
};

/** Read a stable keyset snapshot so long sessions are not silently truncated. */
export const listGenerationHistory = async (
  sessionId?: string,
  readPage: GenerationPageReader = (url) => api.get<Task[]>(url),
) => {
  const tasks: Task[] = [];
  const seen = new Set<string>();
  let before: Pick<Task, "id" | "createdAt"> | undefined;

  while (true) {
    const page = await readGenerationHistoryPage(sessionId, before, readPage);
    for (const task of page) {
      if (!seen.has(task.id)) { seen.add(task.id); tasks.push(task); }
    }
    if (page.length < GENERATION_HISTORY_PAGE_SIZE) break;
    const last = page.at(-1);
    if (!last || (before?.id === last.id && before.createdAt === last.createdAt)) throw new Error("生成历史分页游标没有前进");
    before = { id: last.id, createdAt: last.createdAt };
  }

  return tasks;
};
