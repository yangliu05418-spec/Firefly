import { describe, expect, it } from "vitest";
import { rangedSourceParts, sourceSizeFromContentRange } from "./tos.js";

describe("TOS ranged source transfer", () => {
  it("reads the authoritative source size from a one-byte range probe", () => {
    expect(sourceSizeFromContentRange("bytes 0-0/112968973")).toBe(112_968_973);
    expect(sourceSizeFromContentRange("bytes */112968973")).toBe(0);
    expect(sourceSizeFromContentRange(null)).toBe(0);
  });

  it("plans contiguous multipart ranges with an exact final part", () => {
    expect(rangedSourceParts(12, 5)).toEqual([
      { partNumber: 1, start: 0, end: 4, size: 5 },
      { partNumber: 2, start: 5, end: 9, size: 5 },
      { partNumber: 3, start: 10, end: 11, size: 2 },
    ]);
  });

  it("rejects invalid sizes before opening a multipart upload", () => {
    expect(() => rangedSourceParts(0, 5)).toThrow("媒体总大小无效");
    expect(() => rangedSourceParts(12, 0)).toThrow("媒体分片大小无效");
  });
});
