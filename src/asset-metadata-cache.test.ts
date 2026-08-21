import { describe, expect, it } from "vitest";
import { createAssetMetadataCache, filterCachedAssets, loadAssetsCacheFirst, type AssetCacheRecord, type AssetMetadataStore } from "./asset-metadata-cache";
import type { AssetCategory, LibraryAsset } from "./types";

const makeStore = () => {
  const records = new Map<string, AssetCacheRecord>();
  const store: AssetMetadataStore = {
    get: async (userId) => records.get(userId),
    put: async (record) => { records.set(record.userId, structuredClone(record)); },
    delete: async (userId) => { records.delete(userId); },
  };
  return { records, store };
};

const asset = (id: string, category: AssetCategory = "material", type: LibraryAsset["AssetType"] = "Image"): LibraryAsset => ({
  Id: id,
  Name: `素材 ${id}`,
  AssetType: type,
  Status: "Active",
  GroupId: "group-1",
  Category: category,
  URL: `/api/assets/${id}/source`,
});

describe("asset metadata cache", () => {
  it("isolates records by authenticated user", async () => {
    const { store } = makeStore();
    const cache = createAssetMetadataCache(store);
    await Promise.all([cache.replace("user-a", [asset("a")]), cache.replace("user-b", [asset("b")])]);
    expect((await cache.read("user-a")).map((item) => item.Id)).toEqual(["a"]);
    expect((await cache.read("user-b")).map((item) => item.Id)).toEqual(["b"]);
  });

  it("serializes concurrent mutations without losing uploads", async () => {
    const { store } = makeStore();
    const cache = createAssetMetadataCache(store);
    await cache.replace("user-a", [asset("old")]);
    await Promise.all([cache.merge("user-a", [asset("new-1")]), cache.merge("user-a", [asset("new-2")])]);
    expect((await cache.read("user-a")).map((item) => item.Id)).toEqual(["new-2", "new-1", "old"]);
  });

  it("reconciles a complete media type while preserving other assets", async () => {
    const { store } = makeStore();
    const cache = createAssetMetadataCache(store);
    await cache.replace("user-a", [asset("stale-image"), asset("video", "material", "Video")]);
    await cache.replaceType("user-a", "Image", [asset("fresh-image", "scene")]);
    expect((await cache.read("user-a")).map((item) => item.Id)).toEqual(["fresh-image", "video"]);
  });

  it("expires old metadata and clears it on sign-out", async () => {
    const { records, store } = makeStore();
    let time = 1_000;
    const cache = createAssetMetadataCache(store, () => time);
    await cache.replace("user-a", [asset("a")]);
    time += 8 * 24 * 60 * 60 * 1000;
    expect(await cache.read("user-a")).toEqual([]);
    expect(records.has("user-a")).toBe(false);
    await cache.replace("user-a", [asset("b")]);
    await cache.clear("user-a");
    expect(await cache.read("user-a")).toEqual([]);
  });

  it("filters the cached first paint without changing the canonical list", () => {
    const source = [asset("hero", "character"), asset("street", "scene"), asset("clip", "material", "Video")];
    expect(filterCachedAssets(source, { type: "Image", query: "street", category: "scene" }).map((item) => item.Id)).toEqual(["street"]);
    expect(source).toHaveLength(3);
  });

  it("paints cached assets before a fresh response and then reconciles", async () => {
    const { store } = makeStore();
    const cache = createAssetMetadataCache(store);
    await cache.replace("user-a", [asset("cached")]);
    let resolveFresh!: (assets: LibraryAsset[]) => void;
    const fresh = new Promise<LibraryAsset[]>((resolve) => { resolveFresh = resolve; });
    const painted: string[][] = [];
    let resolvePainted!: () => void;
    const firstPaint = new Promise<void>((resolve) => { resolvePainted = resolve; });
    const loading = loadAssetsCacheFirst({ userId: "user-a", cache, loadFresh: () => fresh, onCached: (assets) => { painted.push(assets.map((item) => item.Id)); resolvePainted(); } });
    await firstPaint;
    expect(painted).toEqual([["cached"]]);
    resolveFresh([asset("fresh")]);
    expect(await loading).toMatchObject({ source: "network", assets: [{ Id: "fresh" }] });
    expect((await cache.read("user-a")).map((item) => item.Id)).toEqual(["fresh", "cached"]);
  });

  it("keeps cached assets when background refresh fails", async () => {
    const { store } = makeStore();
    const cache = createAssetMetadataCache(store);
    await cache.replace("user-a", [asset("cached")]);
    const result = await loadAssetsCacheFirst({ userId: "user-a", cache, loadFresh: async () => { throw new Error("offline"); } });
    expect(result.source).toBe("cache");
    expect(result.assets.map((item) => item.Id)).toEqual(["cached"]);
    expect((await cache.read("user-a")).map((item) => item.Id)).toEqual(["cached"]);
  });
});
