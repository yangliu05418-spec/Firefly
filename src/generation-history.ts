import { api } from "./api";
import type { Task } from "./types";

const PAGE_SIZE = 100;

type GenerationPageReader = (url: string) => Promise<Task[]>;

/** Read a stable keyset snapshot so long sessions are not silently truncated. */
export const listGenerationHistory = async (
  sessionId?: string,
  readPage: GenerationPageReader = (url) => api.get<Task[]>(url),
) => {
  const tasks: Task[] = [];
  const seen = new Set<string>();
  let before: Pick<Task, "id" | "createdAt"> | undefined;

  while (true) {
    const query = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (sessionId) query.set("sessionId", sessionId);
    if (before) {
      query.set("beforeCreatedAt", String(before.createdAt));
      query.set("beforeId", before.id);
    }
    const page = await readPage(`/api/generations?${query}`);
    for (const task of page) {
      if (!seen.has(task.id)) { seen.add(task.id); tasks.push(task); }
    }
    if (page.length < PAGE_SIZE) break;
    const last = page.at(-1);
    if (!last || (before?.id === last.id && before.createdAt === last.createdAt)) throw new Error("生成历史分页游标没有前进");
    before = { id: last.id, createdAt: last.createdAt };
  }

  return tasks;
};
