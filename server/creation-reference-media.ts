import type { GenerationInput } from "./provider.js";
import { config } from "./config.js";
import { users } from "./store.js";
import { deleteObject, signedProviderObjectUrl, tos, verifyStoredObject } from "./tos.js";
import { deleteProviderAssetSafely } from "./asset-cleanup.js";

const header = (headers: unknown, name: string) => {
  const record = headers && typeof headers === "object" ? headers as Record<string, unknown> : {};
  return String(record[name] ?? record[name.toLowerCase()] ?? "");
};

export const copyCreationSnapshotReference = async (id: string) => {
  const reference = users.readCreationSnapshotReference(id);
  if (!reference || reference.status !== "promoting") return reference;
  if (!reference.sourceObjectKey || !reference.objectKey) throw new Error("任务引用缺少可复制的TOS对象");
  let copyError: unknown;
  try {
    await tos.copyObject({
      bucket: config.tosBucket, key: reference.objectKey,
      srcBucket: config.tosBucket, srcKey: reference.sourceObjectKey, forbidOverwrite: true,
    });
  } catch (error) { copyError = error; }
  let verified;
  try { verified = await verifyStoredObject(reference.objectKey, reference.contentType || undefined); }
  catch (error) { if (copyError) throw copyError; throw error; }
  const data = verified.data as unknown as { contentLength?: number; etag?: string; contentType?: string };
  const size = Number(data.contentLength ?? header(verified.headers, "content-length"));
  const etag = String(data.etag ?? header(verified.headers, "etag")).replace(/^"|"$/g, "");
  const contentType = String(data.contentType ?? header(verified.headers, "content-type")).split(";", 1)[0] || reference.contentType;
  if (!Number.isSafeInteger(size) || size <= 0 || (reference.size > 0 && size !== reference.size)) throw new Error("任务引用复制后的对象大小不一致");
  if (reference.contentType && contentType.toLowerCase() !== reference.contentType.toLowerCase()) throw new Error("任务引用复制后的媒体类型不一致");
  // CopyObject may assign a new ETag (notably when the source came from multipart upload).
  // Validate that the target has its own stable identity instead of assuming ETag equality.
  if (!etag) throw new Error("任务引用复制后的对象缺少 ETag");
  const updated = users.updateCreationSnapshotReference(id, { status: "ready", size, etag, contentType, lastError: null, expectedStatus: "promoting" });
  if (!updated) return users.readCreationSnapshotReference(id);
  console.info(JSON.stringify({ type: "reedit_reference_promoted", at: new Date().toISOString(), taskId: reference.sourceId, sourceType: reference.sourceType, userId: reference.ownerId, referenceId: id, bytes: size, requestId: verified.requestId }));
  return updated;
};

export const deleteCreationSnapshotReference = async (id: string) => {
  const reference = users.readCreationSnapshotReference(id);
  if (!reference || reference.status !== "delete_pending") return reference;
  if (reference.providerAssetId) {
    await deleteProviderAssetSafely(reference.providerAssetId);
    users.updateCreationSnapshotReference(id, { providerAssetId: null });
  }
  if (reference.objectKey) await deleteObject(reference.objectKey).catch((error) => {
    if ((error as { statusCode?: number }).statusCode !== 404) throw error;
  });
  const updated = users.updateCreationSnapshotReference(id, { status: "deleted", lastError: null });
  console.info(JSON.stringify({ type: "reedit_reference_deleted", at: new Date().toISOString(), taskId: reference.sourceId, sourceType: reference.sourceType, userId: reference.ownerId, referenceId: id }));
  return updated;
};

export type CreationReferenceResolutionDependencies = {
  readReference: typeof users.readCreationSnapshotReference;
  signObject: (objectKey: string) => string;
};

export const resolveCreationSnapshotReferences = (input: GenerationInput, ownerId: string, supplied?: CreationReferenceResolutionDependencies): GenerationInput => {
  const deps = supplied ?? {
    readReference: (id: string) => users.readCreationSnapshotReference(id),
    signObject: signedProviderObjectUrl,
  };
  return ({
  ...input,
  assets: input.assets.map((asset) => {
    if (!asset.snapshotReferenceId) return asset;
    const reference = deps.readReference(asset.snapshotReferenceId);
    if (!reference || reference.ownerId !== ownerId || reference.status !== "ready" || !reference.objectKey || reference.mediaType !== asset.type) {
      throw new Error(`参考素材「${asset.name}」不存在或尚未归档完成`);
    }
    return {
      ...asset, uploadId: undefined, assetId: undefined,
      canvasProjectAssetId: undefined, url: deps.signObject(reference.objectKey),
    };
  }),
  });
};
