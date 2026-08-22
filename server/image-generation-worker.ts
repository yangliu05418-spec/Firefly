import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { config } from "./config.js";
import { processImageGenerationAttempt } from "./image-generation-processor.js";
import { shouldFinalizeJobFailure } from "./job-failure.js";
import type { ImageGenerationQueuePayload } from "./redis.js";
import { users } from "./store.js";
import { canKeepPreparingReference, UploadReferencePendingError } from "./asset-upload-admission.js";
import { requeueExhaustedAsyncJob } from "./async-job-outbox.js";

export const createImageGenerationWorker = (connection: Redis) => {
  const worker = new Worker<ImageGenerationQueuePayload>("image-generation", async (job) => {
    await processImageGenerationAttempt({
      id: job.id!,
      data: job.data,
      attemptNumber: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts ?? 1,
    });
    users.completeAsyncJobIntent("image-generation", job.id!);
  }, { connection, concurrency: 2, lockDuration: Math.max(240000, config.openrouterRequestTimeoutMs + 60000) });

  worker.on("failed", async (job, error) => {
    if (!job?.id || !shouldFinalizeJobFailure(error, job.attemptsMade, job.opts.attempts ?? 1)) return;
    try {
      const task = users.readImageGeneration(job.id);
      if (!task || task.status !== "running") return;
      if (error instanceof UploadReferencePendingError && canKeepPreparingReference(task.createdAt)) {
        const requeued = await requeueExhaustedAsyncJob(users, "image-generation", job);
        console.info(JSON.stringify({ type: "image_generation_waiting_for_reference", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, attempts: job.attemptsMade, requeued }));
        return;
      }
      const message = error instanceof UploadReferencePendingError ? "参考素材长时间未能准备完成，请重新上传后再试" : error.message;
      users.updateImageGeneration(task.id, task.ownerId, {
        status: "failed",
        items: task.items,
        failures: task.failures,
        error: message.slice(0, 500),
      });
      users.completeAsyncJobIntent("image-generation", job.id);
      console.error(JSON.stringify({
        type: "image_generation_failed", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId,
        attempts: job.attemptsMade, message,
      }));
    } catch (handlerError) {
      console.error(JSON.stringify({ type: "image_generation_failure_handler_failed", at: new Date().toISOString(), taskId: job.id, code: (handlerError as { code?: string }).code ?? "unknown" }));
    }
  });

  return worker;
};
