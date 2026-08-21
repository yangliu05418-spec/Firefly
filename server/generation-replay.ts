import type { StoredTask } from "./db.js";
import { shouldRecoverArchiveHandoff } from "./archive-state.js";

export type GenerationReplayAction = "process" | "complete" | "archive";

/** Keeps durable outbox replays from regressing terminal generation tasks. */
export const generationReplayAction = (
  task: StoredTask,
  mediaStorageBackend: string,
  now = Date.now(),
): GenerationReplayAction => {
  if (task.status === "failed") return "complete";
  if (task.status !== "succeeded") return "process";
  if (task.mediaStatus !== "ready" && shouldRecoverArchiveHandoff(task, mediaStorageBackend, now)) return "archive";
  return "complete";
};
