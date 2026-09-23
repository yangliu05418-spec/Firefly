import { users } from "./store.js";
import { config } from "./config.js";
import { probePreviewSource, isBrowserCompatibleOriginal } from "./preview-integrity.js";
import { deleteObject, previewObjectKey, signedObjectUrl, tos, verifyStoredObject } from "./tos.js";

export const compatibleOriginalPreviewKey = (ownerId: string, taskId: string) =>
  previewObjectKey(ownerId, taskId).replace(/preview\.mp4$/, "compatible-original.mp4");

/** Publish only a verified, durable, browser-compatible original. HEVC must
 * still wait for a compatible rendition. No Provider URL or AWS proxy here. */
export const exposeCompatibleOriginalPreview = async (taskId: string) => {
  if (users.readTaskMedia(taskId, "preview")) return false;
  const output = users.readTaskMedia(taskId, "output");
  if (!output || output.contentType.split(";", 1)[0].toLowerCase() !== "video/mp4") return false;
  const source = await probePreviewSource(signedObjectUrl(output.objectKey, { expires: 300 }));
  if (!isBrowserCompatibleOriginal(source)) return false;
  await verifyStoredObject(output.objectKey, "video/mp4");
  const objectKey = compatibleOriginalPreviewKey(output.ownerId, taskId);
  // media_objects.object_key is unique. Copy within TOS instead of aliasing
  // the output row or downloading/uploading its bytes through AWS again.
  try {
    await tos.copyObject({ bucket: config.tosBucket, key: objectKey, srcBucket: config.tosBucket, srcKey: output.objectKey, forbidOverwrite: true });
  } catch (error) {
    if (![409, 412].includes(Number((error as { statusCode?: number }).statusCode))) throw error;
  }
  const head = await verifyStoredObject(objectKey, "video/mp4");
  const data = head.data as unknown as { contentLength?: number; etag?: string };
  const headers = head.headers as Record<string, string | undefined>;
  const size = Number(data.contentLength ?? headers["content-length"]);
  const etag = String(data.etag ?? headers.etag ?? "").replace(/^"|"$/g, "");
  if (size !== output.size || !etag) throw new Error("兼容原片副本完整性校验失败");
  // A separate preview worker may have published while ffprobe was running.
  // This CAS must not overwrite that optimized result or resurrect deletion.
  const now = Date.now();
  const committed = users.commitOriginalPreviewIfMissing(taskId, {
    ...output, id: `${taskId}:preview-original`, kind: "preview", objectKey, etag, size,
    fileName: "preview.mp4", createdAt: now, updatedAt: now,
  });
  if (!committed) {
    if (users.readTaskMedia(taskId, "preview")?.objectKey !== objectKey) await deleteObject(objectKey).catch(() => undefined);
    return false;
  }
  console.info(JSON.stringify({ type: "tos_compatible_original_preview_ready", taskId, userId: output.ownerId, duration: source.duration, bytes: output.size, revision: committed.mediaRevision }));
  return true;
};
