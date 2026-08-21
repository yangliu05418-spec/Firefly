type TransformMessage = { url: string; cropRatio?: number; rotation?: 90 | 180 | 270 };
type WorkerPort = { onmessage: ((event: MessageEvent<TransformMessage>) => void) | null; postMessage: (value: unknown, transfer?: Transferable[]) => void };
const port = globalThis as unknown as WorkerPort;
const IMAGE_CACHE = "firefly-canvas-images-v1";
const MAX_CACHEABLE_IMAGE_BYTES = 32 * 1024 * 1024;

const readImageBlob = async (url: string) => {
  const request = new Request(new URL(url, location.origin), { credentials: "same-origin" });
  const cache = globalThis.caches ? await caches.open(IMAGE_CACHE) : undefined;
  const cached = await cache?.match(request);
  if (cached) return cached.blob();
  const response = await fetch(request, { cache: "force-cache" });
  if (!response.ok) throw new Error(`图片读取失败 (${response.status})`);
  const blob = await response.blob();
  if (cache && blob.size <= MAX_CACHEABLE_IMAGE_BYTES) {
    await cache.put(request, new Response(blob, { headers: { "Content-Type": blob.type || "image/*", "X-Firefly-Cached-At": String(Date.now()) } })).catch(() => undefined);
  }
  return blob;
};

port.onmessage = (event) => {
  void (async () => {
    if (!globalThis.OffscreenCanvas || !globalThis.createImageBitmap) throw new Error("当前浏览器不支持本地图片处理");
    const bitmap = await createImageBitmap(await readImageBlob(event.data.url));
    try {
      let sx = 0; let sy = 0; let sourceWidth = bitmap.width; let sourceHeight = bitmap.height;
      if (event.data.cropRatio) {
        const current = bitmap.width / bitmap.height;
        if (current > event.data.cropRatio) { sourceWidth = Math.round(bitmap.height * event.data.cropRatio); sx = Math.round((bitmap.width - sourceWidth) / 2); }
        else { sourceHeight = Math.round(bitmap.width / event.data.cropRatio); sy = Math.round((bitmap.height - sourceHeight) / 2); }
      }
      const rotation = event.data.rotation ?? 0;
      const swap = rotation === 90 || rotation === 270;
      const width = swap ? sourceHeight : sourceWidth;
      const height = swap ? sourceWidth : sourceHeight;
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("无法创建图片处理画布");
      context.fillStyle = "#fff"; context.fillRect(0, 0, width, height);
      context.translate(width / 2, height / 2); context.rotate(rotation * Math.PI / 180);
      context.drawImage(bitmap, sx, sy, sourceWidth, sourceHeight, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight);
      const blob = await canvas.convertToBlob({ type: "image/webp", quality: .94 });
      const buffer = await blob.arrayBuffer();
      port.postMessage({ type: "complete", buffer, width, height }, [buffer]);
    } finally { bitmap.close(); }
  })().catch((error) => port.postMessage({ type: "error", message: error instanceof Error ? error.message : "图片处理失败" }));
};
