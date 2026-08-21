import type { ImageResultBundle, Task } from "./types";

type SessionItem = { id: string; sessionId?: string; createdAt: number };

/** Replace one session's authoritative snapshot without disturbing other sessions in the asset archive. */
export const replaceSessionSnapshot = <T extends SessionItem>(current: T[], sessionId: string, snapshot: T[]) => [
  ...current.filter((item) => item.sessionId !== sessionId),
  ...snapshot,
].sort((a, b) => b.createdAt - a.createdAt);

export const hasActiveStudioWork = (tasks: Task[], images: ImageResultBundle[]) =>
  tasks.some((task) => !["succeeded", "failed"].includes(task.status) || task.mediaStatus === "archiving")
  || images.some((result) => result.status === "generating");
