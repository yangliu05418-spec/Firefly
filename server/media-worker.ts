import crypto from "node:crypto";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";
import { users } from "./store.js";
import { assetQueue, mediaQueue, previewQueue, readTask, saveTask, uploadFinalizationQueue } from "./redis.js";
import { createPoster, deleteObject, fetchObjectFromUrl, optimizePlaybackObject, outputObjectKey, posterObjectKey, previewObjectKey, streamObjectFromUrl, verifyProgressiveMp4, verifyStoredObject } from "./tos.js";
import { MAX_MEDIA_RECOVERY_ATTEMPTS } from "./db.js";
import { transcodePreview } from "./preview-transcode.js";
import { closeWorkersWithin } from "./shutdown.js";
import { AssetCreateUnknownError, AssetUploadPendingError, markAssetIngestFailed, registerQueuedAsset } from "./asset-ingest.js";
import { deleteQueuedProviderAsset } from "./asset-cleanup.js";
import { CanvasAssetUploadPendingError, copyPreparedCanvasAsset } from "./canvas-assets.js";
import { startWorkerHeartbeat } from "./worker-heartbeat.js";
import { finalizeQueuedUpload } from "./upload-finalization.js";
import { coordinateUploadFinalization } from "./upload-finalization-coordinator.js";
import { copyCreationSnapshotReference, deleteCreationSnapshotReference } from "./creation-reference-media.js";
import { archiveTransferStrategy } from "./archive-state.js";

const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const numberHeader = (value: unknown) => Number(value ?? 0) || 0;
const recoveryBucketMs = 15 * 60 * 1000;
const posterRecoveryBucketMs = 15 * 60 * 1000;
const previewRecoveryBucketMs = 15 * 60 * 1000;
const uploadFinalizationDeadlineMs = 15 * 60 * 1000;

const outputFormatFor = (task: { request?: unknown }) => (task.request as { outputFormat?: unknown } | undefined)?.outputFormat === "mov" ? "mov" as const : "mp4" as const;
const enqueuePosterRecovery = async (taskId: string) => mediaQueue.add("create-poster", { taskId }, {
  jobId: `poster-recovery-${taskId}-${Math.floor(Date.now() / posterRecoveryBucketMs)}`, attempts: 5, backoff: { type: "exponential", delay: 10_000 },
  removeOnComplete: true, removeOnFail: { age: 24 * 3600 }
});
const enqueuePreviewRecovery = async (taskId: string) => {
  if (!config.tosPreviewTranscodeEnabled) return false;
  await previewQueue.add("create-preview", { taskId }, {
    jobId: `preview-recovery-${taskId}-${Math.floor(Date.now() / previewRecoveryBucketMs)}`, attempts: 3, backoff: { type: "exponential", delay: 15_000 },
    priority: 10,
    removeOnComplete: { age: 24 * 3600 }, removeOnFail: { age: 24 * 3600 }
  });
  return true;
};
const enqueueLivePreview = async (taskId: string) => {
  if (!config.tosPreviewTranscodeEnabled) return false;
  await previewQueue.add("create-preview", { taskId }, {
    jobId: `preview-live-${taskId}-${Math.floor(Date.now() / previewRecoveryBucketMs)}`,
    attempts: 3, backoff: { type: "exponential", delay: 15_000 }, priority: 1,
    removeOnComplete: { age: 24 * 3600 }, removeOnFail: { age: 24 * 3600 }
  });
  return true;
};
const finalizeCanvasVideoPreview = async (taskId: string) => {
  users.updateCanvasProjectAssetStatusBySource("generation", taskId, "ready");
  const canvasJob = users.readCanvasJobByProviderTask(taskId);
  if (!canvasJob || canvasJob.status === "cancelled") return;
  const projectAsset = users.readCanvasProjectAssetBySource(canvasJob.canvasId, "generation", taskId);
  if (!projectAsset) return;
  const completedJob = users.transitionActiveCanvasJob(canvasJob.id, { status: "succeeded", resultAssetId: projectAsset.id, error: null });
  if (completedJob) await connection.publish(`canvas:events:${canvasJob.canvasId}`, JSON.stringify({ type: "canvas_job", job: completedJob }));
};

