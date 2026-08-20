/// <reference lib="webworker" />
import { imageNormalizationPlan } from "./image-normalize-policy";

type NormalizeRequest = { id: string; file: File };

self.onmessage = async (event: MessageEvent<NormalizeRequest>) => {
  const { id, file } = event.data;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const plan = imageNormalizationPlan(bitmap.width, bitmap.height);
    if (!plan.adjusted) {
      self.postMessage({ id, plan });
      return;
    }
    const canvas = new OffscreenCanvas(plan.targetWidth, plan.targetHeight);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("浏览器无法创建图片画布");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, plan.targetWidth, plan.targetHeight);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, plan.drawX, plan.drawY, plan.drawWidth, plan.drawHeight);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: .92 });
    self.postMessage({ id, plan, blob });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : "图片预处理失败" });
  } finally {
    bitmap?.close();
  }
};

export {};
