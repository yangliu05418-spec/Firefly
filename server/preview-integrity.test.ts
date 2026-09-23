import { describe, expect, it } from "vitest";
import { assertPreviewDuration, canRemuxPreview, type PreviewProbe } from "./preview-integrity.js";

const source: PreviewProbe = { duration: 30.042, codec: "h264", pixelFormat: "yuv420p", width: 720, height: 1280, bitrate: 2_000_000, audioCodecs: ["aac"] };
describe("preview publication integrity", () => {
  it("rejects the production 007c 2-second preview of a 30-second original", () => {
    expect(() => assertPreviewDuration(source, { ...source, duration: 2.083 })).toThrow(/时长/);
  });
  it("allows small container timestamp rounding, never NaN or a truncated stream", () => {
    expect(() => assertPreviewDuration(source, { ...source, duration: 30.084 })).not.toThrow();
    for (const duration of [0, NaN, 28, 32]) expect(() => assertPreviewDuration(source, { ...source, duration })).toThrow();
  });
  it("rejects incompatible preview codecs", () => {
    expect(() => assertPreviewDuration(source, { ...source, codec: "hevc" })).toThrow(/编码/);
  });
  it("remuxes only already-compatible bounded-bitrate material", () => {
    expect(canRemuxPreview(source, 3_500_000)).toBe(true);
    for (const patch of [{ codec: "hevc" }, { pixelFormat: "yuv420p10le" }, { bitrate: 10_000_000 }, { bitrate: NaN }, { width: 1920 }, { audioCodecs: ["opus"] }]) {
      expect(canRemuxPreview({ ...source, ...patch }, 3_500_000)).toBe(false);
    }
  });
});
