import { Redis } from "ioredis";
import { Queue } from "bullmq";
import { config } from "./config.js";
import type { StoredTask } from "./db.js";
import { users } from "./store.js";
import { queueRedisOptions, requestRedisOptions } from "./redis-options.js";

export const redis = new Redis(config.redisUrl, requestRedisOptions);
export const queueConnection = new Redis(config.redisUrl, queueRedisOptions);
// Readiness and the health auditor own dependency reporting. Explicit
// listeners prevent ioredis from emitting noisy unhandled-error diagnostics
// for the same outage while both clients are reconnecting.
redis.on("error", () => undefined);
queueConnection.on("error", () => undefined);
export const generationQueue = new Queue("generation", { connection: queueConnection });
export const mediaQueue = new Queue("media", { connection: queueConnection });
export const archiveQueue = new Queue("archive", { connection: queueConnection });
export const previewQueue = new Queue("preview", { connection: queueConnection });
export const assetQueue = new Queue("asset-ingest", { connection: queueConnection });
export const canvasQueue = new Queue("canvas-jobs", { connection: queueConnection });
export const imageGenerationQueue = new Queue("image-generation", { connection: queueConnection });
export const uploadFinalizationQueue = new Queue("upload-finalization", { connection: queueConnection });

export type ImageGenerationQueuePayload = {
  ownerId: string;
  model: string;
  prompt: string;
  ratio: string;
  resolution: string;
  count: number;
  references?: { uploadId?: string; snapshotReferenceId?: string }[];
  /** Legacy queue payload retained while old jobs drain. */
  referenceUploadIds?: string[];
};

export type { StoredTask } from "./db.js";

// SQLite is the task source of truth. The former write-only Redis cache had no
// readers and could hold a durable state transition open during a Redis retry.
export const saveTask = async (task: StoredTask) => users.saveTask(task);
export const readTask = async (id: string, includeDeleted = false) => users.readTask(id, includeDeleted);

export const listTasksForUser = async (userId: string, limit = 50) => users.listTasksForUser(userId, limit);

export const migrateLegacyTasks = async () => 0;
