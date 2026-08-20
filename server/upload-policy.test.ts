import { describe, expect, it } from "vitest";
import { canonicalUploadContentType, tosMediaInfoViolation, uploadKindFromContentType } from "./upload-policy.js";

describe("upload media policy", () => {
  it("uses the extension as the canonical MIME source when browsers omit MIME", () => {
    expect(canonicalUploadContentType("reference.MP4", "video")).toBe("video/mp4");
    expect(canonicalUploadContentType("portrait.jpeg", "image")).toBe("image/jpeg");
    expect(canonicalUploadContentType("voice.wav", "audio")).toBe("audio/wav");
  });

  it("rejects a client category that contradicts the file extension", () => {
    expect(() => canonicalUploadContentType("portrait.jpg", "audio")).toThrow("素材类型与文件扩展名不一致");
  });

  it("maps durable media metadata back to the public upload kind", () => {
    expect(uploadKindFromContentType("video/quicktime")).toBe("video");
    expect(uploadKindFromContentType("audio/mpeg")).toBe("audio");
    expect(uploadKindFromContentType("image/webp")).toBe("image");
  });

  it("validates TOS image and video metadata without downloading the full object", () => {
    expect(tosMediaInfoViolation({ ImageWidth: { value: "1024" }, ImageHeight: { value: "768" } }, "image")).toBeUndefined();
    expect(tosMediaInfoViolation({ ImageWidth: { value: "120" }, ImageHeight: { value: "120" } }, "image")).toContain("300");
    const video = { streams: [{ codec_type: "video", codec_name: "h264", width: 1280, height: 720, avg_frame_rate: "30/1", duration: "5" }], format: { duration: "5" } };
    expect(tosMediaInfoViolation(video, "video")).toBeUndefined();
    expect(tosMediaInfoViolation({ ...video, streams: [{ ...video.streams[0], codec_name: "vp9" }] }, "video")).toContain("H.264");
  });

  it("enforces the documented inclusive video ratio and pixel boundaries", () => {
    const video = (width: number, height: number) => ({ streams: [{ codec_type: "video", codec_name: "h264", width, height, avg_frame_rate: "30/1", duration: "5" }], format: { duration: "5" } });
    expect(tosMediaInfoViolation(video(640, 1600), "video")).toBeUndefined();
    expect(tosMediaInfoViolation(video(1600, 640), "video")).toBeUndefined();
    expect(tosMediaInfoViolation(video(639, 639), "video")).toContain("分辨率");
    expect(tosMediaInfoViolation(video(640, 640), "video")).toBeUndefined();
  });
});
