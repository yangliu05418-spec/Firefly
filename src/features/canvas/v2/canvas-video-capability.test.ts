import { describe, expect, it } from "vitest";
import type { ModelCapability } from "../../../types";
import { canvasVideoModeForReferences, canvasVideoModelsForReferences } from "./canvas-video-capability";

const model = (id: string, modes: ModelCapability["modes"], supportsAudio: boolean): ModelCapability => ({
  id, name: id, note: "", modes, supportsAudio, resolutions: ["720p"], ratios: ["16:9"], duration: [4, 8], imageLimit: 1, videoLimit: 1, audioLimit: 0, audioOnly: false, outputFormats: ["mp4"],
});

describe("Canvas video capability boundaries", () => {
  it("uses omni only when a media reference is present", () => {
    expect(canvasVideoModeForReferences([])).toBe("text");
    expect(canvasVideoModeForReferences(["image"])).toBe("omni");
  });

  it("does not offer text-only models for referenced generation", () => {
    const models = [model("omni", ["text", "omni"], true), model("text-only", ["text"], false)];
    expect(canvasVideoModelsForReferences(models, []).map((item) => item.id)).toEqual(["omni", "text-only"]);
    expect(canvasVideoModelsForReferences(models, ["image"]).map((item) => item.id)).toEqual(["omni"]);
  });

  it("respects reference limits and audio-only support", () => {
    const omni = model("omni", ["omni"], true);
    const noAudioOnly = { ...omni, id: "no-audio-only", audioOnly: false };
    const audioOnly = { ...omni, id: "audio-only", audioOnly: true, audioLimit: 1 };
    expect(canvasVideoModelsForReferences([noAudioOnly, audioOnly], ["audio"]).map((item) => item.id)).toEqual(["audio-only"]);
    expect(canvasVideoModelsForReferences([{ ...omni, imageLimit: 1 }], ["image", "image"])).toEqual([]);
  });
});
