export const PRIVATE_MEDIA_CACHE_NAME = "firefly-private-thumbnails-v1";
export const PRIVATE_MEDIA_SERVICE_WORKER_URL = "/api/firefly-media-sw.js";
const PRIVATE_MEDIA_CACHE_USER_KEY = "firefly-private-media-cache-user";

const hasCacheStorage = () => typeof window !== "undefined" && "caches" in window;

export async function clearPrivateMediaCache() {
  if (hasCacheStorage()) {
    try { await window.caches.delete(PRIVATE_MEDIA_CACHE_NAME); }
    catch { /* Private media caching is a performance enhancement, never a product dependency. */ }
  }
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_PRIVATE_MEDIA_CACHE" });
  }
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
  if (previous && previous !== userId) await clearPrivateMediaCache();
  try { window.localStorage.setItem(PRIVATE_MEDIA_CACHE_USER_KEY, userId); }
  catch { /* The native HTTP cache remains available when localStorage is blocked. */ }
}

export async function forgetPrivateMediaCacheUser() {
  await clearPrivateMediaCache();
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(PRIVATE_MEDIA_CACHE_USER_KEY); }
  catch { /* Best-effort privacy cleanup. */ }
}

export function registerPrivateMediaCache() {
  if (!import.meta.env.PROD || import.meta.env.VITE_DISABLE_PRIVATE_MEDIA_CACHE === "true" || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(PRIVATE_MEDIA_SERVICE_WORKER_URL, { scope: "/", updateViaCache: "none" }).catch(() => undefined);
  }, { once: true });
}
