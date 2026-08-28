import { describe, expect, it } from "vitest";
import type { UploadAsset } from "./types";
import { areAttachedUploadsAdmissible } from "./upload-state";

const upload = (patch: Partial<UploadAsset> = {}): UploadAsset => ({
  id: "upload-1", uploadId: "upload-1", name: "image.png", type: "image", size: 10,
  role: "reference_image", progress: 100, phase: "ready", ...patch
});

describe("attached upload readiness", () => {
  it("admits a durably transported upload while server validation continues", () => {
    expect(areAttachedUploadsAdmissible([upload({ phase: "verifying" })])).toBe(true);
  });

  it("accepts a finalized local upload and an active reusable asset", () => {
    expect(areAttachedUploadsAdmissible([upload(), upload({ id: "asset-1", assetId: "asset-1", phase: undefined, status: "Active" })])).toBe(true);
  });

  it("accepts a ready immutable snapshot reference without an upload id", () => {
    expect(areAttachedUploadsAdmissible([upload({ uploadId: undefined, snapshotReferenceId: "snapshot-1" })])).toBe(true);
  });

  it("does not accept a snapshot reference before it is ready", () => {
    expect(areAttachedUploadsAdmissible([upload({ uploadId: undefined, snapshotReferenceId: "snapshot-1", phase: "verifying" })])).toBe(false);
  });

  it("does not bypass a higher-priority snapshot reference with a lower-priority upload", () => {
    expect(areAttachedUploadsAdmissible([upload({ snapshotReferenceId: "snapshot-1", phase: "verifying" })])).toBe(false);
  });

  it("rejects provider assets that are still processing", () => {
    expect(areAttachedUploadsAdmissible([upload({ id: "asset-1", assetId: "asset-1", phase: undefined, status: "Processing" })])).toBe(false);
  });

  it("does not admit bytes that have not received a durable upload id", () => {
    expect(areAttachedUploadsAdmissible([upload({ uploadId: undefined, phase: "uploading" })])).toBe(false);
  });
});
