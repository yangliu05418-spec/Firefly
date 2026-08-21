import type { MediaObject } from "./db.js";
import { users } from "./store.js";
import { assetObjectKey, tos, verifyStoredObject } from "./tos.js";
import { config } from "./config.js";

type VerifiedObject = { size: number; etag: string; requestId?: string };

export type AssetMediaPromotionDependencies = {
  copy: (sourceKey: string, targetKey: string, media: MediaObject) => Promise<{ requestId?: string }>;
  verify: (targetKey: string, contentType: string) => Promise<VerifiedObject>;
  save: (media: MediaObject) => unknown;
  now: () => number;
};

const header = (headers: unknown, name: string) => {
  if (!headers || typeof headers !== "object") return "";
  const values = headers as Record<string, string | number | undefined>;
  return String(values[name] ?? values[name.toLowerCase()] ?? values[name.toUpperCase()] ?? "");
};

const productionDependencies = (): AssetMediaPromotionDependencies => ({
  copy: async (sourceKey, targetKey, media) => {
    const response = await tos.copyObject({
      bucket: config.tosBucket,
      key: targetKey,
      srcBucket: config.tosBucket,
      srcKey: sourceKey,
      forbidOverwrite: true,
      metadataDirective: "REPLACE",
      contentType: media.contentType,
      contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(media.fileName)}`,
      cacheControl: "private, max-age=604800, immutable, no-transform"
    });
    return { requestId: response.requestId };
  },
  verify: async (targetKey, contentType) => {
    const response = await verifyStoredObject(targetKey, contentType);
    const data = response.data as unknown as { contentLength?: number; etag?: string };
    return {
      size: Number(data.contentLength ?? header(response.headers, "content-length")),
      etag: String(data.etag ?? header(response.headers, "etag")).replace(/^"|"$/g, ""),
      requestId: response.requestId
    };
  },
  save: (media) => users.upsertMedia(media),
  now: Date.now
});

/**
 * Promote a reusable library asset outside inputs/' seven-day lifecycle.
 * The copy is deterministic and idempotent. The source remains in inputs/ so
 * already-issued signatures keep working until lifecycle cleanup.
 */
export const promoteUserAssetMedia = async (
  media: MediaObject,
  deps: AssetMediaPromotionDependencies = productionDependencies()
) => {
  if (media.objectKey.startsWith("assets/")) return media;
  if (!media.objectKey.startsWith("inputs/")) return media;
  if (!media.uploadId) throw new Error("上传素材缺少可恢复的上传 ID");

  const targetKey = assetObjectKey(media.ownerId, media.uploadId, media.fileName);
  let copyRequestId: string | undefined;
  let copyError: unknown;
  try {
    copyRequestId = (await deps.copy(media.objectKey, targetKey, media)).requestId;
  } catch (error) {
    // A previous attempt can have completed server-side while its response was
    // lost. Reconcile the deterministic destination before deciding to retry.
    copyError = error;
  }

  let verified: VerifiedObject;
  try {
    verified = await deps.verify(targetKey, media.contentType);
  } catch (verificationError) {
    if (copyError) throw copyError;
    throw verificationError;
  }
  if (!Number.isSafeInteger(verified.size) || verified.size <= 0 || verified.size !== media.size) {
    throw new Error("长期素材复制后的对象大小不一致");
  }

  const promoted: MediaObject = {
    ...media,
    objectKey: targetKey,
    etag: verified.etag || media.etag,
    updatedAt: deps.now()
  };
  deps.save(promoted);
  console.info(JSON.stringify({
    type: "tos_asset_promoted",
    at: new Date(promoted.updatedAt).toISOString(),
    ownerId: media.ownerId,
    uploadId: media.uploadId,
    size: media.size,
    requestId: verified.requestId ?? copyRequestId
  }));
  return promoted;
};
