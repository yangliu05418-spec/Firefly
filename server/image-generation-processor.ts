import { UnrecoverableError } from "bullmq";
import type { ImageGenerationTask, MediaObject } from "./db.js";
import { storeGeneratedImage } from "./generated-media.js";
import { openRouterResolution } from "./image-models.js";
import { downloadGeneratedImage, generateSingleImage, isRetryableOpenRouterFailure, OpenRouterError } from "./openrouter.js";
import type { ImageGenerationQueuePayload } from "./redis.js";
import { users } from "./store.js";
import { signedProviderObjectUrl } from "./tos.js";
import { UploadReferencePendingError } from "./asset-upload-admission.js";

export type ImageGenerationAttempt = {
  id: string;
  data: ImageGenerationQueuePayload;
  attemptNumber: number;
  maxAttempts: number;
};

export type ImageGenerationProcessorDependencies = {
  readTask: (id: string) => ImageGenerationTask | null;
  readUpload: typeof users.readUpload;
  readUploadState: typeof users.readUploadState;
  readSnapshotReference: typeof users.readCreationSnapshotReference;
  updateTask: typeof users.updateImageGeneration;
  signReference: (objectKey: string) => string;
  generate: typeof generateSingleImage;
  download: typeof downloadGeneratedImage;
  store: (input: { ownerId: string; body: Buffer; contentType: string; fileName: string }) => Promise<MediaObject>;
  discard: (media: MediaObject) => unknown;
};

let productionDependencies: ImageGenerationProcessorDependencies | undefined;
const defaultDependencies = () => productionDependencies ??= {
  readTask: (id) => users.readImageGeneration(id),
  readUpload: users.readUpload.bind(users),
  readUploadState: users.readUploadState.bind(users),
  readSnapshotReference: users.readCreationSnapshotReference.bind(users),
  updateTask: users.updateImageGeneration.bind(users),
  signReference: signedProviderObjectUrl,
  generate: generateSingleImage,
  download: downloadGeneratedImage,
  store: storeGeneratedImage,
  discard: (media) => users.upsertMedia({ ...media, status: "delete_pending", updatedAt: Date.now() }),
};

const extensionFor = (contentType: string) => contentType === "image/webp" ? "webp" : contentType === "image/jpeg" ? "jpg" : "png";
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "生成失败").slice(0, 500);

/**
 * Process one durable image-generation attempt.
 *
 * Successful items and terminal item failures are checkpointed after every
 * slot. A transient error is deliberately rethrown before it is recorded so
 * BullMQ can retry the same slot without regenerating already stored items.
 */
export const processImageGenerationAttempt = async (
  job: ImageGenerationAttempt,
  deps: ImageGenerationProcessorDependencies = defaultDependencies(),
) => {
  const task = deps.readTask(job.id);
  if (!task || task.status !== "running") return;
  if (task.ownerId !== job.data.ownerId) throw new UnrecoverableError("图片任务所有者校验失败");

  const referenceSources: Array<{ uploadId?: string; snapshotReferenceId?: string }> =
    job.data.references ?? (job.data.referenceUploadIds ?? []).map((uploadId) => ({ uploadId }));
  const references = referenceSources.map((source) => {
    if (source.snapshotReferenceId) {
      const snapshotReference = deps.readSnapshotReference(source.snapshotReferenceId);
      if (!snapshotReference || snapshotReference.ownerId !== job.data.ownerId || snapshotReference.status !== "ready" || !snapshotReference.objectKey || snapshotReference.mediaType !== "image") {
        throw new UnrecoverableError("参考素材不存在或尚未归档完成");
      }
      return deps.signReference(snapshotReference.objectKey);
    }
    const uploadId = source.uploadId;
    if (!uploadId) throw new UnrecoverableError("参考素材缺少可用来源");
    const media = deps.readUpload(uploadId);
    if (!media) {
      const pending = deps.readUploadState(uploadId);
      if (pending?.ownerId === job.data.ownerId && pending.status === "uploading") throw new UploadReferencePendingError();
      throw new UnrecoverableError("参考素材不存在、已过期或未通过校验");
    }
    if (media.ownerId !== job.data.ownerId) throw new UnrecoverableError("参考素材不存在或已过期");
    return deps.signReference(media.objectKey);
  });
  const items = [...task.items];
  const failures = [...task.failures];
  const completed = items.length + failures.length;
  console.info(JSON.stringify({
    type: "image_generation_worker_started", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId,
    attempt: job.attemptNumber, completed, requested: task.requestedCount,
  }));

  for (let index = completed; index < task.requestedCount; index += 1) {
    if (!deps.readTask(task.id)) return;
    try {
      const url = await deps.generate({
        model: job.data.model,
        prompt: job.data.prompt,
        references,
        ratio: job.data.ratio,
        resolution: openRouterResolution(job.data.resolution),
      });
      const { body, contentType } = await deps.download(url);
      const extension = extensionFor(contentType);
      const media = await deps.store({ ownerId: task.ownerId, body, contentType, fileName: `firefly-${index + 1}.${extension}` });
      items.push({ mediaId: media.id });
      if (!deps.updateTask(task.id, task.ownerId, { status: "running", items, failures })) {
        deps.discard(media);
        return;
      }
      console.info(JSON.stringify({ type: "image_generation_completed", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, mediaId: media.id, index, bytes: body.length, contentType }));
    } catch (error) {
      const message = errorMessage(error);
      const retryable = isRetryableOpenRouterFailure(error);
      if (retryable && job.attemptNumber < job.maxAttempts) {
        console.warn(JSON.stringify({
          type: "image_generation_item_retry", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId,
          index, attempt: job.attemptNumber, status: error instanceof OpenRouterError ? error.status : undefined, message,
        }));
        throw error;
      }
      failures.push(message);
      deps.updateTask(task.id, task.ownerId, { status: "running", items, failures });
      console.warn(JSON.stringify({
        type: "image_generation_item_failed", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId,
        index, attempt: job.attemptNumber, retryable, status: error instanceof OpenRouterError ? error.status : undefined, message,
      }));
    }
  }

  if (!items.length) throw new UnrecoverableError(failures[0] ?? "图片生成失败");
  deps.updateTask(task.id, task.ownerId, { status: "succeeded", items, failures });
  console.info(JSON.stringify({ type: "image_generation_done", at: new Date().toISOString(), taskId: task.id, userId: task.ownerId, requested: task.requestedCount, ok: items.length, failed: failures.length }));
};
