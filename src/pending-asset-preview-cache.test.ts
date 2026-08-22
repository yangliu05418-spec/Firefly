import { afterEach, describe, expect, it, vi } from "vitest";
import { readPendingAssetPreview, readPendingAssetPreviews, removePendingAssetPreview, storePendingAssetPreview } from "./pending-asset-preview-cache";

const browserCache = () => {
  const entries = new Map<string, Response>();
  const cache = {
    async put(request: Request, response: Response) { entries.set(request.url, response.clone()); },
    async match(request: Request) { return entries.get(request.url)?.clone(); },
    async delete(request: Request) { return entries.delete(request.url); },
    async keys() { return [...entries.keys()].map((url) => new Request(url)); },
  };
  vi.stubGlobal("location", new URL("https://firefly.example/studio"));
  vi.stubGlobal("window", { caches: { open: async () => cache } });
  return entries;
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("pending asset preview cache", () => {
  it("restores an uploaded thumbnail only for its authenticated user", async () => {
    browserCache();
    const preview = new Blob(["preview"], { type: "image/webp" });
    await storePendingAssetPreview("user-a", "asset-1", preview);

    expect(await (await readPendingAssetPreview("user-a", "asset-1"))?.text()).toBe("preview");
    expect(await readPendingAssetPreview("user-b", "asset-1")).toBeUndefined();
  });

  it("restores a page of previews with one CacheStorage open", async () => {
    browserCache();
    await storePendingAssetPreview("user-a", "asset-1", new Blob(["one"]));
    await storePendingAssetPreview("user-a", "asset-2", new Blob(["two"]));

    const restored = await readPendingAssetPreviews("user-a", ["asset-1", "asset-2", "missing"]);
    expect(await restored.get("asset-1")?.text()).toBe("one");
    expect(await restored.get("asset-2")?.text()).toBe("two");
    expect(restored.has("missing")).toBe(false);
  });

  it("expires pending previews and supports explicit cleanup", async () => {
    const entries = browserCache();
    vi.spyOn(Date, "now").mockReturnValue(1000);
    await storePendingAssetPreview("user-a", "asset-1", new Blob(["preview"]));
    await removePendingAssetPreview("user-a", "asset-1");
    expect(entries.size).toBe(0);

    await storePendingAssetPreview("user-a", "asset-2", new Blob(["preview"]));
    vi.spyOn(Date, "now").mockReturnValue(1000 + 24 * 60 * 60 * 1000 + 1);
    expect(await readPendingAssetPreview("user-a", "asset-2")).toBeUndefined();
    expect(entries.size).toBe(0);
  });
});
