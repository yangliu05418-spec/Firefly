import { describe, expect, it } from "vitest";
import { canvasAssetDownloadName } from "./canvas-download";

describe("canvas asset download names", () => {
  it("uses the stored media type instead of relabeling the bytes", () => {
    expect(canvasAssetDownloadName({ title: "portrait.png", kind: "image", contentType: "image/jpeg" }, 0)).toBe("portrait.jpg");
    expect(canvasAssetDownloadName({ title: "take.mp4", kind: "video", contentType: "video/quicktime" }, 0)).toBe("take.mov");
  });

  it("sanitizes unsafe names and falls back predictably", () => {
    expect(canvasAssetDownloadName({ title: "scene:01?.png", kind: "image", contentType: "image/png; charset=binary" }, 0)).toBe("scene-01-.png");
    expect(canvasAssetDownloadName({ title: "", kind: "audio", contentType: "application/octet-stream" }, 2)).toBe("Firefly-3.mp3");
  });
});
