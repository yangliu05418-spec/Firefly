import crypto from "node:crypto";
import { config } from "./config.js";
import type { CanvasAsset } from "./db.js";
import { users } from "./store.js";
import { headObject, tos, tosConfigured } from "./tos.js";

/**
 * 画布长期素材：把 inputs/ 前缀的临时上传对象复制到 canvas/ 前缀（7 天生命周期之外）。
 * 铁律：画布节点只存稳定引用（assetId），渲染时经 /api/canvas-media/:id 换取签名地址。
 */

const shard = (id: string) => crypto.createHash("sha256").update(id).digest("hex").slice(0, 2);
const safeSegment = (value: string) => value.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(-120) || "media";

export const canvasAssetObjectKey = (ownerId: string, canvasId: string, assetId: string, fileName: string) => `canvas/${shard(assetId)}/${ownerId}/${canvasId}/${assetId}/${safeSegment(fileName)}`;

/** 源对象：uploadId（inputs/ 上传）或直接指定 TOS 对象（如 generated/ 生成图） */
export type CanvasAssetSource = { kind: "upload"; uploadId: string } | { kind: "object"; objectKey: string; fileName: string; contentType: string; ownerId: string };

/** 解析源对象并做归属校验 */
const resolveCanvasAssetSource = (source: CanvasAssetSource, requesterId: string): { objectKey: string; fileName: string; contentType: string } => {
  if (source.kind === "upload") {
    const media = users.readUpload(source.uploadId);
    if (!media || media.ownerId !== requesterId || media.status !== "ready") throw new Error("引用素材不存在、尚未完成或已过期");
    return { objectKey: media.objectKey, fileName: media.fileName, contentType: media.contentType };
  }
  if (source.ownerId !== requesterId) throw new Error("引用素材不存在或已过期");
  return { objectKey: source.objectKey, fileName: source.fileName, contentType: source.contentType };
};

const createCanvasAssetRecord = (input: { source: CanvasAssetSource; ownerId: string; canvasId: string }) => {
  const source = resolveCanvasAssetSource(input.source, input.ownerId);
  const now = Date.now();
  const assetId = `canvas-asset-${crypto.randomUUID()}`;
  const asset: CanvasAsset = {
    id: assetId, ownerId: input.ownerId, canvasId: input.canvasId,
    sourceUploadId: input.source.kind === "upload" ? input.source.uploadId : undefined,
    objectKey: canvasAssetObjectKey(input.ownerId, input.canvasId, assetId, source.fileName),
    fileName: source.fileName, contentType: source.contentType, size: 0, etag: "", status: "copying", createdAt: now, updatedAt: now,
  };
  users.createCanvasAsset(asset);
  return { asset, sourceObjectKey: source.objectKey };
};

const copyCanvasAssetObject = async (asset: CanvasAsset, sourceObjectKey: string) => {
  try {
    await tos.copyObject({ bucket: config.tosBucket, key: asset.objectKey, srcBucket: config.tosBucket, srcKey: sourceObjectKey, forbidOverwrite: true });
    const head = await headObject(asset.objectKey);
    const data = head.data as unknown as { contentLength?: number; etag?: string };
    const headers = head.headers as Record<string, string | undefined> | undefined;
    const size = Number(data.contentLength ?? headers?.["content-length"] ?? 0) || 0;
    const etag = String(data.etag ?? headers?.etag ?? "").replace(/^"|"$/g, "");
    const ready = users.updateCanvasAsset(asset.id, { status: "ready", size, etag })!;
    users.updateCanvasProjectAssetByCanvasAsset(asset.id, { status: "ready", size, contentType: ready.contentType });
    return ready;
  } catch (error) {
    throw error;
  }
};

/** Creates the durable record immediately; Media Worker performs the server-side TOS copy. */
export const prepareCanvasAssetFromUpload = (input: { uploadId: string; ownerId: string; canvasId: string }) => {
  if (!tosConfigured()) throw new Error("媒体存储尚未配置，无法插入画布");
  return createCanvasAssetRecord({ source: { kind: "upload", uploadId: input.uploadId }, ownerId: input.ownerId, canvasId: input.canvasId }).asset;
};

export const copyPreparedCanvasAsset = async (assetId: string) => {
  const asset = users.readCanvasAsset(assetId);
  if (!asset) return;
  if (asset.status === "ready") return asset;
  if (!asset.sourceUploadId) throw new Error("画布素材缺少可恢复的上传来源");
  const source = users.readUpload(asset.sourceUploadId);
  if (!source || source.ownerId !== asset.ownerId || source.status !== "ready") throw new Error("画布素材的上传来源不存在或尚未就绪");
  return copyCanvasAssetObject(asset, source.objectKey);
};

/** 源对象 → 画布长期素材（同步服务端复制到 canvas/ 前缀；失败时标记 failed 供排查） */
export const createCanvasAssetFromUpload = async (input: { source: CanvasAssetSource; ownerId: string; canvasId: string }): Promise<CanvasAsset> => {
  if (!tosConfigured()) throw new Error("媒体存储尚未配置，无法插入画布");
  const prepared = createCanvasAssetRecord(input);
  try { return await copyCanvasAssetObject(prepared.asset, prepared.sourceObjectKey); }
  catch (error) {
    users.updateCanvasAsset(prepared.asset.id, { status: "failed" });
    throw error;
  }
};
