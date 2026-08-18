import crypto from "node:crypto";
import { config } from "./config.js";
import { users, type CanvasAsset } from "./db.js";
import { headObject, tos, tosConfigured } from "./tos.js";

/**
 * 画布长期素材：把 inputs/ 前缀的临时上传对象复制到 canvas/ 前缀（7 天生命周期之外）。
 * 铁律：画布节点只存稳定引用（assetId），渲染时经 /api/canvas-media/:id 换取签名地址。
 */

const shard = (id: string) => crypto.createHash("sha256").update(id).digest("hex").slice(0, 2);
const safeSegment = (value: string) => value.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(-120) || "media";

export const canvasAssetObjectKey = (ownerId: string, canvasId: string, assetId: string, fileName: string) => `canvas/${shard(assetId)}/${ownerId}/${canvasId}/${assetId}/${safeSegment(fileName)}`;

/** 上传对象 → 画布长期素材（同步服务端复制；失败时标记 failed 供排查） */
export const createCanvasAssetFromUpload = async (input: { uploadId: string; ownerId: string; canvasId: string }): Promise<CanvasAsset> => {
  const media = users.readUpload(input.uploadId);
  if (!media || media.ownerId !== input.ownerId) throw new Error("引用素材不存在或已过期");
  if (!tosConfigured()) throw new Error("媒体存储尚未配置，无法插入画布");
  const now = Date.now();
  const assetId = `canvas-asset-${crypto.randomUUID()}`;
  const asset: CanvasAsset = {
    id: assetId, ownerId: input.ownerId, canvasId: input.canvasId, sourceUploadId: input.uploadId,
    objectKey: canvasAssetObjectKey(input.ownerId, input.canvasId, assetId, media.fileName),
    fileName: media.fileName, contentType: media.contentType, size: 0, etag: "", status: "copying", createdAt: now, updatedAt: now,
  };
  users.createCanvasAsset(asset);
  try {
    await tos.copyObject({ bucket: config.tosBucket, key: asset.objectKey, srcBucket: config.tosBucket, srcKey: media.objectKey, forbidOverwrite: true });
    const head = await headObject(asset.objectKey);
    const data = head.data as unknown as { contentLength?: number; etag?: string };
    const headers = head.headers as Record<string, string | undefined> | undefined;
    const size = Number(data.contentLength ?? headers?.["content-length"] ?? 0) || 0;
    const etag = String(data.etag ?? headers?.etag ?? "").replace(/^"|"$/g, "");
    users.updateCanvasAsset(asset.id, { status: "ready", size, etag });
    return { ...asset, status: "ready", size, etag };
  } catch (error) {
    users.updateCanvasAsset(asset.id, { status: "failed" });
    throw error;
  }
};