const createTaskPreview = async (taskId: string) => {
  if (!config.tosPreviewTranscodeEnabled) return false;
  const task = await readTask(taskId, true);
  if (!task || task.deletedAt || !task.ownerId) return false;
  if (users.readTaskMedia(taskId, "preview")) { await finalizeCanvasVideoPreview(taskId); return true; }
  const output = users.readTaskMedia(taskId, "output");
  if (!output) return false;
  const startedAt = Date.now();
  const previewKey = previewObjectKey(task.ownerId, task.id);
  console.info(JSON.stringify({ type: "tos_preview_started", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, sourceBytes: output.size }));
  let mediaVerified = false;
  try {
    const previewHead = await transcodePreview(
      output.objectKey,
      previewKey,
      (partNumber, bytes, requestId) => console.info(JSON.stringify({ type: "tos_preview_part_completed", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, partNumber, bytes, requestId })),
      {
        jobCreated: (jobId, requestId) => console.info(JSON.stringify({ type: "tos_preview_transcode_created", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, jobId, requestId })),
        stateChanged: (jobId, state, code, message, requestId) => console.info(JSON.stringify({ type: "tos_preview_transcode_state", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, jobId, state, code, message, requestId }))
      }
    );
    const optimized = await optimizePlaybackObject(previewKey, { contentType: "video/mp4", fileName: "preview.mp4", cacheSeconds: config.tosPreviewTtlSeconds });
    const structure = await verifyProgressiveMp4(previewKey); mediaVerified = true;
    const previewData = optimized.data as unknown as { contentLength?: number; etag?: string };
    const previewHeaders = optimized.headers as Record<string, string | undefined>;
    const now = Date.now();
    const size = numberHeader(previewData.contentLength ?? previewHeaders["content-length"]);
    const committed = users.commitTaskMediaIfActive(task.id, { id: `${task.id}:preview`, ownerId: task.ownerId, taskId: task.id, kind: "preview", objectKey: previewKey, status: "ready", fileName: "preview.mp4", contentType: "video/mp4", size, etag: String(previewData.etag ?? previewHeaders.etag ?? "").replace(/^"|"$/g, ""), createdAt: now, updatedAt: now });
    if (!committed) { await deleteObject(previewKey); return false; }
    await finalizeCanvasVideoPreview(task.id);
    console.info(JSON.stringify({ type: "tos_preview_completed", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, sourceBytes: output.size, previewBytes: size, ratio: output.size ? Number((size / output.size).toFixed(3)) : undefined, atoms: structure.atoms, elapsedMs: Date.now() - startedAt, requestId: previewHead.requestId }));
    return true;
  } catch (error) {
    if (!mediaVerified) await deleteObject(previewKey).catch(() => undefined);
    throw error;
  }
};

const createTaskPoster = async (taskId: string) => {
  const task = await readTask(taskId, true);
  if (!task || task.deletedAt || !task.ownerId) return false;
  if (users.readTaskMedia(taskId, "poster")) return true;
  const output = users.readTaskMedia(taskId, "output");
  if (!output) return false;
  const startedAt = Date.now();
  const posterKey = posterObjectKey(task.ownerId, task.id);
  await createPoster(output.objectKey, posterKey);
  const posterHead = await optimizePlaybackObject(posterKey, { contentType: "image/webp", fileName: "poster.webp", cacheSeconds: 86400 });
  const posterData = posterHead.data as unknown as { contentLength?: number; etag?: string };
  const posterHeaders = posterHead.headers as Record<string, string | undefined>;
  const now = Date.now();
  const committed = users.commitTaskMediaIfActive(task.id, { id: `${task.id}:poster`, ownerId: task.ownerId, taskId: task.id, kind: "poster", objectKey: posterKey, status: "ready", fileName: "poster.webp", contentType: "image/webp", size: numberHeader(posterData.contentLength ?? posterHeaders["content-length"]), etag: String(posterData.etag ?? posterHeaders.etag ?? "").replace(/^"|"$/g, ""), createdAt: now, updatedAt: now });
  if (!committed) { await deleteObject(posterKey); return false; }
  console.info(JSON.stringify({ type: "tos_poster_completed", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, elapsedMs: Date.now() - startedAt, requestId: posterHead.requestId }));
  return true;
};

