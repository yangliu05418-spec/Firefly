import { UnrecoverableError, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";
import { shouldRecoverArchiveHandoff } from "./archive-state.js";
import type { StoredTask } from "./db.js";
import { classifyProviderError, ProviderRequestError, validateGeneration, type GenerationInput } from "./provider.js";
import { archiveQueue, previewQueue, readTask, saveTask } from "./redis.js";
import { AssetRegistrationRejected, isRetryableAssetRejection, prepareProviderAssets } from "./asset-registration.js";
import { users } from "./store.js";
import { closeWorkersWithin } from "./shutdown.js";
import { shouldFinalizeJobFailure } from "./job-failure.js";
import { startWorkerHeartbeat } from "./worker-heartbeat.js";
import { resolveCanvasGenerationReferences } from "./canvas-project-assets.js";
import { submitProviderTaskOnce } from "./generation-submission.js";
import { pollProviderTaskUntilTerminal, ProviderPollingTerminalError } from "./provider-polling.js";
import { generationReplayAction } from "./generation-replay.js";
import { canKeepPreparingReference, UploadReferencePendingError } from "./asset-upload-admission.js";
import { requeueExhaustedAsyncJob } from "./async-job-outbox.js";
import { AssetApiError } from "./asset-api.js";
import { resolveCreationSnapshotReferences } from "./creation-reference-media.js";
import { AtlasStore } from "./atlas-store.js";
import { signedProviderObjectUrl } from "./tos.js";

const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const atlasStore = new AtlasStore(config.databasePath);
const archiveRecoveryBucketMs = 15 * 60 * 1000;
const outputFormatFor = (task: { request?: unknown }) => (task.request as { outputFormat?: unknown } | undefined)?.outputFormat === "mov" ? "mov" as const : "mp4" as const;
const enqueueArchiveHandoff = async (task: StoredTask) => {
  if (!shouldRecoverArchiveHandoff(task, config.mediaStorageBackend)) return false;
  const archiving = { ...task, status: "succeeded" as const, mediaStatus: "archiving" as const, error: undefined, errorCode: undefined, updatedAt: Date.now() };
  await saveTask(archiving);
  await archiveQueue.add("archive-output", { taskId: task.id, sourceUrl: task.sourceVideoUrl, outputFormat: outputFormatFor(task) }, {
    jobId: `archive-handoff-${task.id}-${Math.floor(Date.now() / archiveRecoveryBucketMs)}`,
    priority: 1, attempts: 4, backoff: { type: "exponential", delay: 5000, jitter: .5 }, removeOnComplete: { age: 24 * 3600 }, removeOnFail: { age: 24 * 3600 }
  });
  return true;
};

const processGenerationJob = async (job: Job<{ input: unknown }>) => {
  let input = validateGeneration(job.data.input) as GenerationInput;
  let task = await readTask(job.id!, true);
  if (!task || task.deletedAt) return;
  const replayAction = generationReplayAction(task, config.mediaStorageBackend);
  if (replayAction === "complete") return;
  if (replayAction === "archive") {
    await enqueueArchiveHandoff(task);
    console.warn(JSON.stringify({ type: "generation_archive_handoff_replayed", at: new Date().toISOString(), taskId: task.id }));
    return;
  }
  if (!task.providerId) {
    if (task.status === "submitting") {
      await submitProviderTaskOnce(task, input, { save: saveTask });
      return;
    }
    if (!task.ownerId) throw new UnrecoverableError("任务缺少素材所有者信息");
    const ownerId = task.ownerId;
    input = resolveCreationSnapshotReferences(input, ownerId);
    input = resolveCanvasGenerationReferences(input, ownerId);
    input = {
      ...input,
      assets: input.assets.map((asset) => {
        if (!asset.atlasProjectAssetId) return asset;
        const projectAsset = atlasStore.readAsset(asset.atlasProjectAssetId, ownerId);
        if (!projectAsset || projectAsset.status !== "ready" || projectAsset.kind !== asset.type) {
          throw new UnrecoverableError("Atlas项目素材不存在、尚未就绪或类型不匹配");
        }
        return { ...asset, url: signedProviderObjectUrl(projectAsset.objectKey) };
      }),
    };
    try { input = await prepareProviderAssets(input, ownerId); }
    catch (error) {
      console.warn(JSON.stringify({
        type: "generation_reference_prepare_failed",
        at: new Date().toISOString(),
        taskId: task.id,
        userId: task.ownerId,
        attempt: job.attemptsMade + 1,
        providerAction: error instanceof AssetApiError ? error.action : undefined,
        providerCode: error instanceof AssetApiError ? error.providerCode : (error as { code?: string }).code,
        providerStatus: error instanceof AssetApiError ? error.status : undefined,
        retryable: error instanceof AssetApiError ? error.retryable : undefined
      }));
      if (error instanceof AssetRegistrationRejected && !isRetryableAssetRejection(error)) throw new UnrecoverableError(error.message);
      if (error instanceof AssetApiError && !error.retryable) throw new UnrecoverableError(error.message);
      throw error;
    }
    console.info(JSON.stringify({ type: "generation_submitting", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, attempt: job.attemptsMade + 1 }));
    task = await submitProviderTaskOnce(task, input, { save: saveTask });
    console.info(JSON.stringify({ type: "generation_submitted", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, providerId: task.providerId }));
  } else if (task.status !== "running") {
    task = { ...task, status: "running", error: undefined, errorCode: undefined, updatedAt: Date.now() };
    await saveTask(task);
  }
  let result;
  try {
    result = await pollProviderTaskUntilTerminal({
      providerId: task.providerId!,
      deadlineAt: task.updatedAt + 6 * 3600 * 1000,
      pollIntervalMs: config.providerPollIntervalMs,
      shouldContinue: async () => {
        const current = await readTask(job.id!, true);
        return Boolean(current && !current.deletedAt);
      },
      onRetry: ({ error, consecutiveFailures, delayMs }) => {
        console.warn(JSON.stringify({
          type: "generation_poll_retry",
          at: new Date().toISOString(),
          taskId: task.id,
          userId: task.ownerId,
          providerId: task.providerId,
          consecutiveFailures,
          delayMs,
          status: (error as { status?: unknown }).status,
          message: error instanceof Error ? error.message.slice(0, 300) : undefined,
        }));
      },
    });
  } catch (error) {
    if (error instanceof ProviderPollingTerminalError) {
      const cause = error.cause;
      if (cause instanceof ProviderRequestError) throw Object.assign(new UnrecoverableError(cause.message), { errorCode: cause.errorCode, providerCode: cause.providerCode, providerRequestId: cause.requestId, providerStage: cause.stage });
      throw Object.assign(new UnrecoverableError("模型任务状态查询失败，请稍后重试"), { errorCode: "PROVIDER_UNKNOWN_ERROR", providerStage: "query" });
    }
    throw error;
  }
  if (!result) return;
  if (result.status === "succeeded") {
    const latest = await readTask(job.id!, true);
    if (!latest || latest.deletedAt) return;
    const sourceVideoUrl = result.content?.video_url;
    if (!sourceVideoUrl) throw new UnrecoverableError("上游未返回成片地址");
    const sourceVideoExpiresAt = Date.now() + 24 * 3600 * 1000;
    const completed = { ...latest, status: "succeeded" as const, mediaStatus: "archiving" as const, sourceVideoUrl, sourceVideoExpiresAt, error: undefined, errorCode: undefined, updatedAt: Date.now() };
    await saveTask(completed);
    console.info(JSON.stringify({ type: "generation_succeeded", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, providerId: task.providerId }));
    if (config.mediaStorageBackend === "tos") {
      await Promise.all([
        archiveQueue.add("archive-output", { taskId: task.id, sourceUrl: sourceVideoUrl, outputFormat: input.outputFormat }, { jobId: `archive-${task.id}`, priority: 1, attempts: 4, backoff: { type: "exponential", delay: 5000, jitter: .5 }, removeOnComplete: { age: 7 * 24 * 3600 }, removeOnFail: { age: 7 * 24 * 3600 } }),
        config.tosPreviewTranscodeEnabled
          ? previewQueue.add("create-preview", { taskId: task.id, sourceUrl: sourceVideoUrl }, { jobId: `preview-source-${task.id}`, attempts: 3, backoff: { type: "exponential", delay: 15_000, jitter: .5 }, priority: 1, removeOnComplete: { age: 24 * 3600 }, removeOnFail: { age: 7 * 24 * 3600 } })
          : Promise.resolve(),
      ]);
    } else {
      await saveTask({ ...completed, mediaStatus: "fallback", mediaRevision: (completed.mediaRevision ?? 0) + 1 });
    }
    return;
  }
  if (result.status === "failed" || result.status === "cancelled" || result.status === "expired") {
    const classified = classifyProviderError(result.error?.message ?? "provider generation failed", 400, result.error?.code);
    throw Object.assign(new UnrecoverableError(classified.publicMessage), { errorCode: classified.errorCode, providerCode: result.error?.code, providerRequestId: result.error?.request_id, providerStage: "query" });
  }
  throw new UnrecoverableError(`上游返回未知任务状态：${result.status}`);
};

const worker = new Worker<{ input: unknown }>("generation", async (job) => {
  await processGenerationJob(job);
  users.completeAsyncJobIntent("generation", job.id!);
}, { connection, concurrency: config.generationConcurrency, lockDuration: 120000 });

await worker.waitUntilReady();
const heartbeat = await startWorkerHeartbeat(connection, "generation");

worker.on("failed", async (job, error) => {
  if (!job?.id) return;
  if (!shouldFinalizeJobFailure(error, job.attemptsMade, job.opts.attempts ?? 1)) return;
  try {
    const task = await readTask(job.id);
    if (!task) return;
    const referencePending = error instanceof UploadReferencePendingError
      || error instanceof AssetRegistrationRejected && isRetryableAssetRejection(error);
    if (referencePending && canKeepPreparingReference(task.createdAt)) {
      const requeued = await requeueExhaustedAsyncJob(users, "generation", job);
      console.info(JSON.stringify({ type: "generation_waiting_for_reference", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, attempts: job.attemptsMade, requeued }));
      return;
    }
    if (shouldRecoverArchiveHandoff(task, config.mediaStorageBackend)) {
      await enqueueArchiveHandoff(task);
      console.warn(JSON.stringify({ type: "generation_archive_handoff_recovered", at: new Date().toISOString(), taskId: task.id }));
      users.completeAsyncJobIntent("generation", job.id);
      return;
    }
    const message = referencePending ? "参考素材长时间未能准备完成，请重新上传后再试" : error.message;
    const errorCode = (error as { errorCode?: string }).errorCode ?? (referencePending ? "REFERENCE_ASSET_REJECTED" : "PROVIDER_UNKNOWN_ERROR");
    await saveTask({ ...task, status: "failed", error: message, errorCode, updatedAt: Date.now() });
    const canvasJob = users.readCanvasJobByProviderTask(task.id);
    if (canvasJob && canvasJob.status !== "cancelled") {
      const failed = users.transitionActiveCanvasJob(canvasJob.id, { status: "failed", error: message.slice(0, 500) });
      if (failed) await connection.publish(`canvas:events:${canvasJob.canvasId}`, JSON.stringify({ type: "canvas_job", job: failed }));
    }
    console.error(JSON.stringify({ type: "generation_failed", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, providerId: task.providerId, attempts: job.attemptsMade, errorCode, providerCode: (error as { providerCode?: string }).providerCode, providerRequestId: (error as { providerRequestId?: string }).providerRequestId, providerStage: (error as { providerStage?: string }).providerStage }));
    users.completeAsyncJobIntent("generation", job.id);
  } catch (handlerError) {
    console.error(JSON.stringify({ type: "generation_failure_handler_failed", at: new Date().toISOString(), taskId: job.id, code: (handlerError as { code?: string }).code ?? "unknown" }));
  }
});

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await heartbeat.stop();
  const graceful = await closeWorkersWithin([worker], config.shutdownGraceMs);
  console.info(JSON.stringify({ type: "worker_shutdown", at: new Date().toISOString(), worker: "generation", graceful }));
  await connection.quit(); atlasStore.close(); users.close(); process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
