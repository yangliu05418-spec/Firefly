import { UnrecoverableError, Worker } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";
import { shouldRecoverArchiveHandoff } from "./archive-state.js";
import { createProviderTask, getProviderTask, validateGeneration, type GenerationInput } from "./provider.js";
import { mediaQueue, readTask, saveTask } from "./redis.js";
import { AssetRegistrationRejected, isRetryableAssetRejection, prepareProviderAssets } from "./asset-registration.js";
import { users } from "./store.js";
import { closeWorkersWithin } from "./shutdown.js";
import { downloadImageBuffer, generateSingleImage, OpenRouterError } from "./openrouter.js";
import { storeGeneratedImage } from "./generated-media.js";
import { openRouterResolution } from "./image-models.js";
import { signedProviderObjectUrl } from "./tos.js";
import type { ImageGenerationQueuePayload } from "./redis.js";

const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const maxPolls = Math.ceil(6 * 3600 * 1000 / config.providerPollIntervalMs);
const archiveRecoveryBucketMs = 15 * 60 * 1000;
const outputFormatFor = (task: { request?: unknown }) => (task.request as { outputFormat?: unknown } | undefined)?.outputFormat === "mov" ? "mov" as const : "mp4" as const;

const worker = new Worker("generation", async (job) => {
  let input = validateGeneration(job.data.input) as GenerationInput;
  let task = await readTask(job.id!, true);
  if (!task || task.deletedAt) return;
  if (!task.providerId) {
    task = { ...task, status: "submitting", updatedAt: Date.now() };
    await saveTask(task);
    console.info(JSON.stringify({ type: "generation_submitting", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, attempt: job.attemptsMade + 1 }));
    if (!task.ownerId) throw new UnrecoverableError("任务缺少素材所有者信息");
    try { input = await prepareProviderAssets(input, task.ownerId); }
    catch (error) { if (error instanceof AssetRegistrationRejected && !isRetryableAssetRejection(error)) throw new UnrecoverableError(error.message); throw error; }
    task = { ...task, request: input, updatedAt: Date.now() };
    await saveTask(task);
    const created = await createProviderTask(input);
    task = { ...task, providerId: created.id, status: "running", updatedAt: Date.now() };
    await saveTask(task);
    console.info(JSON.stringify({ type: "generation_submitted", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, providerId: created.id }));
  } else if (task.status !== "running") {
    task = { ...task, status: "running", error: undefined, updatedAt: Date.now() };
    await saveTask(task);
  }
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    const current = await readTask(job.id!, true);
    if (!current || current.deletedAt) return;
    const result = await getProviderTask(task.providerId!);
    if (result.status === "succeeded") {
      const latest = await readTask(job.id!, true);
      if (!latest || latest.deletedAt) return;
      const sourceVideoUrl = result.content?.video_url;
      if (!sourceVideoUrl) throw new Error("上游未返回成片地址");
      const sourceVideoExpiresAt = Date.now() + 24 * 3600 * 1000;
      const completed = { ...latest, status: "succeeded" as const, mediaStatus: "archiving" as const, sourceVideoUrl, sourceVideoExpiresAt, updatedAt: Date.now() };
      await saveTask(completed);
      console.info(JSON.stringify({ type: "generation_succeeded", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, providerId: task.providerId }));
      if (config.mediaStorageBackend === "tos") {
        await mediaQueue.add("archive-output", { taskId: task.id, sourceUrl: sourceVideoUrl, outputFormat: input.outputFormat }, { jobId: `archive-${task.id}`, attempts: 4, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: { age: 7 * 24 * 3600 }, removeOnFail: { age: 7 * 24 * 3600 } });
      } else {
        await saveTask({ ...completed, mediaStatus: "fallback", mediaRevision: (completed.mediaRevision ?? 0) + 1 });
      }
      return;
    }
    if (result.status === "failed" || result.status === "cancelled") {
      const message = result.error?.message ?? "视频生成失败";
      if (/may contain real person/i.test(message)) throw new UnrecoverableError("参考素材检测到真人面孔。Seedance 不允许直接使用未认证真人素材，请先在 BytePlus 真人资产库完成认证并等待资产状态变为 Active。 ");
      throw new UnrecoverableError(message);
    }
    await delay(config.providerPollIntervalMs);
  }
  throw new Error("任务查询超时，可稍后通过官方任务 ID 查询");
}, { connection, concurrency: config.generationConcurrency, lockDuration: 120000 });

