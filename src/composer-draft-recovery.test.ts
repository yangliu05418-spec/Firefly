import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { recoverComposerDraftAsset, type ComposerDraftRecoveryDeps } from "./composer-draft-recovery";
import type { UploadAsset } from "./types";

const upload = (patch: Partial<UploadAsset> = {}): UploadAsset => ({ id: "upload-1", uploadId: "upload-1", name: "frame.png", type: "image", size: 10, role: "reference_image", progress: 100, phase: "verifying", ...patch });
const deps = (patch: Partial<ComposerDraftRecoveryDeps> = {}): ComposerDraftRecoveryDeps => ({
  getUpload: async () => ({ id: "upload-1", name: "frame.png", type: "image", size: 10, state: "ready" }),
  getAsset: async () => ({ Id: "asset-1", Name: "Hero", AssetType: "Image", Status: "Active", URL: "/api/assets/asset-1/source", GroupId: "group", Category: "character" }),
  wait: async () => undefined,
  now: () => 1_000,
  ...patch,
});

describe("composer draft asset recovery", () => {
  it("restores a direct upload only after server-side validation is ready", async () => {
    let checks = 0;
    const result = await recoverComposerDraftAsset(upload(), undefined, deps({
      getUpload: async () => ({ id: "upload-1", name: "frame.png", type: "image", size: 10, state: ++checks === 1 ? "processing" : "ready" }),
    }));
    expect(checks).toBe(2);
    expect(result).toMatchObject({ uploadId: "upload-1", phase: "ready", progress: 100 });
  });

  it("refreshes the stable provider asset preview instead of reusing a signed URL", async () => {
    const result = await recoverComposerDraftAsset(upload({ id: "asset-1", assetId: "asset-1", preview: undefined }), undefined, deps());
    expect(result).toMatchObject({ assetId: "asset-1", status: "Active", preview: "/api/assets/asset-1/source" });
  });

  it("drops expired or failed references", async () => {
    expect(await recoverComposerDraftAsset(upload(), undefined, deps({ getUpload: async () => { throw new ApiError("gone", 404); } }))).toBeNull();
    expect(await recoverComposerDraftAsset(upload({ assetId: "asset-1" }), undefined, deps({ getAsset: async () => ({ Id: "asset-1", Name: "Hero", AssetType: "Image", Status: "Failed", GroupId: "group", Category: "character" }) }))).toBeNull();
  });
});
