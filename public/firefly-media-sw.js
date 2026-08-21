/* Firefly private thumbnail cache. Originals and video ranges intentionally bypass it. */
const PRIVATE_MEDIA_LEGACY_CACHE = "firefly-private-thumbnails-v1";
const PRIVATE_MEDIA_CACHE_PREFIX = "firefly-private-thumbnails-v2-";
const MAX_PRIVATE_THUMBNAILS = 300;
const clientScopes = new Map();
const pendingScopeRequests = new Map();
const SCOPE_RECOVERY_TIMEOUT_MS = 250;

const isPrivateThumbnail = (request) => {
  if (request.method !== "GET" || request.destination !== "image") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  const thumbnail = url.searchParams.get("variant") === "thumbnail";
  return (thumbnail && /^\/api\/assets\/[^/]+\/source$/.test(url.pathname))
    || (thumbnail && /^\/api\/image-media\/[^/]+$/.test(url.pathname))
    || (thumbnail && /^\/api\/canvas-project-assets\/[^/]+\/media$/.test(url.pathname))
    || /^\/api\/generations\/[^/]+\/poster$/.test(url.pathname);
};

const trimCache = async (cache) => {
  const keys = await cache.keys();
  const overflow = keys.length - MAX_PRIVATE_THUMBNAILS;
  if (overflow > 0) await Promise.all(keys.slice(0, overflow).map((key) => cache.delete(key)));
};

const canonicalCacheRequest = (request) => {
  const url = new URL(request.url);
  const isRetry = url.searchParams.has("_ff_retry");
  if (!isRetry) return { key: request, isRetry: false };
  url.searchParams.delete("_ff_retry");
  return { key: new Request(url.toString(), request), isRetry: true };
};

const recoverPrivateMediaScope = async (clientId) => {
  if (!clientId) return null;
  const current = clientScopes.get(clientId);
  if (current) return current;
  const pending = pendingScopeRequests.get(clientId);
  if (pending) return pending.promise;
  const client = await self.clients.get(clientId);
  if (!client) return null;
  const restored = clientScopes.get(clientId);
  if (restored) return restored;
  const inFlight = pendingScopeRequests.get(clientId);
  if (inFlight) return inFlight.promise;
  let finish;
  const promise = new Promise((resolve) => { finish = resolve; });
  const timer = setTimeout(() => {
    if (pendingScopeRequests.get(clientId)?.promise === promise) pendingScopeRequests.delete(clientId);
    finish(null);
  }, SCOPE_RECOVERY_TIMEOUT_MS);
  pendingScopeRequests.set(clientId, { promise, finish, timer });
  client.postMessage({ type: "REQUEST_PRIVATE_MEDIA_CACHE_SCOPE" });
  return promise;
};

const cacheFirst = async (request, clientId) => {
  const activeScope = await recoverPrivateMediaScope(clientId);
  if (!activeScope) return fetch(request);
  const cache = await caches.open(`${PRIVATE_MEDIA_CACHE_PREFIX}${activeScope}`);
  const { key, isRetry } = canonicalCacheRequest(request);
  const cached = isRetry ? undefined : await cache.match(key);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    await cache.put(key, response.clone()).catch(() => undefined);
    void trimCache(cache).catch(() => undefined);
  }
  return response;
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await caches.delete(PRIVATE_MEDIA_LEGACY_CACHE);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  if (isPrivateThumbnail(event.request)) event.respondWith(cacheFirst(event.request, event.clientId));
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "SET_PRIVATE_MEDIA_CACHE_SCOPE") {
    const userId = event.data.userId;
    const clientId = event.source?.id;
    const valid = typeof clientId === "string" && clientId.length > 0 && typeof userId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(userId);
    if (valid) clientScopes.set(clientId, userId);
    else if (clientId) clientScopes.delete(clientId);
    const pending = clientId ? pendingScopeRequests.get(clientId) : null;
    if (pending) {
      clearTimeout(pending.timer);
      pendingScopeRequests.delete(clientId);
      pending.finish(valid ? userId : null);
    }
    event.ports[0]?.postMessage({ ok: valid });
  }
  if (event.data?.type === "CLEAR_PRIVATE_MEDIA_CACHE_SCOPE" && event.source?.id) {
    const clientId = event.source.id;
    clientScopes.delete(clientId);
    const pending = pendingScopeRequests.get(clientId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingScopeRequests.delete(clientId);
      pending.finish(null);
    }
  }
  if (event.data?.type === "CLEAR_PRIVATE_MEDIA_CACHE") {
    clientScopes.clear();
    for (const pending of pendingScopeRequests.values()) { clearTimeout(pending.timer); pending.finish(null); }
    pendingScopeRequests.clear();
    event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((name) => name.startsWith(PRIVATE_MEDIA_CACHE_PREFIX) || name === PRIVATE_MEDIA_LEGACY_CACHE).map((name) => caches.delete(name)))));
  }
});
