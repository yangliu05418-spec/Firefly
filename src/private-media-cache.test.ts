import { afterEach, describe, expect, it, vi } from "vitest";
import { PRIVATE_MEDIA_CACHE_NAME, PRIVATE_MEDIA_SERVICE_WORKER_URL, forgetPrivateMediaCacheUser, persistPrivateMediaStorage, scopePrivateMediaCacheToUser } from "./private-media-cache";

const browser = () => {
  const values = new Map<string, string>();
  const deleted: string[] = [];
  const messages: unknown[] = [];
  vi.stubGlobal("window", {
    caches: { delete: async (name: string) => { deleted.push(name); return true; } },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
  });
  vi.stubGlobal("navigator", { serviceWorker: { controller: { postMessage: (message: unknown) => messages.push(message) } } });
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
    expect(state.deleted).toEqual([]);

    await scopePrivateMediaCacheToUser("user-b");
    expect(state.deleted).toEqual([PRIVATE_MEDIA_CACHE_NAME]);
    expect(state.messages).toEqual([{ type: "CLEAR_PRIVATE_MEDIA_CACHE" }]);
    expect([...state.values.values()]).toEqual(["user-b"]);
  });

  it("removes cached media and the browser account marker on logout", async () => {
    const state = browser();
    await scopePrivateMediaCacheToUser("user-a");
    await forgetPrivateMediaCacheUser();
    expect(state.deleted).toEqual([PRIVATE_MEDIA_CACHE_NAME]);
    expect(state.values.size).toBe(0);
  });

  it("asks the browser to protect native asset caches from automatic eviction", async () => {
    const persisted = vi.fn(async () => false);
    const persist = vi.fn(async () => true);
    vi.stubGlobal("navigator", { storage: { persisted, persist } });

    await expect(persistPrivateMediaStorage()).resolves.toBe(true);
    await expect(persistPrivateMediaStorage()).resolves.toBe(true);

    expect(persisted).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
