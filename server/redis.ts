import { Redis } from "ioredis";
import { Queue } from "bullmq";
import { config } from "./config.js";
import type { StoredTask } from "./db.js";
import { users } from "./store.js";

export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
export const generationQueue = new Queue("generation", { connection: redis });
export const mediaQueue = new Queue("media", { connection: redis });
export const previewQueue = new Queue("preview", { connection: redis });
export const assetQueue = new Queue("asset-ingest", { connection: redis });
export const canvasQueue = new Queue("canvas-jobs", { connection: redis });
export const imageGenerationQueue = new Queue("image-generation", { connection: redis });
export const uploadFinalizationQueue = new Queue("upload-finalization", { connection: redis });

export type ImageGenerationQueuePayload = {
  ownerId: string;
  model: string;
  prompt: string;
  ratio: string;
  resolution: string;
  count: number;
  referenceUploadIds: string[];
};

export type { StoredTask } from "./db.js";

// SQLite is the task source of truth. The former write-only Redis cache had no
// readers and could hold a durable state transition open during a Redis retry.
export const saveTask = async (task: StoredTask) => users.saveTask(task);
export const readTask = async (id: string, includeDeleted = false) => users.readTask(id, includeDeleted);

export const listTasksForUser = async (userId: string, limit = 50) => users.listTasksForUser(userId, limit);

export const migrateLegacyTasks = async () => 0;
