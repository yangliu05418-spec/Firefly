import type { ImageNormalizationPlan } from "./image-normalize-policy";

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

export const prepareImageForUpload = async (file: File, signal?: AbortSignal): Promise<PreparedImage> => {
  await acquireNormalizationSlot(signal);
  try {
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
