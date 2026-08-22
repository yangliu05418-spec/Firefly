import { afterEach, describe, expect, it, vi } from "vitest";
import { PRIVATE_MEDIA_CACHE_NAME, PRIVATE_MEDIA_CACHE_PREFIX, PRIVATE_MEDIA_LEGACY_CACHE_NAME, PRIVATE_MEDIA_SERVICE_WORKER_URL, deactivatePrivateMediaCacheScope, forgetPrivateMediaCacheUser, persistPrivateMediaStorage, respondToPrivateMediaCacheScopeRequest, scopePrivateMediaCacheToUser } from "./private-media-cache";

const browser = () => {
  const values = new Map<string, string>();
  const deleted: string[] = [];
  const messages: unknown[] = [];
  vi.stubGlobal("window", {
    caches: { keys: async () => [`${PRIVATE_MEDIA_CACHE_PREFIX}user-a`], delete: async (name: string) => { deleted.push(name); return true; } },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
  });
  vi.stubGlobal("navigator", { serviceWorker: { controller: { postMessage: (message: unknown, transfer?: MessagePort[]) => { messages.push(message); transfer?.[0]?.postMessage({ ok: true }); } } } });
  return { values, deleted, messages };
};

afterEach(() => vi.unstubAllGlobals());

describe("private media cache account scope", () => {
  it("loads its bootstrap through the non-static API route", () => {
    expect(PRIVATE_MEDIA_SERVICE_WORKER_URL).toBe("/api/firefly-media-sw.js");
  });

  it("keeps one user's cache and clears it before switching users", async () => {
    const state = browser();
    await scopePrivateMediaCacheToUser("user-a");
    await scopePrivateMediaCacheToUser("user-a");
    expect(state.deleted).toEqual([PRIVATE_MEDIA_LEGACY_CACHE_NAME, PRIVATE_MEDIA_LEGACY_CACHE_NAME]);

    await scopePrivateMediaCacheToUser("user-b");
    expect(state.deleted).toContain(PRIVATE_MEDIA_CACHE_NAME);
    expect(state.deleted).toContain(PRIVATE_MEDIA_LEGACY_CACHE_NAME);
    expect(state.deleted).toContain(`${PRIVATE_MEDIA_CACHE_PREFIX}user-a`);
    expect(state.messages).toEqual([
      { type: "SET_PRIVATE_MEDIA_CACHE_SCOPE", userId: "user-a" },
      { type: "SET_PRIVATE_MEDIA_CACHE_SCOPE", userId: "user-a" },
      { type: "CLEAR_PRIVATE_MEDIA_CACHE" },
      { type: "SET_PRIVATE_MEDIA_CACHE_SCOPE", userId: "user-b" },
    ]);
    expect([...state.values.values()]).toEqual(["user-b"]);
  });

  it("removes cached media and the browser account marker on logout", async () => {
    const state = browser();
    await scopePrivateMediaCacheToUser("user-a");
    await forgetPrivateMediaCacheUser();
    expect(state.deleted).toContain(PRIVATE_MEDIA_CACHE_NAME);
    expect(state.deleted).toContain(PRIVATE_MEDIA_LEGACY_CACHE_NAME);
    expect(state.deleted).toContain(`${PRIVATE_MEDIA_CACHE_PREFIX}user-a`);
    expect(state.values.size).toBe(0);
  });

  it("sets the worker scope even when localStorage is unavailable", async () => {
    const state = browser();
    vi.stubGlobal("window", {
      caches: { keys: async () => [], delete: async () => true },
      localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } },
    });
    await scopePrivateMediaCacheToUser("user-private");
    expect(state.messages.at(-1)).toEqual({ type: "SET_PRIVATE_MEDIA_CACHE_SCOPE", userId: "user-private" });
  });

  it("deactivates cache reads as soon as authentication is lost", async () => {
    const state = browser();
    await scopePrivateMediaCacheToUser("user-a");
    await deactivatePrivateMediaCacheScope();
    expect(state.messages.at(-1)).toEqual({ type: "CLEAR_PRIVATE_MEDIA_CACHE_SCOPE" });
  });

  it("restores the authenticated scope when a restarted worker requests it", async () => {
    const state = browser();
    await scopePrivateMediaCacheToUser("user-a");
    await respondToPrivateMediaCacheScopeRequest({ type: "REQUEST_PRIVATE_MEDIA_CACHE_SCOPE" });
    expect(state.messages.at(-1)).toEqual({ type: "SET_PRIVATE_MEDIA_CACHE_SCOPE", userId: "user-a" });
  });

  it("asks the browser to protect native asset caches from automatic eviction", async () => {
    const persisted = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const persist = vi.fn(async () => true);
    vi.stubGlobal("navigator", { storage: { persisted, persist } });

    await expect(persistPrivateMediaStorage()).resolves.toBe(true);
    await expect(persistPrivateMediaStorage()).resolves.toBe(true);

    expect(persisted).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("retries a denied bootstrap request from a later user gesture", async () => {
    const persisted = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const persist = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    vi.stubGlobal("navigator", { storage: { persisted, persist } });

    await expect(persistPrivateMediaStorage()).resolves.toBe(false);
    await expect(persistPrivateMediaStorage()).resolves.toBe(true);
    await expect(persistPrivateMediaStorage()).resolves.toBe(true);

    expect(persisted).toHaveBeenCalledTimes(3);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("does not let a hanging CacheStorage cleanup block the next authenticated user", async () => {
    vi.useFakeTimers();
    try {
      const state = browser();
      await scopePrivateMediaCacheToUser("user-old");
      const never = new Promise<never>(() => undefined);
      window.caches.keys = () => never;
      window.caches.delete = () => never;

      const switching = scopePrivateMediaCacheToUser("user-new");
      await respondToPrivateMediaCacheScopeRequest({ type: "REQUEST_PRIVATE_MEDIA_CACHE_SCOPE" });
      expect(state.messages.at(-1)).toEqual({ type: "CLEAR_PRIVATE_MEDIA_CACHE" });
      await vi.advanceTimersByTimeAsync(300);
      await switching;

      expect(state.messages.slice(-2)).toEqual([
        { type: "CLEAR_PRIVATE_MEDIA_CACHE" },
        { type: "SET_PRIVATE_MEDIA_CACHE_SCOPE", userId: "user-new" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
