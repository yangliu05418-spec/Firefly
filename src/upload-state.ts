import type { UploadAsset } from "./types";

/** A durable upload id is enough for admission; workers wait for authoritative validation before provider submission. */
export const areAttachedUploadsAdmissible = (assets: UploadAsset[]) => assets.every((asset) =>
  asset.assetId
    ? asset.status === "Active"
    : Boolean(asset.uploadId) && asset.progress === 100 && (asset.phase === "verifying" || asset.phase === "ready")
);
