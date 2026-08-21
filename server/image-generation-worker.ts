import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { config } from "./config.js";
import { processImageGenerationAttempt, shouldFinalizeImageGenerationFailure } from "./image-generation-processor.js";
import type { ImageGenerationQueuePayload } from "./redis.js";
import { users } from "./store.js";

/**
 * The image queue has an independent processor and concurrency budget while
 * sharing the existing generation container until the host deployment
 * contract is bootstrapped with a dedicated image-worker role.
 */
export const createImageGenerationWorker = (connection: Redis) => {
  const worker = new Worker<ImageGenerationQueuePayload>("image-generation", async (job) => {
    await processImageGenerationAttempt({
      id: job.id!,
      data: job.data,
      attemptNumber: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts ?? 1,
    });
  }, { connection, concurrency: 2, lockDuration: Math.max(240000, config.openrouterRequestTimeoutMs + 60000) });

  worker.on("failed", async (job, error) => {
    if (!job?.id || !shouldFinalizeImageGenerationFailure(error, job.attemptsMade, job.opts.attempts ?? 1)) return;
    try {
      const task = users.readImageGeneration(job.id);
      if (!task || task.status !== "running") return;
      users.updateImageGeneration(task.id, task.ownerId, {
        status: "failed",
        items: task.items,
        failures: task.failures,
        error: error.message.slice(0, 500),
      });
      console.error(JSON.stringify({
        type: "image_generation_failed", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId,
        attempts: job.attemptsMade, message: error.message,
      }));
    } catch (handlerError) {
      console.error(JSON.stringify({ type: "image_generation_failure_handler_failed", at: new Date().toISOString(), taskId: job.id, code: (handlerError as { code?: string }).code ?? "unknown" }));
    }
  });

  return worker;
};
