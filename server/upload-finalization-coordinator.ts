import type { MediaObject, UserAsset } from "./db.js";
import type { UploadFinalizationResult } from "./upload-finalization.js";

export type UploadFinalizationCoordinatorDependencies = {
  readUploadState(uploadId: string): MediaObject | null;
  readAsset(ownerId: string, uploadId: string): UserAsset | null;
  finalize(uploadId: string): Promise<UploadFinalizationResult>;
  rememberError(uploadId: string, error: string): Promise<unknown>;
  clearUploadKeys(uploadId: string, includeError: boolean): Promise<unknown>;
  failAsset(assetId: string, error: string): unknown;
  enqueueAsset(assetId: string): Promise<unknown>;
};

/** Bridges durable upload validation to asset registration without an interactive request waiting for either worker. */
export const coordinateUploadFinalization = async (uploadId: string, deps: UploadFinalizationCoordinatorDependencies) => {
  const before = deps.readUploadState(uploadId);
  const result = await deps.finalize(uploadId);
  const after = deps.readUploadState(uploadId);
  const ownerId = before?.ownerId ?? after?.ownerId;
  const asset = ownerId ? deps.readAsset(ownerId, uploadId) : null;

  if (result.status === "failed") {
    // Commit the durable user-visible state before best-effort Redis cleanup.
    // A cache outage must not leave an invalid asset stuck in Processing.
    if (asset?.status === "Processing") deps.failAsset(asset.id, result.error);
    await deps.rememberError(uploadId, result.error);
    await deps.clearUploadKeys(uploadId, false);
    return result;
  }

  if (result.status === "ready" || after?.status === "ready") {
    await deps.clearUploadKeys(uploadId, true);
    if (asset?.status === "Processing") await deps.enqueueAsset(asset.id);
  } else if (after?.status === "deleted") {
    await deps.clearUploadKeys(uploadId, false);
  }
  return result;
};
