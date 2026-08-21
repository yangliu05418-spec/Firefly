import type { UploadAsset } from "./types";

/** Transport completion is not generation readiness: authoritative server validation must finish first. */
export const areAttachedUploadsReady = (assets: UploadAsset[]) => assets.every((asset) =>
  asset.assetId ? asset.status === "Active" : asset.phase === "ready" && asset.progress === 100
);
