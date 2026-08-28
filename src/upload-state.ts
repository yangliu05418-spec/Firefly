import type { UploadAsset } from "./types";

/** Any durable reference is enough for admission; the server remains authoritative. */
export const areAttachedUploadsAdmissible = (assets: UploadAsset[]) => assets.every((asset) => {
  if (asset.snapshotReferenceId) return asset.progress === 100 && asset.phase === "ready";
  if (asset.assetId) return asset.status === "Active";
  return Boolean(asset.uploadId) && asset.progress === 100 && (asset.phase === "verifying" || asset.phase === "ready");
});
