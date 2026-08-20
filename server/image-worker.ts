import { UnrecoverableError, Worker } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";
import { storeGeneratedImage } from "./generated-media.js";
import { releaseCompatibilityImageLease } from "./image-concurrency.js";
import { computeImageSize, imageModelById } from "./image-models.js";
import { imageItemFailureAction, isTerminalImageJobFailure } from "./image-retry.js";
import { downloadImageBuffer, generateSingleImage, openRouterPool } from "./openrouter.js";
import { signedObjectUrl } from "./tos.js";
import { users } from "./store.js";
import { closeWorkersWithin } from "./shutdown.js";

type ImageJobData = { taskId: string; compatibilityLease?: { userId: string; token: string } };
const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

const worker = new Worker<ImageJobData>("image-generation", async (job) => {
  let task = users.readImageGenerationTask(job.data.taskId);
  if (!task || task.status === "succeeded" || task.status === "failed") return;
  const spec = imageModelById(task.model);
  if (!spec) throw new UnrecoverableError("未知的图片模型");
  if (!openRouterPool().size) throw new UnrecoverableError("服务端尚未配置 OpenRouter API Key");
  const references = task.referenceUploadIds.map((uploadId) => {
    const media = users.readUpload(uploadId);
    if (!media || media.ownerId !== task!.ownerId || media.status !== "ready") throw new UnrecoverableError("参考素材不存在或已过期");
    return signedObjectUrl(media.objectKey, { expires: 2 * 3600, fileName: media.fileName });
  });
  const size = computeImageSize(task.ratio as Parameters<typeof computeImageSize>[0], Number(task.resolution), spec.maxSize);
  const failures: string[] = [];
  task = users.updateImageGenerationTask(task.id, { status: "running", failures, error: null, updatedAt: Date.now() })!;
  console.info(JSON.stringify({ type: "image_generation_started", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, model: task.model, count: task.requestedCount, references: references.length, healthyKeys: openRouterPool().healthyCount() }));

  let lastError: unknown;
  for (let index = 0; index < task.requestedCount; index += 1) {
    if (task.items.some((item) => item.index === index)) continue;
    try {
      const url = await generateSingleImage({ model: task.model, prompt: task.prompt, references, size });
      const buffer = await downloadImageBuffer(url);
      const contentType = url.startsWith("data:image/webp") ? "image/webp" : url.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png";
      const media = await storeGeneratedImage({ ownerId: task.ownerId, body: buffer, contentType, fileName: `generated-${index + 1}.png`, mediaId: `image-${task.id}-${index}` });
      task = users.updateImageGenerationTask(task.id, { items: [...task.items, { index, mediaId: media.id }].sort((a, b) => a.index - b.index), updatedAt: Date.now() })!;
      console.info(JSON.stringify({ type: "image_generation_item_completed", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, mediaId: media.id, index, bytes: buffer.length }));
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message.slice(0, 300) : "生成失败";
      failures.push(message);
      task = users.updateImageGenerationTask(task.id, { failures: [...failures], updatedAt: Date.now() })!;
      console.warn(JSON.stringify({ type: "image_generation_item_failed", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, index, code: (error as { code?: string }).code ?? "unknown" }));
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      const action = imageItemFailureAction(error, task.items.length > 0, finalAttempt);
      if (action === "fail") throw new UnrecoverableError(message);
      if (action === "retry") throw error;
      const missing = task.requestedCount - task.items.length;
      while (failures.length < missing) failures.push(message);
      task = users.updateImageGenerationTask(task.id, { failures: [...failures], updatedAt: Date.now() })!;
      break;
    }
  }

  if (!task.items.length) {
    throw lastError instanceof Error ? lastError : new Error("图片生成失败");
  }
  users.updateImageGenerationTask(task.id, { status: "succeeded", failures, error: null, completedAt: Date.now(), updatedAt: Date.now() });
  console.info(JSON.stringify({ type: "image_generation_completed", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, requested: task.requestedCount, ok: task.items.length, failed: failures.length }));
}, { connection, concurrency: 2, lockDuration: 120_000 });

const releaseLease = async (job?: { data: ImageJobData }) => {
  const lease = job?.data.compatibilityLease;
  if (lease) await releaseCompatibilityImageLease(lease.userId, lease.token, connection).catch(() => undefined);
};

worker.on("completed", (job) => void releaseLease(job));
worker.on("failed", async (job, error) => {
  if (!job) return;
  if (!isTerminalImageJobFailure(error, job.attemptsMade, job.opts.attempts ?? 1)) return;
  const task = users.readImageGenerationTask(job.data.taskId);
  if (task && task.status !== "succeeded") users.updateImageGenerationTask(task.id, { status: "failed", error: error.message.slice(0, 500), completedAt: Date.now(), updatedAt: Date.now() });
  await releaseLease(job);
  console.error(JSON.stringify({ type: "image_generation_failed", at: new Date().toISOString(), taskId: job.data.taskId, userId: task?.ownerId, attempts: job.attemptsMade, code: (error as { code?: string }).code ?? "unknown" }));
});

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  const graceful = await closeWorkersWithin([worker], config.shutdownGraceMs);
  console.info(JSON.stringify({ type: "worker_shutdown", at: new Date().toISOString(), worker: "image", graceful }));
  await connection.quit(); users.close(); process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
