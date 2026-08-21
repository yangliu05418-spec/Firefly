import { PRIVATE_MEDIA_CACHE_NAME } from "./private-media-cache";

const PENDING_PREVIEW_PREFIX = "/api/client-cache/pending-assets/";
const MAX_PENDING_PREVIEWS = 100;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const storageAvailable = () => typeof window !== "undefined" && "caches" in window;
const requestFor = (userId: string, assetId: string) => new Request(
  `${location.origin}${PENDING_PREVIEW_PREFIX}${encodeURIComponent(userId)}/${encodeURIComponent(assetId)}`,
);

const trim = async (cache: Cache) => {
  const keys = (await cache.keys()).filter((request) => new URL(request.url).pathname.startsWith(PENDING_PREVIEW_PREFIX));
  const overflow = keys.length - MAX_PENDING_PREVIEWS;
  if (overflow > 0) await Promise.all(keys.slice(0, overflow).map((request) => cache.delete(request)));
};

export async function storePendingAssetPreview(userId: string, assetId: string, blob: Blob) {
  if (!storageAvailable()) return;
  try {
    const cache = await window.caches.open(PRIVATE_MEDIA_CACHE_NAME);
    await cache.put(requestFor(userId, assetId), new Response(blob, {
      headers: { "Content-Type": blob.type || "image/webp", "X-Firefly-Cached-At": String(Date.now()) },
    }));
    void trim(cache).catch(() => undefined);
  } catch { /* A preview cache failure must never block an upload. */ }
}

export async function readPendingAssetPreview(userId: string, assetId: string) {
  if (!storageAvailable()) return undefined;
  try {
    const cache = await window.caches.open(PRIVATE_MEDIA_CACHE_NAME);
    const request = requestFor(userId, assetId);
    const response = await cache.match(request);
    if (!response) return undefined;
    const cachedAt = Number(response.headers.get("X-Firefly-Cached-At") ?? 0);
    if (!cachedAt || Date.now() - cachedAt > MAX_AGE_MS) {
      await cache.delete(request);
      return undefined;
    }
    return await response.blob();
  } catch { return undefined; }
}

export async function removePendingAssetPreview(userId: string, assetId: string) {
  if (!storageAvailable()) return;
  try {
    const cache = await window.caches.open(PRIVATE_MEDIA_CACHE_NAME);
    await cache.delete(requestFor(userId, assetId));
  } catch { /* Best-effort cleanup. */ }
}
