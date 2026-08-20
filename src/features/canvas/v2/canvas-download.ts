import type { CanvasProjectAsset } from "../canvas-api";

const extensions: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
};

const knownMediaExtension = /\.(?:jpe?g|png|webp|gif|bmp|tiff?|heic|heif|mp4|mov|mp3|wav)$/iu;

export const canvasAssetDownloadName = (asset: Pick<CanvasProjectAsset, "title" | "kind" | "contentType">, index: number) => {
  const fallback = asset.kind === "video" ? ".mp4" : asset.kind === "audio" ? ".mp3" : ".webp";
  const extension = extensions[asset.contentType.split(";", 1)[0].trim().toLowerCase()] ?? fallback;
  const safe = (asset.title || `Firefly-${index + 1}`).replace(/[<>:"/\\|?*\u0000-\u001F]/gu, "-").slice(0, 90);
  const stem = safe.replace(knownMediaExtension, "") || `Firefly-${index + 1}`;
  return `${stem}${extension}`;
};
