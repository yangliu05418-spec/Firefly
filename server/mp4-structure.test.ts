import { describe, expect, it } from "vitest";
import { inspectMp4Prefix } from "./mp4-structure.js";

const atom = (type: string, bytes = 8) => {
  const value = Buffer.alloc(bytes); value.writeUInt32BE(bytes, 0); value.write(type, 4, 4, "ascii"); return value;
};

describe("MP4 progressive structure", () => {
  it("accepts moov metadata before media data", () => {
    expect(inspectMp4Prefix(Buffer.concat([atom("ftyp"), atom("moov"), atom("moof"), atom("mdat")])).progressive).toBe(true);
  });

  it("rejects an MP4 whose moov atom is after media data", () => {
    expect(inspectMp4Prefix(Buffer.concat([atom("ftyp"), atom("mdat"), atom("moov")])).progressive).toBe(false);
  });

  it("rejects malformed data", () => {
    expect(inspectMp4Prefix(Buffer.from("not-an-mp4")).progressive).toBe(false);
  });
});
