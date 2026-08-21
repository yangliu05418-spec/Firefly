import { describe, expect, it } from "vitest";
import { materializePromptReferences, parsePromptReferences, promptAssetMarker } from "./prompt-references";
import type { UploadAsset } from "./types";

const assets: UploadAsset[] = [
  { id: "image-a", name: "actor.png", type: "image", role: "reference_image", size: 1, progress: 100 },
  { id: "video-a", name: "motion.mp4", type: "video", role: "reference_video", size: 1, progress: 100 },
  { id: "image-b", name: "room.png", type: "image", role: "reference_image", size: 1, progress: 100 }
];

describe("prompt asset references", () => {
  it("uses the official ordinal within each media type", () => {
    const draft = `${promptAssetMarker("image-b")} follows ${promptAssetMarker("video-a")}`;
    expect(materializePromptReferences(draft, assets)).toBe("Image 2 follows Video 1");
  });

  it("removes references whose asset has been detached", () => {
    expect(materializePromptReferences(`Use ${promptAssetMarker("missing")}`, assets)).toBe("Use");
  });

  it("parses saved prompt markers so the editor can restore visual asset chips", () => {
    expect(parsePromptReferences(`Use ${promptAssetMarker("image-a")} gently`)).toEqual([
      { type: "text", value: "Use " },
      { type: "asset", id: "image-a" },
      { type: "text", value: " gently" },
    ]);
  });
});