const enqueueArchiveRecovery = async (task: { id: string; sourceVideoUrl?: string; sourceVideoExpiresAt?: number; request?: unknown }, delay = 0, existingObjectOnly = false) => {
  if (!existingObjectOnly && (!task.sourceVideoUrl || !task.sourceVideoExpiresAt || task.sourceVideoExpiresAt <= Date.now() + delay + 5 * 60 * 1000)) return false;
  const bucket = Math.floor((Date.now() + delay) / recoveryBucketMs);
  await mediaQueue.add("archive-output", { taskId: task.id, sourceUrl: existingObjectOnly ? undefined : task.sourceVideoUrl, outputFormat: outputFormatFor(task), existingObjectOnly }, {
    jobId: `${existingObjectOnly ? "archive-stored-recovery" : "archive-recovery"}-${task.id}-${bucket}`, delay, attempts: existingObjectOnly ? 2 : 4, backoff: { type: "exponential", delay: 5000, jitter: .5 },
    removeOnComplete: { age: 24 * 3600 }, removeOnFail: { age: 24 * 3600 }
  });
  console.info(JSON.stringify({ type: "tos_recovery_queued", at: new Date().toISOString(), taskId: task.id, delay, strategy: existingObjectOnly ? "existing_object" : "provider_source" }));
  return true;
};

const archiveOutput = async (data: { taskId: string; sourceUrl?: string; outputFormat: "mp4" | "mov"; existingObjectOnly?: boolean }, attempt: number) => {
  const task = await readTask(data.taskId, true);
  if (!task || task.deletedAt || !task.ownerId) return;
  if (task.mediaStatus !== "archiving") await saveTask({ ...task, mediaStatus: "archiving", error: undefined, updatedAt: Date.now() });
  const startedAt = Date.now();
  const objectKey = outputObjectKey(task.ownerId, task.id, data.outputFormat);
  const strategy = archiveTransferStrategy(attempt, data.existingObjectOnly);
  console.info(JSON.stringify({ type: "tos_fetch_started", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, attempt, strategy }));
  try {
    if (data.existingObjectOnly) {
      await verifyStoredObject(objectKey, data.outputFormat === "mov" ? "video/quicktime" : "video/mp4");
    } else if (!data.sourceUrl) {
      throw new Error("上游临时地址已过期，且 TOS 中没有可恢复的成片");
    } else if (strategy === "stream_multipart") {
      await streamObjectFromUrl(objectKey, data.sourceUrl, `result.${data.outputFormat}`, data.outputFormat === "mov" ? "video/quicktime" : "video/mp4", (partNumber, bytes) => console.info(JSON.stringify({ type: "tos_stream_part_completed", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, attempt, partNumber, bytes })), 5 * 1024 * 1024);
    } else {
      await fetchObjectFromUrl(objectKey, data.sourceUrl, {
        taskCreated: (fetchTaskId) => {
          console.info(JSON.stringify({ type: "tos_fetch_task_created", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, attempt, fetchTaskId }));
          void readTask(task.id, true).then((current) => {
            if (current && !current.deletedAt) return saveTask({ ...current, fetchTaskId, updatedAt: Date.now() });
          }).catch((error) => console.warn(JSON.stringify({ type: "tos_fetch_trace_persist_failed", at: new Date().toISOString(), taskId: task.id, code: (error as { code?: string }).code ?? "unknown" })));
        },
        stateChanged: (fetchTaskId, state, error) => console.info(JSON.stringify({ type: "tos_fetch_task_state", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, attempt, fetchTaskId, state, error: error || undefined }))
      }, task.fetchTaskId);
    }
    const head = await optimizePlaybackObject(objectKey, { contentType: data.outputFormat === "mov" ? "video/quicktime" : "video/mp4", fileName: `result.${data.outputFormat}`, cacheSeconds: config.tosPreviewTtlSeconds });
    const dataOut = head.data as unknown as { contentLength?: number; etag?: string; contentType?: string };
    const headers = head.headers as Record<string, string | undefined>;
    const now = Date.now();
    const size = numberHeader(dataOut.contentLength ?? headers["content-length"]);
    const etag = String(dataOut.etag ?? headers.etag ?? "").replace(/^"|"$/g, "");
    const contentType = String(dataOut.contentType ?? headers["content-type"] ?? (data.outputFormat === "mov" ? "video/quicktime" : "video/mp4"));
    const committed = users.commitTaskMediaIfActive(task.id, { id: `${task.id}:output`, ownerId: task.ownerId, taskId: task.id, kind: "output", objectKey, status: "ready", fileName: `result.${data.outputFormat}`, contentType, size, etag, createdAt: now, updatedAt: now }, true);
    if (!committed) { await deleteObject(objectKey); return; }
    let posterReady = false;
    try {
      posterReady = await createTaskPoster(task.id);
    } catch (error) {
      console.warn(JSON.stringify({ type: "tos_poster_failed", at: new Date().toISOString(), taskId: task.id, code: (error as { code?: string }).code ?? "unknown" }));
      await enqueuePosterRecovery(task.id).catch(() => undefined);
    }
    const canvasJob = users.readCanvasJobByProviderTask(task.id);
    if (canvasJob && canvasJob.status !== "cancelled" && canvasJob.ownerId === task.ownerId) {
      const attached = users.attachCanvasProjectAssetToActiveJob(canvasJob.id, {
        id: `canvas-project-asset-${crypto.randomUUID()}`,
        ownerId: canvasJob.ownerId,
        canvasId: canvasJob.canvasId,
        kind: "video",
        sourceType: "generation",
        sourceId: task.id,
        title: task.prompt.slice(0, 80) || "生成视频",
        contentType,
        size,
        status: config.tosPreviewTranscodeEnabled ? "copying" : "ready",
        createdAt: now,
        updatedAt: now,
      }, !config.tosPreviewTranscodeEnabled);
      if (attached && !config.tosPreviewTranscodeEnabled) await connection.publish(`canvas:events:${canvasJob.canvasId}`, JSON.stringify({ type: "canvas_job", job: attached.job }));
    }
    await enqueueLivePreview(task.id).catch((error) => console.warn(JSON.stringify({ type: "tos_preview_queue_failed", at: new Date().toISOString(), taskId: task.id, code: (error as { code?: string }).code ?? "unknown" })));
    console.info(JSON.stringify({ type: "tos_fetch_completed", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, attempt, strategy, size, posterReady, elapsedMs: Date.now() - startedAt, requestId: head.requestId }));
  } catch (error) {
    const current = await readTask(task.id, true);
    if (current && !current.deletedAt) {
      const trace = { phase: strategy, code: (error as { code?: string }).code ?? "unknown", statusCode: (error as { statusCode?: number }).statusCode ?? null, message: error instanceof Error ? error.message.slice(0, 500) : undefined, elapsedMs: Date.now() - startedAt };
      await saveTask({ ...current, mediaStatus: "archiving", mediaLastError: JSON.stringify(trace), updatedAt: Date.now() });
    }
    console.warn(JSON.stringify({ type: "tos_fetch_failed", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, attempt, strategy, elapsedMs: Date.now() - startedAt, code: (error as { code?: string }).code ?? "unknown", statusCode: (error as { statusCode?: number }).statusCode, message: error instanceof Error ? error.message : undefined }));
    throw error;
  }
};

