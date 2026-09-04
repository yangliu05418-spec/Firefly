import type { StoredTask } from "./db.js";

export type TemporaryOriginalStatus = "ready" | "expired" | "unavailable";

/** Provider originals are usable only while their explicit lease is valid. */
export const temporaryOriginalStatus = (
  task: Pick<StoredTask, "status" | "sourceVideoUrl" | "sourceVideoExpiresAt">,
  now = Date.now(),
): TemporaryOriginalStatus => {
  if (task.status !== "succeeded" || !task.sourceVideoUrl || !task.sourceVideoExpiresAt) return "unavailable";
  return task.sourceVideoExpiresAt > now ? "ready" : "expired";
};

export const temporaryDownloadTarget = (
  task: Pick<StoredTask, "status" | "sourceVideoUrl" | "sourceVideoExpiresAt">,
  stableOriginalReady: boolean,
  now = Date.now(),
) => stableOriginalReady ? "tos_original" as const : temporaryOriginalStatus(task, now) === "ready" ? "temporary_original" as const : null;

export const applyDownloadResponseHeaders = (response: { setHeader(name: string, value: string): unknown }) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Vary", "Cookie");
};
