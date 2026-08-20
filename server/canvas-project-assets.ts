import type { CanvasProjectAsset } from "./db.js";
import type { RequestHandler } from "express";
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

export const createCanvasProjectMediaHandler = (deps: {
  readAsset: (id: string) => CanvasProjectAsset | null;
  canAccessCanvas: (canvasId: string, userId: string) => boolean;
  signedUrl: (asset: CanvasProjectAsset, download: boolean) => string;
  cacheControl: string;
}): RequestHandler => (req, res) => {
  try {
    const user = res.locals.user as { id?: string } | undefined;
    const assetId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const asset = user?.id && assetId ? deps.readAsset(assetId) : null;
    if (!asset || asset.ownerId !== user?.id || !deps.canAccessCanvas(asset.canvasId, user.id)) return res.status(404).json({ error: "画布素材不存在" });
    if (asset.status !== "ready") return res.status(asset.status === "copying" ? 425 : 409).json({ error: asset.status === "copying" ? "画布素材正在归档" : "画布素材归档失败" });
    res.setHeader("Cache-Control", deps.cacheControl);
    res.setHeader("Vary", "Cookie");
    res.redirect(302, deps.signedUrl(asset, req.query.download === "1"));
  } catch { res.status(502).json({ error: "画布素材暂时无法读取" }); }
};
