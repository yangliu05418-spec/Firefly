import type { UserAsset } from "./db.js";
import type { PublicLocalMediaDescriptor } from "./local-media-public.js";

/**
 * Upload-backed assets always render through Firefly's authenticated media
 * endpoint. Provider URLs are registration metadata and may expire without
 * warning, so they must never be the browser's source of truth.
 */
export const publicUserAsset = (asset: UserAsset, localMedia?: { thumbnail?: PublicLocalMediaDescriptor; original?: PublicLocalMediaDescriptor }) => ({
  Id: asset.id,
  Name: asset.name,
  AssetType: asset.assetType,
  Status: asset.status,
  URL: asset.uploadId ? `/api/assets/${encodeURIComponent(asset.id)}/source${asset.assetType === "Image" ? "?variant=thumbnail" : ""}` : asset.url,
  LocalMedia: localMedia,
  GroupId: asset.groupId,
  UploadId: asset.uploadId,
  Category: asset.category,
  Error: asset.lastError
});