const deleteCanvasAssets = async (canvasId?: string) => {
  const canvases = canvasId ? [canvasId] : users.canvasesPendingAssetCleanup(20);
  let firstError: unknown;
  for (const id of canvases) {
    const assets = users.listCanvasAssetsByCanvas(id);
    for (const asset of assets) {
      try {
        await deleteObject(asset.objectKey);
        users.softDeleteCanvasAsset(asset.id, asset.ownerId);
        console.info(JSON.stringify({ type: "canvas_asset_deleted", at: new Date().toISOString(), canvasId: id, assetId: asset.id, userId: asset.ownerId }));
      } catch (error) {
        console.warn(JSON.stringify({ type: "canvas_asset_delete_failed", at: new Date().toISOString(), canvasId: id, assetId: asset.id, code: (error as { code?: string }).code ?? "unknown" }));
        firstError ??= error;
      }
    }
  }
  if (firstError) throw firstError;
};

const deletePendingMedia = async (taskId?: string) => {
  const pending = users.pendingMediaDeletes(100).filter((media) => !taskId || media.taskId === taskId);
  let firstError: unknown;
  for (const media of pending) {
    try {
      await deleteObject(media.objectKey);
      users.markMediaDeleted(media.id);
      console.info(JSON.stringify({ type: "tos_delete_completed", at: new Date().toISOString(), taskId: media.taskId, userId: media.ownerId, kind: media.kind }));
    } catch (error) {
      console.warn(JSON.stringify({ type: "tos_delete_failed", at: new Date().toISOString(), taskId: media.taskId, userId: media.ownerId, kind: media.kind, code: (error as { code?: string }).code ?? "unknown" }));
      firstError ??= error;
    }
  }
  const references = users.pendingCreationReferenceDeletes(100).filter((reference) => !taskId || reference.sourceId === taskId);
  for (const reference of references) {
    try { await deleteCreationSnapshotReference(reference.id); }
    catch (error) {
      console.warn(JSON.stringify({ type: "reedit_reference_delete_failed", at: new Date().toISOString(), taskId: reference.sourceId, sourceType: reference.sourceType, userId: reference.ownerId, referenceId: reference.id, code: (error as { code?: string }).code ?? "unknown" }));
      firstError ??= error;
    }
  }
  if (firstError) throw firstError;
};

