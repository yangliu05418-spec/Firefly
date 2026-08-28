import crypto from "node:crypto";
import type { AtlasImportSource, AtlasStorageDependencies } from "./atlas-routes.js";
import type { AtlasAssetSourceType, AtlasProjectAsset, AtlasStore } from "./atlas-store.js";

const GIB = 1024 * 1024 * 1024;
export const ATLAS_COPY_OBJECT_MAX_BYTES = 5 * GIB;

export class AtlasImportError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const safeName = (value: string) => value.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120) || "media";
const objectKey = (ownerId: string, projectId: string, assetId: string, fileName: string) =>
  `atlas/assets/${sha256(assetId).slice(0, 2)}/${ownerId}/${projectId}/${assetId}/${safeName(fileName)}`;
const isObjectNotFound = (error: unknown) => Number((error as { statusCode?: number }).statusCode ?? 0) === 404
  || /NoSuchKey|NotFound/i.test(String((error as { code?: string }).code ?? ""));
const normalizedType = (value: string) => value.split(";", 1)[0]!.trim().toLowerCase();

export const importFireflySourceIntoAtlasProject = async (input: {
  store: AtlasStore;
  storage: AtlasStorageDependencies;
  ownerId: string;
  projectId: string;
  sourceType: Exclude<AtlasAssetSourceType, "local_upload" | "atlas_export">;
  sourceId: string;
  source: AtlasImportSource;
  now: number;
  assetId?: string;
}): Promise<AtlasProjectAsset> => {
  if (!input.store.readProject(input.projectId, input.ownerId)) {
    throw new AtlasImportError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在");
  }
  if (input.source.size > ATLAS_COPY_OBJECT_MAX_BYTES) {
    throw new AtlasImportError(422, "ATLAS_IMPORT_TOO_LARGE", "该资产超过5GiB，请从本机直接导入以使用可续传上传");
  }
  const assetId = input.assetId ?? crypto.randomUUID();
  const created = input.store.createImportedAsset({
    id: assetId, ownerId: input.ownerId, projectId: input.projectId,
    sourceType: input.sourceType, sourceId: input.sourceId, kind: input.source.kind,
    objectKey: objectKey(input.ownerId, input.projectId, assetId, input.source.fileName),
    fileName: safeName(input.source.fileName), contentType: input.source.contentType,
    size: input.source.size, now: input.now,
  });
  if (created.status === "missing") throw new AtlasImportError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在");
  if (created.status === "existing" && created.asset.status === "ready") return created.asset;
  const target = created.status === "existing"
    ? input.store.prepareImportedAssetRetry(created.asset.id, input.ownerId, input.now)!
    : created.asset;
  try {
    let verified;
    try { verified = await input.storage.verifyObject(target.objectKey); }
    catch (verificationError) {
      if (!isObjectNotFound(verificationError)) throw verificationError;
      try {
        await input.storage.copyObject({
          sourceObjectKey: input.source.objectKey, destinationObjectKey: target.objectKey,
          contentType: input.source.contentType, fileName: input.source.fileName,
        });
      } catch (copyError) {
        try { verified = await input.storage.verifyObject(target.objectKey); }
        catch (reconcileError) { if (isObjectNotFound(reconcileError)) throw copyError; throw reconcileError; }
      }
      verified ??= await input.storage.verifyObject(target.objectKey);
    }
    if (!verified) throw new AtlasImportError(502, "ATLAS_IMPORT_VERIFY_FAILED", "导入素材未能完成校验，请重试");
    if (verified.size !== input.source.size) throw new AtlasImportError(422, "ATLAS_IMPORT_SIZE_MISMATCH", "导入素材完整性校验失败");
    if (normalizedType(verified.contentType) !== normalizedType(input.source.contentType)) {
      throw new AtlasImportError(422, "ATLAS_IMPORT_TYPE_MISMATCH", "导入素材类型校验失败");
    }
    const ready = input.store.markAssetReady(target.id, input.ownerId, verified, input.now);
    if (!ready) throw new AtlasImportError(409, "ATLAS_IMPORT_STATE_CONFLICT", "素材状态已变化，请刷新后重试");
    return ready;
  } catch (error) {
    input.store.markAssetFailed(target.id, input.ownerId, error instanceof Error ? error.message : "素材导入失败", input.now);
    throw error;
  }
};
