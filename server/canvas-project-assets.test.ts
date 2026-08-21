import { describe, expect, it, vi } from "vitest";
import { publicCanvasProjectAsset, resolveCanvasGenerationReferences } from "./canvas-project-assets.js";
import type { CanvasProjectAsset } from "./db.js";
import type { GenerationInput } from "./provider.js";

const projectAsset: CanvasProjectAsset = {
  id: "project-asset-1", ownerId: "owner-1", canvasId: "canvas-1", kind: "image",
  sourceType: "generated", sourceId: "generated-1", title: "角色参考", contentType: "image/png",
  size: 100, status: "ready", createdAt: 1, updatedAt: 1,
};

const input = (): GenerationInput => ({
  prompt: "让角色走入雨夜", model: "dreamina-seedance-2-0-pro-260428", mode: "omni", ratio: "16:9",
  resolution: "720p", duration: 5, generateAudio: true, seed: -1, cameraFixed: false, watermark: false,
  outputFormat: "mp4", assets: [{
    id: "reference-1", type: "image", role: "reference_image", canvasProjectAssetId: projectAsset.id, name: projectAsset.title,
  }],
});

describe("canvas generation references", () => {
  it("publishes a cacheable thumbnail route without changing the original media route", () => {
    expect(publicCanvasProjectAsset(projectAsset)).toMatchObject({
      mediaUrl: "/api/canvas-project-assets/project-asset-1/media",
      thumbnailUrl: "/api/canvas-project-assets/project-asset-1/media?variant=thumbnail",
      downloadUrl: "/api/canvas-project-assets/project-asset-1/media?download=1",
    });
  });
  it("keeps a stable project id until the worker signs the provider URL", () => {
    const providerUrl = vi.fn(() => "https://tos.example/fresh-signature");
    const resolved = resolveCanvasGenerationReferences(input(), projectAsset.ownerId, { readAsset: () => projectAsset, providerUrl });

    expect(resolved.assets[0]).toMatchObject({ url: "https://tos.example/fresh-signature", canvasProjectAssetId: undefined });
    expect(providerUrl).toHaveBeenCalledWith(projectAsset);
  });

  it("rejects a cross-user or mismatched media reference", () => {
    expect(() => resolveCanvasGenerationReferences(input(), "owner-2", { readAsset: () => projectAsset, providerUrl: () => "unused" })).toThrow("不存在或尚未就绪");
    expect(() => resolveCanvasGenerationReferences(input(), projectAsset.ownerId, { readAsset: () => ({ ...projectAsset, kind: "video" }), providerUrl: () => "unused" })).toThrow("不存在或尚未就绪");
  });
});
