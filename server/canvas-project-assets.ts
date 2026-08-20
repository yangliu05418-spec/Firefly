import type { CanvasProjectAsset } from "./db.js";
import { users } from "./store.js";
import { signedObjectUrl } from "./tos.js";

export type ResolvedCanvasProjectMedia = {
  objectKey: string;
  fileName: string;
  contentType: string;
  size: number;
};

export const resolveCanvasProjectMedia = (asset: CanvasProjectAsset, preferOriginal = false): ResolvedCanvasProjectMedia => {
  if (asset.canvasAssetId) {
    const media = users.readCanvasAsset(asset.canvasAssetId);
    if (!media || media.ownerId !== asset.ownerId || media.status !== "ready") throw new Error(`参考素材「${asset.title}」尚未就绪`);
    return { objectKey: media.objectKey, fileName: media.fileName, contentType: media.contentType, size: media.size };
  }
  if (asset.sourceType === "generation") {
    const media = preferOriginal
      ? users.readTaskMedia(asset.sourceId, "output") ?? users.readTaskMedia(asset.sourceId, "preview")
      : users.readTaskMedia(asset.sourceId, "preview") ?? users.readTaskMedia(asset.sourceId, "output");
    if (!media || media.ownerId !== asset.ownerId || media.status !== "ready") throw new Error(`参考视频「${asset.title}」尚未就绪`);
    return { objectKey: media.objectKey, fileName: media.fileName, contentType: media.contentType, size: media.size };
  }
  if (asset.sourceType === "generated") {
    const media = users.readMedia(asset.sourceId);
    if (!media || media.ownerId !== asset.ownerId || media.status !== "ready") throw new Error(`参考图片「${asset.title}」尚未就绪`);
    return { objectKey: media.objectKey, fileName: media.fileName, contentType: media.contentType, size: media.size };
  }
  if (asset.sourceType === "user_asset") {
    const userAsset = users.readUserAsset(asset.sourceId);
    const media = userAsset?.uploadId ? users.readUpload(userAsset.uploadId) : null;
    if (!userAsset || userAsset.ownerId !== asset.ownerId || !media || media.ownerId !== asset.ownerId || media.status !== "ready") throw new Error(`素材「${asset.title}」缺少可用源文件`);
    return { objectKey: media.objectKey, fileName: media.fileName, contentType: media.contentType, size: media.size };
  }
  if (asset.sourceType === "montage") {
    const record = users.readCanvasExport(asset.sourceId);
    if (!record || record.ownerId !== asset.ownerId || record.status !== "ready") throw new Error(`合成视频「${asset.title}」尚未就绪`);
    return { objectKey: record.objectKey, fileName: "montage.mp4", contentType: "video/mp4", size: asset.size };
  }
  throw new Error(`参考素材「${asset.title}」无法读取`);
};

export const canvasProjectAssetSignedUrl = (asset: CanvasProjectAsset, download = false) => {
  const media = resolveCanvasProjectMedia(asset, download);
  return signedObjectUrl(media.objectKey, { download, fileName: media.fileName });
};

/** Provider references always use the archived source-quality object, never the low-bitrate browser preview. */
export const canvasProjectAssetProviderUrl = (asset: CanvasProjectAsset) => {
  const media = resolveCanvasProjectMedia(asset, true);
  return signedObjectUrl(media.objectKey, { fileName: media.fileName });
};

export const publicCanvasProjectAsset = (asset: CanvasProjectAsset) => ({
  id: asset.id,
  canvasId: asset.canvasId,
  kind: asset.kind,
  title: asset.title,
  contentType: asset.contentType,
  size: asset.size,
  width: asset.width,
  height: asset.height,
  durationMs: asset.durationMs,
  status: asset.status,
  createdAt: asset.createdAt,
  updatedAt: asset.updatedAt,
  mediaUrl: `/api/canvas-project-assets/${encodeURIComponent(asset.id)}/media`,
  downloadUrl: `/api/canvas-project-assets/${encodeURIComponent(asset.id)}/media?download=1`,
});
