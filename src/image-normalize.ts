import { imageNormalizationPlan, type ImageNormalizationPlan } from "./image-normalize-policy";

export type PreparedImage = { file: File; normalized: boolean; plan?: ImageNormalizationPlan };

let activeNormalizations = 0;
const normalizationWaiters: (() => void)[] = [];

const acquireNormalizationSlot = (signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason ?? new DOMException("操作已取消", "AbortError"));
  const enter = () => { activeNormalizations += 1; resolve(); };
  if (activeNormalizations < 2) return enter();
  const queued = () => { signal?.removeEventListener("abort", cancel); enter(); };
  const cancel = () => {
    const index = normalizationWaiters.indexOf(queued);
    if (index >= 0) normalizationWaiters.splice(index, 1);
    reject(signal?.reason ?? new DOMException("操作已取消", "AbortError"));
  };
  signal?.addEventListener("abort", cancel, { once: true });
  normalizationWaiters.push(queued);
});

const releaseNormalizationSlot = () => {
  activeNormalizations = Math.max(0, activeNormalizations - 1);
  normalizationWaiters.shift()?.();
};

const normalizedName = (name: string) => `${name.replace(/\.[^.]+$/u, "") || "image"}-firefly.jpg`;

const abortError = (signal?: AbortSignal) => signal?.reason ?? new DOMException("操作已取消", "AbortError");

const normalizeOnMainThread = async (file: File, signal?: AbortSignal): Promise<PreparedImage> => {
  if (signal?.aborted) throw abortError(signal);
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      const cleanup = () => signal?.removeEventListener("abort", cancel);
      const cancel = () => { cleanup(); element.src = ""; reject(abortError(signal)); };
      element.onload = () => { cleanup(); resolve(element); };
      element.onerror = () => { cleanup(); reject(new Error("浏览器无法读取这张图片，请转换为 JPG、PNG 或 WebP 后重试")); };
      signal?.addEventListener("abort", cancel, { once: true });
      element.decoding = "async";
      element.src = url;
    });
    if (signal?.aborted) throw abortError(signal);
    const plan = imageNormalizationPlan(image.naturalWidth, image.naturalHeight);
    if (!plan.adjusted) return { file, normalized: false, plan };
    const canvas = document.createElement("canvas");
    canvas.width = plan.targetWidth;
    canvas.height = plan.targetHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("浏览器无法创建图片画布");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, plan.targetWidth, plan.targetHeight);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, plan.drawX, plan.drawY, plan.drawWidth, plan.drawHeight);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("图片补白失败，请重试")), "image/jpeg", .92));
    if (signal?.aborted) throw abortError(signal);
    return { file: new File([blob], normalizedName(file.name), { type: "image/jpeg", lastModified: file.lastModified }), normalized: true, plan };
  } finally {
    URL.revokeObjectURL(url);
  }
};

export const prepareImageForUpload = async (file: File, signal?: AbortSignal): Promise<PreparedImage> => {
  await acquireNormalizationSlot(signal);
  try {
    // Safari exposes Canvas but not OffscreenCanvas inside workers. Keep the
    // high-performance worker path elsewhere and use the native DOM fallback
    // only when the worker primitive is unavailable.
    if (typeof OffscreenCanvas === "undefined") return await normalizeOnMainThread(file, signal);
    return await new Promise<PreparedImage>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason ?? new DOMException("操作已取消", "AbortError"));
      const worker = new Worker(new URL("./image-normalize.worker.ts", import.meta.url), { type: "module" });
      const id = crypto.randomUUID();
      const finish = () => { globalThis.clearTimeout(timer); signal?.removeEventListener("abort", abort); worker.terminate(); };
      const abort = () => { finish(); reject(signal?.reason ?? new DOMException("操作已取消", "AbortError")); };
      const timer = globalThis.setTimeout(() => { finish(); reject(new Error("图片预处理超时，请缩小图片后重试")); }, 90_000);
      worker.onerror = () => { finish(); reject(new Error("浏览器无法处理这张图片，请转换为 JPG、PNG 或 WebP 后重试")); };
      worker.onmessage = (event: MessageEvent<{ id: string; plan?: ImageNormalizationPlan; blob?: Blob; error?: string }>) => {
        if (event.data.id !== id) return;
        finish();
        if (event.data.error || !event.data.plan) return reject(new Error(event.data.error ?? "图片预处理失败"));
        if (!event.data.plan.adjusted) return resolve({ file, normalized: false, plan: event.data.plan });
        if (!event.data.blob) return reject(new Error("图片补白失败，请重试"));
        resolve({ file: new File([event.data.blob], normalizedName(file.name), { type: "image/jpeg", lastModified: file.lastModified }), normalized: true, plan: event.data.plan });
      };
      signal?.addEventListener("abort", abort, { once: true });
      worker.postMessage({ id, file });
    });
  } finally { releaseNormalizationSlot(); }
};
