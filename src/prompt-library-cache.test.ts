import { describe, expect, it } from "vitest";
import { createAssetMetadataCache, type AssetCacheRecord, type AssetMetadataStore } from "./asset-metadata-cache";
import { loadPromptLibraryCacheFirst, toPromptLibraryAsset } from "./prompt-library-cache";
import type { LibraryAsset } from "./types";
import { areAttachedUploadsAdmissible } from "./upload-state";

const makeAsset = (id: string, status: LibraryAsset["Status"] = "Active", type: LibraryAsset["AssetType"] = "Image"): LibraryAsset => ({
  Id: id,
  Name: `素材 ${id}`,
  AssetType: type,
  Status: status,
  GroupId: "group-1",
  Category: "material",
  URL: `/api/assets/${id}/source`,
  UploadId: `upload-${id}`,
});

const makeCache = () => {
  const records = new Map<string, AssetCacheRecord>();
  const store: AssetMetadataStore = {
    get: async (userId) => records.get(userId),
    put: async (record) => { records.set(record.userId, structuredClone(record)); },
    delete: async (userId) => { records.delete(userId); },
  };
  return createAssetMetadataCache(store);
};

describe("prompt library cache", () => {
  it("maps a provider asset into an immediately attachable prompt reference", () => {
    expect(toPromptLibraryAsset(makeAsset("clip", "Active", "Video"))).toMatchObject({
      id: "clip",
      uploadId: "upload-clip",
      assetId: "clip",
      type: "video",
      role: "reference_video",
      progress: 100,
      preview: "/api/assets/clip/source",
      status: "Active",
    });
  });

  it("keeps an active @ mention admissible for generation", () => {
    const reference = toPromptLibraryAsset(makeAsset("reference"));
    expect(areAttachedUploadsAdmissible([reference])).toBe(true);
  });

  it("paints only ready cached assets before the network refresh completes", async () => {
    const cache = makeCache();
    await cache.replace("user-a", [makeAsset("ready"), makeAsset("processing", "Processing")]);
    let resolveFresh!: (assets: LibraryAsset[]) => void;
    const fresh = new Promise<LibraryAsset[]>((resolve) => { resolveFresh = resolve; });
    let resolvePainted!: () => void;
    const painted = new Promise<void>((resolve) => { resolvePainted = resolve; });
    const firstPaint: string[][] = [];

    const loading = loadPromptLibraryCacheFirst({
      userId: "user-a",
      cache,
      loadFresh: () => fresh,
      onCached: (assets) => { firstPaint.push(assets.map((asset) => asset.id)); resolvePainted(); },
    });

    await painted;
    expect(firstPaint).toEqual([["ready"]]);
    resolveFresh([makeAsset("fresh"), makeAsset("failed", "Failed")]);
    expect((await loading).assets.map((asset) => asset.id)).toEqual(["fresh"]);
  });

  it("keeps ready cached references usable when the refresh fails", async () => {
    const cache = makeCache();
    await cache.replace("user-a", [makeAsset("cached")]);
    const result = await loadPromptLibraryCacheFirst({
      userId: "user-a",
      cache,
      loadFresh: async () => { throw new Error("offline"); },
    });
    expect(result.source).toBe("cache");
    expect(result.assets.map((asset) => asset.id)).toEqual(["cached"]);
  });
});
