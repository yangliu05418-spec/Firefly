import { describe, expect, it } from "vitest";
import type { UploadAsset } from "./types";
import { areAttachedUploadsReady } from "./upload-state";

const upload = (patch: Partial<UploadAsset> = {}): UploadAsset => ({
  id: "upload-1", uploadId: "upload-1", name: "image.png", type: "image", size: 10,
  role: "reference_image", progress: 100, phase: "ready", ...patch
});

describe("attached upload readiness", () => {
  it("does not submit while transport is complete but server validation is pending", () => {
    expect(areAttachedUploadsReady([upload({ phase: "verifying" })])).toBe(false);
  });

  it("accepts a finalized local upload and an active reusable asset", () => {
    expect(areAttachedUploadsReady([upload(), upload({ id: "asset-1", assetId: "asset-1", phase: undefined, status: "Active" })])).toBe(true);
  });

  it("rejects provider assets that are still processing", () => {
    expect(areAttachedUploadsReady([upload({ id: "asset-1", assetId: "asset-1", phase: undefined, status: "Processing" })])).toBe(false);
  });
});
