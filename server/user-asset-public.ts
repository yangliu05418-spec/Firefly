import type { UserAsset } from "./db.js";

/**
 * Upload-backed assets always render through Firefly's authenticated media
 * endpoint. Provider URLs are registration metadata and may expire without
 * warning, so they must never be the browser's source of truth.
 */
export const publicUserAsset = (asset: UserAsset) => ({
  Id: asset.id,
  Name: asset.name,
  AssetType: asset.assetType,
  Status: asset.status,
  URL: asset.uploadId ? `/api/assets/${encodeURIComponent(asset.id)}/source${asset.assetType === "Image" ? "?variant=thumbnail" : ""}` : asset.url,
  GroupId: asset.groupId,
  UploadId: asset.uploadId,
  Category: asset.category,
  Error: asset.lastError
});
