/* Firefly private thumbnail cache. Originals and video ranges intentionally bypass it. */
const PRIVATE_MEDIA_CACHE = "firefly-private-thumbnails-v1";
const PRIVATE_MEDIA_CACHE_PREFIX = "firefly-private-thumbnails-";
const MAX_PRIVATE_THUMBNAILS = 300;

const isPrivateThumbnail = (request) => {
  if (request.method !== "GET" || request.destination !== "image") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  const thumbnail = url.searchParams.get("variant") === "thumbnail";
  return (thumbnail && /^\/api\/assets\/[^/]+\/source$/.test(url.pathname))
    || (thumbnail && /^\/api\/image-media\/[^/]+$/.test(url.pathname))
    || /^\/api\/generations\/[^/]+\/poster$/.test(url.pathname);
};

const trimCache = async (cache) => {
  const keys = await cache.keys();
  const overflow = keys.length - MAX_PRIVATE_THUMBNAILS;
  if (overflow > 0) await Promise.all(keys.slice(0, overflow).map((key) => cache.delete(key)));
};

const cacheFirst = async (request) => {
  const cache = await caches.open(PRIVATE_MEDIA_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    await cache.put(request, response.clone()).catch(() => undefined);
    void trimCache(cache).catch(() => undefined);
  }
  return response;
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(PRIVATE_MEDIA_CACHE_PREFIX) && name !== PRIVATE_MEDIA_CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  if (isPrivateThumbnail(event.request)) event.respondWith(cacheFirst(event.request));
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_PRIVATE_MEDIA_CACHE") event.waitUntil(caches.delete(PRIVATE_MEDIA_CACHE));
});
