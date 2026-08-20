import { describe, expect, it } from "vitest";
import { inferUploadType } from "./api";

describe("inferUploadType", () => {
  it("uses a trusted browser media category when present", () => {
    expect(inferUploadType({ name: "still.bin", type: "image/png" })).toBe("image");
    expect(inferUploadType({ name: "clip.bin", type: "video/mp4" })).toBe("video");
  });

  it("falls back to the extension when Windows supplies an empty MIME", () => {
    expect(inferUploadType({ name: "reference.MOV", type: "" })).toBe("video");
    expect(inferUploadType({ name: "voice.mp3", type: "" })).toBe("audio");
    expect(inferUploadType({ name: "portrait.HEIC", type: "" })).toBe("image");
  });

  it("does not silently classify unsupported files as audio", () => {
    expect(inferUploadType({ name: "notes.pdf", type: "" })).toBeUndefined();
  });
});
