import type { ImageResultBundle, Task } from "./types";

type SessionItem = { id: string; sessionId?: string; createdAt: number };

export const selectSessionSnapshot = <TTask extends SessionItem, TImage extends SessionItem>(
  tasks: TTask[], images: TImage[], sessionId: string,
) => ({
  tasks: tasks.filter((item) => item.sessionId === sessionId),
  images: images.filter((item) => item.sessionId === sessionId),
});

/** Merge optimistic admissions and authoritative refreshes without duplicate cards. */
export const upsertStudioItem = <T extends { id: string; createdAt: number }>(current: T[], item: T) => [
  item,
  ...current.filter((candidate) => candidate.id !== item.id),
].sort((a, b) => b.createdAt - a.createdAt);

/** Replace one session's authoritative snapshot without disturbing other sessions in the asset archive. */
export const replaceSessionSnapshot = <T extends SessionItem>(current: T[], sessionId: string, snapshot: T[]) => [
  ...current.filter((item) => item.sessionId !== sessionId),
  ...snapshot,
].sort((a, b) => b.createdAt - a.createdAt);

const newestFirst = <T extends SessionItem>(a: T, b: T) => b.createdAt - a.createdAt || b.id.localeCompare(a.id);
const isOlderThan = <T extends SessionItem>(item: T, boundary: T) => item.createdAt < boundary.createdAt
  || (item.createdAt === boundary.createdAt && item.id.localeCompare(boundary.id) < 0);

/** Reconciles the authoritative first page while retaining already loaded older history. */
export const mergeGenerationHistoryHead = <T extends SessionItem>(current: T[], head: T[], pageSize: number) => {
  if (head.length < pageSize) return [...head].sort(newestFirst);
  const boundary = head.at(-1)!;
  const ids = new Set(head.map((item) => item.id));
  return [...head, ...current.filter((item) => !ids.has(item.id) && isOlderThan(item, boundary))].sort(newestFirst);
};

export const mergeSessionHistoryHead = <T extends SessionItem>(current: T[], sessionId: string, head: T[], pageSize: number) => [
  ...current.filter((item) => item.sessionId !== sessionId),
  ...mergeGenerationHistoryHead(current.filter((item) => item.sessionId === sessionId), head, pageSize),
].sort(newestFirst);

export const isVideoTaskActive = (task: Task) =>
  !["succeeded", "failed"].includes(task.status)
  || task.mediaStatus === "archiving"
  || task.previewStatus === "processing"
  || task.originalArchiveStatus === "archiving";

export const hasActiveStudioWork = (tasks: Task[], images: ImageResultBundle[]) =>
  tasks.some(isVideoTaskActive)
  || images.some((result) => result.status === "generating");

/** A write may already be committed when the response is lost; only deterministic 4xx is safe to show as rejected. */
export const isAmbiguousSubmissionFailure = (error: unknown) => {
  const candidate = error as { status?: number; code?: string } | null;
  return candidate?.status === 0 || (candidate?.status !== undefined && candidate.status >= 500)
    || candidate?.code === "CLIENT_TIMEOUT" || candidate?.code === "NETWORK_ERROR";
};

/** Reconciles a response-loss after a durable session create without reposting it. */
export const createSessionRecoverably = async <T>(create: () => Promise<T>, read: () => Promise<T>) => {
  try { return await create(); }
  catch (error) {
    if (!isAmbiguousSubmissionFailure(error)) throw error;
    return read();
  }
};
