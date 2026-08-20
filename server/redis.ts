import { Redis } from "ioredis";
import { Queue } from "bullmq";
import { config } from "./config.js";
import type { StoredTask } from "./db.js";
import { users } from "./store.js";

export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
export const generationQueue = new Queue("generation", { connection: redis });
export const mediaQueue = new Queue("media", { connection: redis });
export const imageGenerationQueue = new Queue("image-generation", { connection: redis });
export const previewQueue = new Queue("preview", { connection: redis });
export const assetQueue = new Queue("asset-ingest", { connection: redis });

export type { StoredTask } from "./db.js";

export const saveTask = async (task: StoredTask) => {
  users.saveTask(task);
  await redis.set(`task-cache:${task.id}`, JSON.stringify(task), "EX", 24 * 3600).catch((error) => {
    console.warn(JSON.stringify({ type: "task_cache_write_failed", at: new Date().toISOString(), taskId: task.id, code: (error as { code?: string }).code ?? "unknown" }));
  });
};
export const readTask = async (id: string, includeDeleted = false) => users.readTask(id, includeDeleted);

export const listTasksForUser = async (userId: string, limit = 50) => users.listTasksForUser(userId, limit);

export const migrateLegacyTasks = async () => 0;
