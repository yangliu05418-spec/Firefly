import { describe, expect, it } from "vitest";
import { reconcileComposerAssets } from "./composer-assets";
import type { ModelCapability, UploadAsset } from "./types";

const model: ModelCapability = { id: "model", name: "Model", note: "", modes: ["omni", "first_frame", "first_last", "text"], resolutions: ["720p"], ratios: ["16:9"], duration: [4, 12], imageLimit: 2, videoLimit: 1, audioLimit: 1, audioOnly: false, supportsAudio: true, outputFormats: ["mp4"] };
const asset = (id: string, type: UploadAsset["type"]): UploadAsset => ({ id, uploadId: id, name: id, type, size: 1, role: type === "image" ? "reference_image" : type === "video" ? "reference_video" : "reference_audio", progress: 100, phase: "ready" });

describe("composer asset reconciliation", () => {
  it("preserves compatible assets and trims only beyond model limits", () => {
    const result = reconcileComposerAssets([asset("i1", "image"), asset("i2", "image"), asset("i3", "image"), asset("v1", "video")], "video", "omni", model);
    expect(result.map((item) => item.id)).toEqual(["i1", "i2", "v1"]);
  });

  it("assigns deterministic first and last frame roles", () => {
    const result = reconcileComposerAssets([asset("v1", "video"), asset("i1", "image"), asset("i2", "image")], "video", "first_last", model);
    expect(result.map((item) => [item.id, item.role])).toEqual([["i1", "first_frame"], ["i2", "last_frame"]]);
  });

  it("keeps image references when switching to image creation and removes them for text-only video", () => {
    const assets = [asset("i1", "image"), asset("v1", "video")];
    expect(reconcileComposerAssets(assets, "image", "omni", model).map((item) => item.id)).toEqual(["i1"]);
    expect(reconcileComposerAssets(assets, "video", "text", model)).toEqual([]);
  });
});