const worker = new Worker("media", async (job) => {
  if (job.name === "archive-output") {
    const attempt = job.attemptsMade + 1;
    return archiveOutput(job.data, attempt);
  }
  if (job.name === "delete-task-media") return deletePendingMedia(job.data.taskId);
  if (job.name === "reconcile-deletes") return deletePendingMedia();
  if (job.name === "create-poster") return createTaskPoster(job.data.taskId);
  if (job.name === "delete-canvas-assets") return deleteCanvasAssets(job.data.canvasId);
  if (job.name === "copy-canvas-asset") return copyPreparedCanvasAsset(job.data.assetId);
  if (job.name === "promote-creation-reference") return config.taskReferenceArchiveEnabled ? copyCreationSnapshotReference(job.data.referenceId) : undefined;
  if (job.name === "delete-creation-reference") return deleteCreationSnapshotReference(job.data.referenceId);
  throw new Error(`Unknown media job: ${job.name}`);
}, { connection, concurrency: 2, lockDuration: 120000 });

const uploadFinalizationWorker = new Worker("upload-finalization", async (job) => {
  if (job.name !== "finalize-upload") throw new Error(`Unknown upload finalization job: ${job.name}`);
  return coordinateUploadFinalization(job.data.uploadId, {
    readUploadState: (uploadId) => users.readUploadState(uploadId),
    readAsset: (ownerId, uploadId) => users.readUserAssetByUpload(ownerId, uploadId),
    finalize: (uploadId) => finalizeQueuedUpload(uploadId),
    rememberError: (uploadId, error) => connection.set(`upload:error:${uploadId}`, error, "EX", 24 * 3600),
    clearUploadKeys: (uploadId, includeError) => connection.del(...(includeError ? [`upload:error:${uploadId}`, `upload:${uploadId}`] : [`upload:${uploadId}`])),
    failAsset: (assetId, error) => markAssetIngestFailed(assetId, error),
    enqueueAsset: (assetId) => assetQueue.add("register", { assetId }, { jobId: assetId, attempts: 3, backoff: { type: "exponential", delay: 15_000 }, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } }),
  });
}, { connection, concurrency: 2, lockDuration: 120_000 });

const previewWorker = new Worker("preview", async (job) => {
  if (job.name !== "create-preview") throw new Error(`Unknown preview job: ${job.name}`);
  return createTaskPreview(job.data.taskId);
}, { connection, concurrency: config.tosPreviewConcurrency, lockDuration: config.tosTranscodeDeadlineMs + config.tosSourceStreamTimeoutMs + 60_000 });

const assetWorker = new Worker("asset-ingest", async (job) => {
  if (job.name === "register") return registerQueuedAsset(job.data.assetId);
  if (job.name === "delete-provider") return deleteQueuedProviderAsset(job.data.assetId);
  throw new Error(`Unknown asset job: ${job.name}`);
}, { connection, concurrency: 2, lockDuration: 240_000 });

await Promise.all([worker.waitUntilReady(), previewWorker.waitUntilReady(), assetWorker.waitUntilReady(), uploadFinalizationWorker.waitUntilReady()]);
const heartbeat = await startWorkerHeartbeat(connection, "media");

previewWorker.on("failed", (job, error) => {
  console.warn(JSON.stringify({ type: "tos_preview_failed", at: new Date().toISOString(), taskId: job?.data.taskId, attempt: job?.attemptsMade, code: (error as { code?: string }).code ?? "unknown", message: error.message }));
});

assetWorker.on("failed", (job, error) => {
  if (job?.name === "register" && (error instanceof AssetUploadPendingError || error instanceof AssetCreateUnknownError)) {
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) void job.remove().catch(() => undefined);
    console.info(JSON.stringify({ type: error instanceof AssetCreateUnknownError ? "asset_ingest_waiting_for_reconcile" : "asset_ingest_waiting_for_upload", at: new Date().toISOString(), assetId: job.data.assetId, attempt: job.attemptsMade }));
    return;
  }
  if (job?.name === "register" && job.attemptsMade >= (job.opts.attempts ?? 1)) markAssetIngestFailed(job.data.assetId, "素材已上传，但生成引用暂未准备完成");
  console.warn(JSON.stringify({ type: job?.name === "delete-provider" ? "asset_provider_delete_failed" : "asset_ingest_failed", at: new Date().toISOString(), assetId: job?.data.assetId, attempt: job?.attemptsMade, code: (error as { code?: string }).code ?? "unknown" }));
});

