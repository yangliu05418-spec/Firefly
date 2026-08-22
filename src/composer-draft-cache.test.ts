import { describe, expect, it } from "vitest";
import { clearComposerDraftInBackground, createComposerDraftCache, type ComposerDraftRecord, type ComposerDraftState, type ComposerDraftStore } from "./composer-draft-cache";

const state = (patch: Partial<ComposerDraftState> = {}): ComposerDraftState => ({
  engine: "video", prompt: "雨夜街道", modelId: "seedance", mode: "omni", ratio: "16:9", resolution: "720p", duration: 5,
  generateAudio: true, cameraFixed: false, watermark: false, seed: -1,
  imageModelId: "image", imageRatio: "1:1", imageResolution: "1024", imageCount: 1, assets: [], ...patch,
});

const memoryStore = () => {
  const records = new Map<string, ComposerDraftRecord>();
  const store: ComposerDraftStore = {
    get: async (key) => records.get(key),
    put: async (record) => { records.set(record.key, structuredClone(record)); },
    delete: async (key) => { records.delete(key); },
    deleteUser: async (userId) => { for (const [key, record] of records) if (record.userId === userId) records.delete(key); },
  };
  return { store, records };
};

describe("composer draft cache", () => {
  it("isolates drafts by user and creation session and strips signed or blob URLs", async () => {
    const { store } = memoryStore();
    const cache = createComposerDraftCache(store, () => 1000);
    await cache.write("user-a", "session-a", state({ assets: [{ id: "upload-1", uploadId: "upload-1", name: "face.png", type: "image", size: 10, role: "reference_image", progress: 100, phase: "ready", preview: "blob:local", url: "https://signed.example" }] }));
    expect((await cache.read("user-a", "session-a"))?.state.assets[0]).toMatchObject({ uploadId: "upload-1", phase: "ready" });
    expect((await cache.read("user-a", "session-a"))?.state.assets[0]).not.toHaveProperty("preview");
    expect(await cache.read("user-b", "session-a")).toBeUndefined();
    expect(await cache.read("user-a", "session-b")).toBeUndefined();
  });

  it("drops expired direct uploads but keeps durable provider assets", async () => {
    const { store } = memoryStore();
    let current = 1000;
    const cache = createComposerDraftCache(store, () => current);
    await cache.write("user-a", "session-a", state({ assets: [
      { id: "upload-1", uploadId: "upload-1", name: "old.png", type: "image", size: 10, role: "reference_image", progress: 100, phase: "ready" },
      { id: "asset-1", assetId: "asset-1", name: "durable.png", type: "image", size: 10, role: "reference_image", progress: 100, status: "Active" },
    ] }));
    current += 7 * 24 * 60 * 60 * 1000;
    const restored = await cache.read("user-a", "session-a");
    expect(restored?.state.assets.map((asset) => asset.id)).toEqual(["asset-1"]);
    expect(restored?.droppedAssets).toBe(1);
  });

  it("does not persist local files before transport has produced an opaque id", async () => {
    const { store } = memoryStore();
    const cache = createComposerDraftCache(store, () => 1000);
    await cache.write("user-a", "session-a", state({ assets: [{ id: "temporary", name: "pending.png", type: "image", size: 10, role: "reference_image", progress: 40, phase: "uploading" }] }));
    expect((await cache.read("user-a", "session-a"))?.state.assets).toEqual([]);
  });

  it("clears every session owned by a signed-out user", async () => {
    const { store } = memoryStore();
    const cache = createComposerDraftCache(store, () => 1000);
    await cache.write("user-a", "session-a", state());
    await cache.write("user-a", "session-b", state());
    await cache.write("user-b", "session-a", state());
    await cache.clearUser("user-a");
    expect(await cache.read("user-a", "session-a")).toBeUndefined();
    expect(await cache.read("user-a", "session-b")).toBeUndefined();
    expect(await cache.read("user-b", "session-a")).toBeDefined();
  });

  it("never makes generation wait for a slow or failed IndexedDB cleanup", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const cache = { clearSession: () => pending };

    expect(clearComposerDraftInBackground(cache, "user-a", "session-a")).toBeUndefined();
    finish();
    await pending;

    const failed = { clearSession: async () => { throw new Error("IndexedDB unavailable"); } };
    expect(clearComposerDraftInBackground(failed, "user-a", "session-a")).toBeUndefined();
    await Promise.resolve();
  });
});