const imageWorker = new Worker<ImageGenerationQueuePayload>("image-generation", async (job) => {
  const task = users.readImageGeneration(job.id!);
  if (!task || task.status !== "running") return;
  const references = job.data.referenceUploadIds.map((uploadId) => {
    const media = users.readUpload(uploadId);
    if (!media || media.ownerId !== job.data.ownerId) throw new UnrecoverableError("参考素材不存在或已过期");
    return signedProviderObjectUrl(media.objectKey);
  });
  const items = [...task.items];
  const failures = [...task.failures];
  const completed = items.length + failures.length;
  console.info(JSON.stringify({ type: "image_generation_worker_started", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, completed, requested: task.requestedCount }));
  for (let index = completed; index < task.requestedCount; index += 1) {
    try {
      const url = await generateSingleImage({
        model: job.data.model,
        prompt: job.data.prompt,
        references,
        ratio: job.data.ratio,
        resolution: openRouterResolution(job.data.resolution),
      });
      const buffer = await downloadImageBuffer(url);
      const contentType = url.startsWith("data:image/webp") ? "image/webp" : url.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png";
      const extension = contentType === "image/webp" ? "webp" : contentType === "image/jpeg" ? "jpg" : "png";
      const media = await storeGeneratedImage({ ownerId: task.ownerId, body: buffer, contentType, fileName: `firefly-${index + 1}.${extension}` });
      items.push({ mediaId: media.id });
      users.updateImageGeneration(task.id, task.ownerId, { status: "running", items, failures });
      console.info(JSON.stringify({ type: "image_generation_completed", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, mediaId: media.id, index, bytes: buffer.length }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败";
      failures.push(message);
      users.updateImageGeneration(task.id, task.ownerId, { status: "running", items, failures });
      console.warn(JSON.stringify({ type: "image_generation_item_failed", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, index, status: error instanceof OpenRouterError ? error.status : undefined, message }));
    }
  }
  if (!items.length) throw new UnrecoverableError(failures[0] ?? "图片生成失败");
  users.updateImageGeneration(task.id, task.ownerId, { status: "succeeded", items, failures });
  console.info(JSON.stringify({ type: "image_generation_done", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, requested: task.requestedCount, ok: items.length, failed: failures.length }));
}, { connection, concurrency: 2, lockDuration: Math.max(240000, config.openrouterRequestTimeoutMs + 60000) });

worker.on("failed", async (job, error) => {
  if (!job?.id) return;
  if (job.attemptsMade < (job.opts.attempts ?? 1)) return;
  try {
    const task = await readTask(job.id);
    if (!task) return;
    if (shouldRecoverArchiveHandoff(task, config.mediaStorageBackend)) {
      await saveTask({ ...task, status: "succeeded", mediaStatus: "archiving", error: undefined, updatedAt: Date.now() });
      await mediaQueue.add("archive-output", { taskId: task.id, sourceUrl: task.sourceVideoUrl, outputFormat: outputFormatFor(task) }, {
        jobId: `archive-handoff-${task.id}-${Math.floor(Date.now() / archiveRecoveryBucketMs)}`,
        attempts: 4, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: { age: 24 * 3600 }, removeOnFail: { age: 24 * 3600 }
      });
      console.warn(JSON.stringify({ type: "generation_archive_handoff_recovered", at: new Date().toISOString(), taskId: task.id }));
      return;
    }
    await saveTask({ ...task, status: "failed", error: error.message, updatedAt: Date.now() });
    const canvasJob = users.readCanvasJobByProviderTask(task.id);
    if (canvasJob && canvasJob.status !== "cancelled") {
      const failed = users.updateCanvasJob(canvasJob.id, { status: "failed", error: error.message.slice(0, 500) });
      await connection.publish(`canvas:events:${canvasJob.canvasId}`, JSON.stringify({ type: "canvas_job", job: failed }));
    }
    console.error(JSON.stringify({ type: "generation_failed", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, providerId: task.providerId, attempts: job.attemptsMade, message: error.message }));
  } catch (handlerError) {
    console.error(JSON.stringify({ type: "generation_failure_handler_failed", at: new Date().toISOString(), taskId: job.id, code: (handlerError as { code?: string }).code ?? "unknown" }));
  }
});

imageWorker.on("failed", async (job, error) => {
  if (!job?.id || job.attemptsMade < (job.opts.attempts ?? 1)) return;
  try {
    const task = users.readImageGeneration(job.id);
    if (!task || task.status !== "running") return;
    users.updateImageGeneration(task.id, task.ownerId, { status: "failed", items: task.items, failures: task.failures, error: error.message.slice(0, 500) });
    console.error(JSON.stringify({ type: "image_generation_failed", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, message: error.message }));
  } catch (handlerError) {
    console.error(JSON.stringify({ type: "image_generation_failure_handler_failed", at: new Date().toISOString(), taskId: job.id, code: (handlerError as { code?: string }).code ?? "unknown" }));
  }
});

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  const graceful = await closeWorkersWithin([worker, imageWorker], config.shutdownGraceMs);
  console.info(JSON.stringify({ type: "worker_shutdown", at: new Date().toISOString(), worker: "generation", graceful }));
  await connection.quit(); users.close(); process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