uploadFinalizationWorker.on("failed", (job, error) => {
  console.warn(JSON.stringify({ type: "tos_upload_finalize_failed", at: new Date().toISOString(), uploadId: job?.data.uploadId, attempt: job?.attemptsMade, code: (error as { code?: string }).code ?? "worker_failure" }));
  if (!job?.data.uploadId || job.attemptsMade < (job.opts.attempts ?? 1)) return;
  const expired = users.expireFinalizingUpload(job.data.uploadId, Date.now() - uploadFinalizationDeadlineMs);
  if (!expired) return;
  const message = "素材内容校验超过 15 分钟，已停止自动重试；请重新上传";
  const asset = users.readUserAssetByUpload(expired.ownerId, job.data.uploadId);
  if (asset?.status === "Processing") markAssetIngestFailed(asset.id, message);
  void connection.set(`upload:error:${job.data.uploadId}`, message, "EX", 24 * 3600)
    .then(() => connection.del(`upload:${job.data.uploadId}`))
    .catch(() => undefined);
  console.warn(JSON.stringify({ type: "tos_upload_finalize_exhausted", at: new Date().toISOString(), uploadId: job.data.uploadId, userId: expired.ownerId, elapsedMs: Date.now() - expired.createdAt }));
});

worker.on("failed", async (job, error) => {
  if (job?.name === "promote-creation-reference") {
    if (job.attemptsMade < (job.opts.attempts ?? 1)) return;
    const reference = users.readCreationSnapshotReference(job.data.referenceId);
    if (reference?.status === "promoting") {
      users.updateCreationSnapshotReference(reference.id, { status: "unavailable", lastError: error.message.slice(0, 500), expectedStatus: "promoting" });
      console.error(JSON.stringify({ type: "reedit_reference_promotion_failed", at: new Date().toISOString(), taskId: reference.sourceId, sourceType: reference.sourceType, userId: reference.ownerId, referenceId: reference.id, attempts: job.attemptsMade, code: (error as { code?: string }).code ?? "unknown" }));
    }
    return;
  }
  if (job?.name === "copy-canvas-asset") {
    if (job.attemptsMade < (job.opts.attempts ?? 1)) return;
    if (error instanceof CanvasAssetUploadPendingError) {
      // Deep validation can outlive one BullMQ retry window. Keep the durable
      // project asset in copying and let the recovery scan enqueue it again.
      await job.remove().catch(() => undefined);
      console.info(JSON.stringify({ type: "canvas_copy_waiting_for_upload", at: new Date().toISOString(), assetId: job.data.assetId, attempts: job.attemptsMade }));
      return;
    }
    const asset = users.readCanvasAsset(job.data.assetId);
    if (asset) {
      users.updateCanvasAsset(asset.id, { status: "failed" });
      users.updateCanvasProjectAssetByCanvasAsset(asset.id, { status: "failed", size: asset.size, contentType: asset.contentType });
      console.warn(JSON.stringify({ type: "canvas_copy_failed", at: new Date().toISOString(), assetId: asset.id, ownerId: asset.ownerId, attempts: job.attemptsMade }));
    }
    return;
  }
  if (!job || job.name !== "archive-output" || job.attemptsMade < (job.opts.attempts ?? 1)) return;
  const task = await readTask(job.data.taskId, true);
  if (!task || task.deletedAt) return;
  const mediaAttempts = job.data.existingObjectOnly ? (task.mediaAttempts ?? 0) : (task.mediaAttempts ?? 0) + 1;
  // 分层保护：任务保持 succeeded（生成本身成功），归档失败进入可恢复态；
  // 临时源只作为前端显式选择的降级预览，默认播放与下载仍等待 TOS 验证完成。
  await saveTask({
    ...task,
    mediaStatus: "failed",
    mediaAttempts,
    mediaLastError: job.failedReason ? JSON.stringify({ phase: "archive_output", message: job.failedReason.slice(0, 500) }) : undefined,
    updatedAt: Date.now()
  });
  if (!job.data.existingObjectOnly && mediaAttempts < MAX_MEDIA_RECOVERY_ATTEMPTS) {
    await enqueueArchiveRecovery(task, 60_000).catch((error) => console.warn(JSON.stringify({ type: "tos_recovery_queue_failed", at: new Date().toISOString(), taskId: task.id, code: (error as { code?: string }).code ?? "unknown" })));
  } else {
    console.warn(JSON.stringify({ type: "tos_recovery_exhausted", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, attempts: mediaAttempts, maxAttempts: MAX_MEDIA_RECOVERY_ATTEMPTS }));
  }
});

