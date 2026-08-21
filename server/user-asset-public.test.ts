import { describe, expect, it } from "vitest";
import type { UserAsset } from "./db.js";
import { publicUserAsset } from "./user-asset-public.js";

const asset = (patch: Partial<UserAsset> = {}): UserAsset => ({
  id: "asset-local-1", ownerId: "owner-1", groupId: "group-1", name: "reference.png",
  assetType: "Image", status: "Active", category: "material", createdAt: 1, updatedAt: 1,
  ...patch
});

describe("public user asset", () => {
  it("uses the stable authenticated route for an upload even when the provider returned a URL", () => {
    expect(publicUserAsset(asset({
      id: "asset-local-with space",
      uploadId: "upload-1",
      url: "https://provider.example/temporary-reference.png"
    })).URL).toBe("/api/assets/asset-local-with%20space/source?variant=thumbnail");
  });

  it("keeps upload-backed video URLs unprocessed", () => {
    expect(publicUserAsset(asset({ assetType: "Video", uploadId: "upload-1" })).URL)
      .toBe("/api/assets/asset-local-1/source");
  });

  it("preserves a provider URL for legacy URL-only assets", () => {
    expect(publicUserAsset(asset({ url: "https://provider.example/external.png" })).URL)
      .toBe("https://provider.example/external.png");
  });
});
