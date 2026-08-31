import type { CanvasProjectAsset } from "./db.js";
import type { RequestHandler } from "express";
import { config } from "./config.js";
import { users } from "./store.js";
import { signedObjectUrl, signedProviderObjectUrl } from "./tos.js";
import { stablePreviewUrl } from "./preview-url-cache.js";
import type { GenerationInput } from "./provider.js";
import { publicLocalMediaFromSource } from "./local-media-public.js";

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
      : config.tosPreviewTranscodeEnabled
        ? users.readTaskMedia(asset.sourceId, "preview")
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

export const canvasProjectAssetSignedUrl = async (asset: CanvasProjectAsset, download = false, thumbnail = false) => {
  const media = resolveCanvasProjectMedia(asset, download);
  return download
    ? signedObjectUrl(media.objectKey, { download: true, fileName: media.fileName })
    : stablePreviewUrl({ objectKey: media.objectKey, fileName: media.fileName, process: thumbnail && media.contentType.startsWith("image/") ? "image/resize,w_960/format,webp" : undefined });
};

/** Provider references always use the archived source-quality object, never the low-bitrate browser preview. */
export const canvasProjectAssetProviderUrl = (asset: CanvasProjectAsset) => {
  const media = resolveCanvasProjectMedia(asset, true);
  return signedProviderObjectUrl(media.objectKey);
};

type CanvasGenerationReferenceDependencies = {
  readAsset(id: string): CanvasProjectAsset | null;
  providerUrl(asset: CanvasProjectAsset): string;
};

const defaultCanvasGenerationReferenceDependencies: CanvasGenerationReferenceDependencies = {
  readAsset: (id) => users.readCanvasProjectAsset(id),
  providerUrl: canvasProjectAssetProviderUrl,
};

/** Signs durable canvas references immediately before the provider request. */
export const resolveCanvasGenerationReferences = (
  input: GenerationInput,
  ownerId: string,
  deps: CanvasGenerationReferenceDependencies = defaultCanvasGenerationReferenceDependencies,
): GenerationInput => ({
  ...input,
  assets: input.assets.map((reference) => {
    if (!reference.canvasProjectAssetId) return reference;
    const asset = deps.readAsset(reference.canvasProjectAssetId);
    if (!asset || asset.ownerId !== ownerId || asset.status !== "ready" || asset.kind !== reference.type) throw new Error(`参考素材「${reference.name}」不存在或尚未就绪`);
    return { ...reference, canvasProjectAssetId: undefined, url: deps.providerUrl(asset), uploadId: undefined, assetId: undefined };
  }),
});

export const publicCanvasProjectAsset = (asset: CanvasProjectAsset) => {
  const baseUrl = `/api/canvas-project-assets/${encodeURIComponent(asset.id)}/media`;
  const mediaReady = asset.status === "ready";
  return {
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
    mediaUrl: baseUrl,
    thumbnailUrl: `${baseUrl}${asset.kind === "image" ? "?variant=thumbnail" : ""}`,
    downloadUrl: `${baseUrl}?download=1`,
    localMedia: mediaReady ? {
      preview: publicLocalMediaFromSource({
        sourceId: `canvas-project:${asset.id}`,
        revision: `canvas-project:${asset.id}\0${asset.updatedAt}\0${asset.size}\0${asset.contentType}\0identity`,
        variant: asset.kind === "image" ? "original" : "preview",
        mediaType: asset.kind,
        contentType: asset.contentType,
        size: asset.size,
        url: baseUrl,
        cachePolicy: "pin",
      }),
      thumbnail: asset.kind === "image" ? publicLocalMediaFromSource({
        sourceId: `canvas-project:${asset.id}:thumbnail:960`,
        revision: `canvas-project:${asset.id}\0${asset.updatedAt}\0${asset.size}\0${asset.contentType}\0image/resize,w_960/format,webp`,
        variant: "thumbnail",
        mediaType: "image",
        contentType: "image/webp",
        url: `${baseUrl}?variant=thumbnail`,
        cachePolicy: "warm",
      }) : undefined,
    } : undefined,
  };
};

export const createCanvasProjectMediaHandler = (deps: {
  readAsset: (id: string) => CanvasProjectAsset | null;
  canAccessCanvas: (canvasId: string, userId: string) => boolean;
  signedUrl: (asset: CanvasProjectAsset, download: boolean, thumbnail: boolean) => string | Promise<string>;
  cacheControl: string;
}): RequestHandler => async (req, res) => {
  try {
    const user = res.locals.user as { id?: string } | undefined;
    const assetId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const asset = user?.id && assetId ? deps.readAsset(assetId) : null;
    if (!asset || asset.ownerId !== user?.id || !deps.canAccessCanvas(asset.canvasId, user.id)) return res.status(404).json({ error: "画布素材不存在" });
    if (asset.status !== "ready") return res.status(asset.status === "copying" ? 425 : 409).json({ error: asset.status === "copying" ? "画布素材正在归档" : "画布素材归档失败" });
    res.setHeader("Cache-Control", deps.cacheControl);
    res.setHeader("Vary", "Cookie");
    const download = req.query.download === "1";
    const thumbnail = !download && asset.kind === "image" && req.query.variant === "thumbnail";
    res.redirect(302, await deps.signedUrl(asset, download, thumbnail));
  } catch { res.status(502).json({ error: "画布素材暂时无法读取" }); }
};