// SQLite tombstones are the deletion source of truth. Scan directly so cleanup
// recovers quickly even when the original HTTP-to-Redis handoff was unavailable.
const reconcile = setInterval(() => void deletePendingMedia().catch((error) => console.warn(JSON.stringify({ type: "tos_delete_recovery_scan_failed", at: new Date().toISOString(), code: (error as { code?: string }).code ?? "unknown" }))), 60_000);
const reconcileArchives = async () => {
  const now = Date.now();
  const tasks = users.recoverableMediaTasks(now + 5 * 60 * 1000, now - 30 * 60 * 1000, 20);
  for (const task of tasks) await enqueueArchiveRecovery(task);
  const sourceRecoveries = new Set(tasks.map((task) => task.id));
  const stored = users.recoverableStoredMediaTasks(now - 30 * 24 * 60 * 60 * 1000, now - 30 * 60 * 1000, 20);
  for (const task of stored) {
    if (!task.ownerId || sourceRecoveries.has(task.id)) continue;
    const format = outputFormatFor(task);
    const key = outputObjectKey(task.ownerId, task.id, format);
    try {
      await verifyStoredObject(key, format === "mov" ? "video/quicktime" : "video/mp4");
      await enqueueArchiveRecovery(task, 0, true);
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 404) console.warn(JSON.stringify({ type: "tos_stored_recovery_probe_failed", at: new Date().toISOString(), taskId: task.id, code: (error as { code?: string }).code ?? "unknown", statusCode: (error as { statusCode?: number }).statusCode }));
    }
  }
};
const archiveReconcile = setInterval(() => void reconcileArchives().catch((error) => console.warn(JSON.stringify({ type: "tos_recovery_scan_failed", at: new Date().toISOString(), code: (error as { code?: string }).code ?? "unknown" }))), 5 * 60 * 1000);
const reconcilePosters = async () => {
  for (const task of users.recoverablePosterTasks(20)) await enqueuePosterRecovery(task.id);
};
const posterReconcile = setInterval(() => void reconcilePosters().catch((error) => console.warn(JSON.stringify({ type: "tos_poster_recovery_scan_failed", at: new Date().toISOString(), code: (error as { code?: string }).code ?? "unknown" }))), 15 * 60 * 1000);
const reconcilePreviews = async () => {
  if (!config.tosPreviewTranscodeEnabled) return;
  for (const task of users.recoverablePreviewTasks(20)) await enqueuePreviewRecovery(task.id);
};
const deprioritizeExistingPreviewBacklog = async () => {
  const waiting = await previewQueue.getWaiting(0, 499);
  await Promise.all(waiting.map((job) => job.changePriority({ priority: 10 })));
};
const previewReconcile = setInterval(() => void reconcilePreviews().catch((error) => console.warn(JSON.stringify({ type: "tos_preview_recovery_scan_failed", at: new Date().toISOString(), code: (error as { code?: string }).code ?? "unknown" }))), 15 * 60 * 1000);
const reconcileAssets = async () => {
  const assets = [...users.listProcessingUserAssets(100), ...users.listUserAssetsNeedingMediaPromotion(100)];
  for (const asset of new Map(assets.map((item) => [item.id, item])).values()) {
    if (asset.uploadId && !users.readUpload(asset.uploadId)) continue;
    await assetQueue.add("register", { assetId: asset.id }, { jobId: asset.id, attempts: 3, backoff: { type: "exponential", delay: 15_000 }, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } });
  }
  const deleteBucket = Math.floor(Date.now() / (5 * 60 * 1000));
  for (const asset of users.listDeletedUserAssetsNeedingProviderDelete(100)) {
    await assetQueue.add("delete-provider", { assetId: asset.id }, { jobId: `delete-${asset.id}-${deleteBucket}`, attempts: 6, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } });
  }
};
const assetReconcile = setInterval(() => void reconcileAssets().catch((error) => console.warn(JSON.stringify({ type: "asset_ingest_recovery_scan_failed", at: new Date().toISOString(), code: (error as { code?: string }).code ?? "unknown" }))), 60_000);
const reconcileUploadFinalizations = async () => {
  for (const media of users.listFinalizingUploads(100)) {
    if (!media.uploadId) continue;
    await uploadFinalizationQueue.add("finalize-upload", { uploadId: media.uploadId }, { jobId: `finalize-upload-${media.uploadId}`, priority: 1, attempts: 5, backoff: { type: "exponential", delay: 3000, jitter: .5 }, removeOnComplete: true, removeOnFail: true });
  }
};
const uploadFinalizeReconcile = setInterval(() => void reconcileUploadFinalizations().catch((error) => console.warn(JSON.stringify({ type: "tos_upload_finalize_recovery_scan_failed", at: new Date().toISOString(), code: (error as { code?: string }).code ?? "unknown" }))), 60_000);
const reconcileCanvasCopies = async () => {
  const bucket = Math.floor(Date.now() / 60_000);
  for (const asset of users.copyingCanvasAssets(100)) {
    await mediaQueue.add("copy-canvas-asset", { assetId: asset.id }, { jobId: `copy-${asset.id}-${bucket}`, attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } });
  }
};
const canvasCopyReconcile = setInterval(() => void reconcileCanvasCopies().catch((error) => console.warn(JSON.stringify({ type: "canvas_copy_recovery_scan_failed", at: new Date().toISOString(), code: (error as { code?: string }).code ?? "unknown" }))), 60_000);
const reconcileCreationReferences = async () => {
  if (!config.taskReferenceArchiveEnabled) return;
  const bucket = Math.floor(Date.now() / 60_000);
  for (const reference of users.pendingCreationReferencePromotions(100)) {
    await mediaQueue.add("promote-creation-reference", { referenceId: reference.id }, {
      jobId: `promote-reference-${reference.id}-${bucket}`, attempts: 5,
      backoff: { type: "exponential", delay: 5000, jitter: .5 }, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 },
    });
  }
  for (const reference of users.pendingCreationReferenceDeletes(100)) {
    await mediaQueue.add("delete-creation-reference", { referenceId: reference.id }, {
      jobId: `delete-reference-${reference.id}-${bucket}`, attempts: 5,
      backoff: { type: "exponential", delay: 5000, jitter: .5 }, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 },
    });
  }
};
const creationReferenceReconcile = setInterval(() => void reconcileCreationReferences().catch((error) => console.warn(JSON.stringify({ type: "reedit_reference_recovery_scan_failed", at: new Date().toISOString(), code: (error as { code?: string }).code ?? "unknown" }))), 60_000);
void deletePendingMedia().catch((error) => console.warn(JSON.stringify({ type: "tos_delete_recovery_scan_failed", at: new Date().toISOString(), code: (error as { code?: string }).code ?? "unknown" })));
void deleteCanvasAssets().catch((error) => console.warn(JSON.stringify({ type: "canvas_asset_cleanup_scan_failed", at: new Date().toISOString(), code: (error as { code?: string }).code ?? "unknown" })));
void reconcileArchives().catch(() => undefined);
void reconcilePosters().catch(() => undefined);
void deprioritizeExistingPreviewBacklog().then(reconcilePreviews).catch((error) => console.warn(JSON.stringify({ type: "tos_preview_priority_reconcile_failed", at: new Date().toISOString(), code: (error as { code?: string }).code ?? "unknown" })));
void reconcileAssets().catch(() => undefined);
void reconcileUploadFinalizations().catch(() => undefined);
void reconcileCanvasCopies().catch(() => undefined);
void reconcileCreationReferences().catch(() => undefined);

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await heartbeat.stop();
  clearInterval(reconcile); clearInterval(archiveReconcile); clearInterval(posterReconcile); clearInterval(previewReconcile); clearInterval(assetReconcile); clearInterval(uploadFinalizeReconcile); clearInterval(canvasCopyReconcile); clearInterval(creationReferenceReconcile);
  const graceful = await closeWorkersWithin([worker, previewWorker, assetWorker, uploadFinalizationWorker], config.shutdownGraceMs);
  console.info(JSON.stringify({ type: "worker_shutdown", at: new Date().toISOString(), worker: "media", graceful }));
  await connection.quit(); users.close(); process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
