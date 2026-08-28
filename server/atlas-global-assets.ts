import { users } from "./store.js";

export type AtlasGlobalExport = {
  id: string;
  ownerId: string;
  name: string;
  objectKey: string;
  contentType: string;
  size: number;
  etag: string;
};

/**
 * Idempotently exposes a verified Atlas export in Firefly's shared user asset
 * catalog. The Atlas project asset remains the source of ownership while the
 * conventional local asset id keeps existing Studio actions compatible.
 */
export const registerAtlasGlobalExport = (input: AtlasGlobalExport) => {
  const now = Date.now();
  const globalAssetId = `asset-local-atlas-${input.id}`;
  const uploadId = `atlas-export:${input.id}`;
  users.upsertMedia({
    id: `atlas-export-media:${input.id}`,
    ownerId: input.ownerId,
    uploadId,
    kind: "input",
    objectKey: input.objectKey,
    status: "ready",
    fileName: input.name,
    contentType: input.contentType,
    size: input.size,
    etag: input.etag,
    createdAt: now,
    updatedAt: now,
  });
  users.upsertUserAsset({
    id: globalAssetId,
    ownerId: input.ownerId,
    groupId: "firefly-atlas-exports",
    uploadId,
    name: input.name,
    assetType: "Video",
    status: "Active",
    category: "material",
    createdAt: now,
    updatedAt: now,
  });
  return { globalAssetId, uploadId };
};
