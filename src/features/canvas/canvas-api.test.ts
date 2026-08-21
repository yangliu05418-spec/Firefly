import { afterEach, describe, expect, it, vi } from "vitest";
import { listCanvasAssets, type CanvasProjectAsset } from "./canvas-api";

const asset = (id: string, createdAt: number): CanvasProjectAsset => ({
  id, canvasId: "canvas-1", kind: "image", title: id, contentType: "image/webp", size: 1,
  status: "ready", createdAt, updatedAt: createdAt, mediaUrl: `/media/${id}`, downloadUrl: `/download/${id}`,
});

describe("listCanvasAssets", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("follows the composite cursor and returns every project asset once", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input); requested.push(url);
      const body = requested.length === 1
        ? { Items: [asset("asset-b", 100), asset("asset-a", 100)], HasMore: true, NextBefore: 100, NextBeforeId: "asset-a" }
        : { Items: [asset("asset-older", 90), asset("asset-a", 100)], HasMore: false };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const result = await listCanvasAssets("canvas-1");

    expect(requested).toHaveLength(2);
    expect(requested[1]).toContain("before=100");
    expect(requested[1]).toContain("beforeId=asset-a");
    expect(result.Items.map((item) => item.id)).toEqual(["asset-b", "asset-a", "asset-older"]);
    expect(result.HasMore).toBe(false);
  });
});
