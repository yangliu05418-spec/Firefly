import { describe, expect, it, vi } from "vitest";
import { createImageModelCatalogCache, createSharedImageModelCatalogLoader, loadImageModelCatalogCacheFirst, type ImageModelCatalog, type ImageModelCatalogStore } from "./image-model-catalog";

const catalog = (id = "image-1"): ImageModelCatalog => ({
  Items: [{ id, name: `模型 ${id}`, resolutions: ["1024"], defaultResolution: "1024", maxCount: 4 }],
  Ratios: ["1:1", "16:9"],
  DefaultModel: id,
});

const memoryStore = () => {
  let value: unknown;
  const store: ImageModelCatalogStore = {
    read: async () => structuredClone(value),
    write: async (record) => { value = structuredClone(record); },
  };
  return { store, value: () => value };
};

describe("image model catalog", () => {
  it("paints a valid cached catalog before the background refresh", async () => {
    const memory = memoryStore();
    const cache = createImageModelCatalogCache(memory.store, () => 1_000);
    await cache.write(catalog("cached"));
    let resolveFresh!: (value: ImageModelCatalog) => void;
    const fresh = new Promise<ImageModelCatalog>((resolve) => { resolveFresh = resolve; });
    let resolvePainted!: () => void;
    const painted = new Promise<void>((resolve) => { resolvePainted = resolve; });
    const seen: string[] = [];
    const loading = loadImageModelCatalogCacheFirst({ cache, loadFresh: () => fresh, onCached: (value) => { seen.push(value.DefaultModel); resolvePainted(); } });

    await painted;
    expect(seen).toEqual(["cached"]);
    resolveFresh(catalog("fresh"));
    expect(await loading).toMatchObject({ source: "network", catalog: { DefaultModel: "fresh" } });
    expect((await cache.read())?.DefaultModel).toBe("fresh");
  });

  it("keeps the last valid catalog when refresh or storage fails", async () => {
    const memory = memoryStore();
    const cache = createImageModelCatalogCache(memory.store, () => 1_000);
    await cache.write(catalog("cached"));
    const result = await loadImageModelCatalogCacheFirst({ cache, loadFresh: async () => { throw new Error("offline"); } });
    expect(result.source).toBe("cache");
    expect(result.catalog.DefaultModel).toBe("cached");

    const blocked = createImageModelCatalogCache({ read: async () => { throw new Error("blocked"); }, write: async () => { throw new Error("full"); } });
    await expect(loadImageModelCatalogCacheFirst({ cache: blocked, loadFresh: async () => catalog("network") })).resolves.toMatchObject({ source: "network" });
  });

  it("rejects malformed or expired cache records", async () => {
    const malformed: ImageModelCatalogStore = { read: async () => ({ version: 1, updatedAt: 1_000, catalog: { Items: [], Ratios: [], DefaultModel: "missing" } }), write: async () => undefined };
    expect(await createImageModelCatalogCache(malformed, () => 1_000).read()).toBeUndefined();
    const memory = memoryStore(); const cache = createImageModelCatalogCache(memory.store, () => 1_000);
    await cache.write(catalog());
    expect(await createImageModelCatalogCache(memory.store, () => 8 * 24 * 60 * 60 * 1000).read()).toBeUndefined();
  });

  it("deduplicates concurrent requests and retries after a failed first load", async () => {
    const load = vi.fn<() => Promise<ImageModelCatalog>>().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(catalog("ready"));
    const shared = createSharedImageModelCatalogLoader(load);
    await expect(Promise.all([shared.load(), shared.load()])).rejects.toThrow("offline");
    expect(load).toHaveBeenCalledTimes(1);
    await expect(shared.load()).resolves.toMatchObject({ DefaultModel: "ready" });
    await expect(shared.load()).resolves.toMatchObject({ DefaultModel: "ready" });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
