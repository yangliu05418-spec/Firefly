/// <reference lib="webworker" />
import { IMAGE_REENCODE_THRESHOLD_BYTES, imageNormalizationPlan } from "./image-normalize-policy";

type NormalizeRequest = { id: string; file: File; createPreview?: boolean };
const PREVIEW_MAX_EDGE = 960;

self.onmessage = async (event: MessageEvent<NormalizeRequest>) => {
  const { id, file, createPreview = false } = event.data;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const plan = imageNormalizationPlan(bitmap.width, bitmap.height, file.size);
    const renderWidth = plan.adjusted ? plan.targetWidth : bitmap.width;
    const renderHeight = plan.adjusted ? plan.targetHeight : bitmap.height;
    let normalizedCanvas: OffscreenCanvas | undefined;
    if (plan.adjusted) {
      normalizedCanvas = new OffscreenCanvas(renderWidth, renderHeight);
      const context = normalizedCanvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("浏览器无法创建图片画布");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, plan.targetWidth, plan.targetHeight);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, plan.drawX, plan.drawY, plan.drawWidth, plan.drawHeight);
    }
    let previewBlob: Blob | undefined;
    if (createPreview) {
      try {
        const previewScale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(renderWidth, renderHeight));
        const preview = new OffscreenCanvas(Math.max(1, Math.round(renderWidth * previewScale)), Math.max(1, Math.round(renderHeight * previewScale)));
        const previewContext = preview.getContext("2d", { alpha: false });
        if (previewContext) {
          previewContext.imageSmoothingEnabled = true;
          previewContext.imageSmoothingQuality = "high";
          previewContext.fillStyle = "#ffffff";
          previewContext.fillRect(0, 0, preview.width, preview.height);
          previewContext.drawImage(normalizedCanvas ?? bitmap, 0, 0, preview.width, preview.height);
          previewBlob = await preview.convertToBlob({ type: "image/webp", quality: .82 });
        }
      } catch { /* Local preview caching must never block the upload. */ }
    }
    let blob: Blob | undefined;
    if (plan.adjusted) {
      for (const quality of [.9, .82, .72, .62]) {
        blob = await normalizedCanvas!.convertToBlob({ type: "image/jpeg", quality });
        if (blob.size <= IMAGE_REENCODE_THRESHOLD_BYTES) break;
      }
      if (!blob || blob.size > IMAGE_REENCODE_THRESHOLD_BYTES) throw new Error("图片内容过于复杂，压缩后仍超过 18MB，请缩小图片后重试");
    }
    self.postMessage({ id, plan, blob, previewBlob });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : "图片预处理失败" });
  } finally {
    bitmap?.close();
  }
};

export {};
