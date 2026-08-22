import { bestEffortWithin } from "./best-effort";

export const PRIVATE_MEDIA_CACHE_NAME = "firefly-private-pending-assets-v1";
export const PRIVATE_MEDIA_CACHE_PREFIX = "firefly-private-thumbnails-v2-";
export const PRIVATE_MEDIA_LEGACY_CACHE_NAME = "firefly-private-thumbnails-v1";
export const PRIVATE_MEDIA_SERVICE_WORKER_URL = "/api/firefly-media-sw.js";
const PRIVATE_MEDIA_CACHE_USER_KEY = "firefly-private-media-cache-user";
const CACHE_OPERATION_BUDGET_MS = 300;
let persistenceRequest: Promise<boolean> | undefined;
let currentPrivateMediaUser = "";

const hasCacheStorage = () => typeof window !== "undefined" && "caches" in window;

/** Ask the browser not to evict Firefly's IndexedDB and CacheStorage under storage pressure. */
export function persistPrivateMediaStorage() {
  if (persistenceRequest) return persistenceRequest;
  if (typeof navigator === "undefined" || !navigator.storage?.persisted || !navigator.storage?.persist) return Promise.resolve(false);
  const request = navigator.storage.persisted()
    .then((persisted) => persisted || navigator.storage.persist())
    .catch(() => false);
  persistenceRequest = request;
  void request.then(() => {
    // Browsers can deny a bootstrap-time request before the user has interacted
    // with Firefly. Deduplicate concurrent calls, then re-check on later asset
    // or upload clicks so a real user gesture can obtain persistence.
    if (persistenceRequest === request) persistenceRequest = undefined;
  });
  return request;
}

export async function clearPrivateMediaCache() {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    // Revoke access before touching optional CacheStorage. Even a stuck cache
    // cleanup can no longer expose the previous user's namespace.
    navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_PRIVATE_MEDIA_CACHE" });
  }
  if (hasCacheStorage()) {
    try {
      const names = typeof window.caches.keys === "function" ? await window.caches.keys() : [];
      const targets = new Set([PRIVATE_MEDIA_CACHE_NAME, PRIVATE_MEDIA_LEGACY_CACHE_NAME, ...names.filter((name) => name.startsWith(PRIVATE_MEDIA_CACHE_PREFIX))]);
      await Promise.all([...targets].map((name) => window.caches.delete(name)));
    }
    catch { /* Private media caching is a performance enhancement, never a product dependency. */ }
  }
}

const postPrivateMediaScope = async (userId: string) => {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const controller = navigator.serviceWorker.controller;
  if (!controller) return;
  if (typeof MessageChannel === "undefined") {
    controller.postMessage({ type: "SET_PRIVATE_MEDIA_CACHE_SCOPE", userId });
    return;
  }
  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    const timer = globalThis.setTimeout(resolve, 500);
    channel.port1.onmessage = () => { globalThis.clearTimeout(timer); resolve(); };
    controller.postMessage({ type: "SET_PRIVATE_MEDIA_CACHE_SCOPE", userId }, [channel.port2]);
  });
};

export async function deactivatePrivateMediaCacheScope() {
  currentPrivateMediaUser = "";
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_PRIVATE_MEDIA_CACHE_SCOPE" });
}

/**
 * CacheStorage is shared by every Firefly login in the same browser profile.
 * Clear it whenever the authenticated user changes so private thumbnails never
 * cross account boundaries on a shared workstation.
 */
export async function scopePrivateMediaCacheToUser(userId: string) {
  if (typeof window === "undefined") return;
  let previous = "";
  try { previous = window.localStorage.getItem(PRIVATE_MEDIA_CACHE_USER_KEY) ?? ""; }
  catch { /* Storage can be unavailable in hardened/private browsing modes. */ }
  // Remove the legacy shared cache on every authenticated bootstrap. Scoped
  // caches remain available for the same user and are cleared on account swap.
  if (previous && previous !== userId) {
    // Prevent a restarted worker from restoring the previous scope while its
    // best-effort disk cleanup is still consuming the bounded time budget.
    currentPrivateMediaUser = "";
    await bestEffortWithin(clearPrivateMediaCache(), CACHE_OPERATION_BUDGET_MS);
  } else {
    void bestEffortWithin(window.caches?.delete(PRIVATE_MEDIA_LEGACY_CACHE_NAME) ?? Promise.resolve(false), CACHE_OPERATION_BUDGET_MS);
  }
  try { window.localStorage.setItem(PRIVATE_MEDIA_CACHE_USER_KEY, userId); }
  catch { /* The native HTTP cache remains available when localStorage is blocked. */ }
  currentPrivateMediaUser = userId;
  await postPrivateMediaScope(userId);
  void persistPrivateMediaStorage();
}

export async function forgetPrivateMediaCacheUser() {
  await deactivatePrivateMediaCacheScope();
  await clearPrivateMediaCache();
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(PRIVATE_MEDIA_CACHE_USER_KEY); }
  catch { /* Best-effort privacy cleanup. */ }
}

export async function respondToPrivateMediaCacheScopeRequest(message: unknown) {
  if ((message as { type?: unknown })?.type === "REQUEST_PRIVATE_MEDIA_CACHE_SCOPE" && currentPrivateMediaUser) {
    await postPrivateMediaScope(currentPrivateMediaUser);
  }
}

export function registerPrivateMediaCache() {
  if (!import.meta.env.PROD || import.meta.env.VITE_DISABLE_PRIVATE_MEDIA_CACHE === "true" || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (event) => {
    void respondToPrivateMediaCacheScopeRequest(event.data);
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (currentPrivateMediaUser) void postPrivateMediaScope(currentPrivateMediaUser);
  });
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(PRIVATE_MEDIA_SERVICE_WORKER_URL, { scope: "/", updateViaCache: "none" }).catch(() => undefined);
  }, { once: true });
}
