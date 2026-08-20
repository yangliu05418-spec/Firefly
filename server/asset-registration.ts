import { config } from "./config.js";
import { callAssetApi } from "./asset-api.js";
import { users } from "./store.js";
import { redis } from "./redis.js";
import { resolveUploadMediaUrl } from "./media-url.js";
import { acquireAssetCreationLock, releaseAssetCreationLock } from "./upload-slots.js";

import type { GenerationInput } from "./provider.js";

const GROUP_NAME = "Firefly Auto References";
const CACHE_TTL_SECONDS = 7 * 24 * 3600;
const ACTIVE_DEADLINE_MS = 3 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;

export type AssetRejectionCode = "ASSET_REAL_PERSON" | "ASSET_NOT_OWNED" | "ASSET_PROVIDER_FAILED" | "ASSET_PROCESSING_TIMEOUT";

export class AssetRegistrationRejected extends Error {
  readonly code: AssetRejectionCode;
  constructor(message: string, code: AssetRejectionCode) {
    super(message);
    this.name = "AssetRegistrationRejected";
    this.code = code;
  }
}
export const isRetryableAssetRejection = (error: AssetRegistrationRejected) => error.code === "ASSET_PROCESSING_TIMEOUT";

type AssetRecord = { Id: string; Status?: string; Name?: string; AssetType?: "Image" | "Video" | "Audio"; GroupId?: string; URL?: string };
type GroupRecord = { Id: string; Name?: string };

type RegistrationDeps = {
  readUpload: typeof users.readUpload;
  cacheGet: (key: string) => Promise<string | null>;
  cacheSet: (key: string, value: string) => Promise<unknown>;
  callAsset: typeof callAssetApi;
  /** 统一素材引用解析（TOS 签名 / legacy HMAC 路由），禁止双栈混用 */
  resolveMediaUrl: (media: { objectKey: string; uploadId?: string; fileName: string }) => Promise<string>;
  sleep: (ms: number) => Promise<unknown>;
  now: () => number;
  readOwnedAsset?: (assetId: string, ownerId: string) => boolean;
  readRegisteredAsset?: (ownerId: string, uploadId: string) => { id: string } | undefined;
  acquireAssetLock?: (ownerId: string, uploadId: string) => Promise<{ key: string; token: string } | null>;
  releaseAssetLock?: (lock: { key: string; token: string }) => Promise<unknown>;
  saveAsset?: (asset: { id: string; ownerId: string; groupId: string; uploadId?: string; name: string; assetType: "Image" | "Video" | "Audio"; status: "Active" | "Processing" | "Failed"; url?: string; createdAt: number; updatedAt: number }) => unknown;
};

let productionDeps: RegistrationDeps | undefined;
const defaultDeps = () => productionDeps ??= {
  readUpload: users.readUpload.bind(users),
  cacheGet: (key) => redis.get(key),
  cacheSet: (key, value) => redis.set(key, value, "EX", CACHE_TTL_SECONDS),
  callAsset: callAssetApi,
  resolveMediaUrl: (media) => resolveUploadMediaUrl(media),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
  readOwnedAsset: (assetId, ownerId) => users.readUserAsset(assetId)?.ownerId === ownerId,
  readRegisteredAsset: (ownerId, uploadId) => users.readUserAssetByUpload(ownerId, uploadId) ?? undefined,
  acquireAssetLock: (ownerId, uploadId) => acquireAssetCreationLock(redis, ownerId, uploadId),
  releaseAssetLock: (lock) => releaseAssetCreationLock(redis, lock),
  saveAsset: (asset) => users.upsertUserAsset({ ...asset, category: users.readUserAsset(asset.id)?.category ?? "material" })
};

let groupIdPromise: Promise<string> | undefined;

const resolveGroupId = async (deps: RegistrationDeps) => {
  const listed = await deps.callAsset<{ Items?: GroupRecord[] }>("ListAssetGroups", {
    Filter: { GroupType: "AIGC", Name: GROUP_NAME }, PageNumber: 1, PageSize: 20
  });
  const existing = listed.Items?.find((group) => group.Name === GROUP_NAME);
  if (existing) return existing.Id;
  const created = await deps.callAsset<{ Id: string }>("CreateAssetGroup", {
    Name: GROUP_NAME, Description: "Firefly 自动入库的已授权参考素材", GroupType: "AIGC"
  });
  return created.Id;
};

const ensureGroupId = (deps: RegistrationDeps) => {
  if (deps !== productionDeps) return resolveGroupId(deps);
  groupIdPromise ??= resolveGroupId(deps).catch((error) => { groupIdPromise = undefined; throw error; });
  return groupIdPromise;
};

export const ensureAutoReferenceGroup = () => ensureGroupId(defaultDeps());

const waitForActive = async (assetId: string, name: string, deps: RegistrationDeps) => {
  const deadline = deps.now() + ACTIVE_DEADLINE_MS;
  while (deps.now() < deadline) {
    const asset = await deps.callAsset<AssetRecord>("GetAsset", { Id: assetId });
    if (asset.Status === "Active") return asset;
    if (asset.Status === "Failed") throw new AssetRegistrationRejected(`参考素材「${name}」处理失败，无法用于生成；若素材包含真人面孔，请先完成真人认证并等待资产状态变为 Active`, "ASSET_PROVIDER_FAILED");
    await deps.sleep(POLL_INTERVAL_MS);
  }
  throw new AssetRegistrationRejected(`参考素材「${name}」仍在可信资产处理中（已等待 ${Math.round(ACTIVE_DEADLINE_MS / 1000)} 秒），请稍后重试`, "ASSET_PROCESSING_TIMEOUT");
};

const registerUpload = async (uploadId: string, ownerId: string, name: string, inputType: "image" | "video" | "audio", deps: RegistrationDeps) => {
  const cacheKey = `provider-asset:${ownerId}:${uploadId}`;
  let assetId = await deps.cacheGet(cacheKey);
  let creationLock: { key: string; token: string } | null = null;
  let groupId = "";
  let assetType: "Image" | "Video" | "Audio" = inputType === "video" ? "Video" : inputType === "audio" ? "Audio" : "Image";
  if (!assetId) {
    if (deps.acquireAssetLock) {
      creationLock = await deps.acquireAssetLock(ownerId, uploadId);
      if (!creationLock) throw new AssetRegistrationRejected(`参考素材「${name}」正在可信资产注册中，请稍后重试`, "ASSET_PROCESSING_TIMEOUT");
      assetId = deps.readRegisteredAsset?.(ownerId, uploadId)?.id ?? await deps.cacheGet(cacheKey) ?? null;
    }
  }
  try {
  if (!assetId) {
    const media = deps.readUpload(uploadId);
    if (!media || media.ownerId !== ownerId || media.status !== "ready") throw new Error(`参考素材「${name}」不存在或尚未完成上传`);
    groupId = await ensureGroupId(deps);
    assetType = media.contentType.startsWith("video/") ? "Video" : media.contentType.startsWith("audio/") ? "Audio" : "Image";
    let created: { Id: string };
    try {
      created = await deps.callAsset<{ Id: string }>("CreateAsset", {
        GroupId: groupId,
        URL: await deps.resolveMediaUrl(media),
        AssetType: assetType,
        Name: name.slice(0, 80)
      });
    } catch (error) {
      if (/real[ -]?person|real human|真人|人脸/i.test(error instanceof Error ? error.message : String(error))) {
        throw new AssetRegistrationRejected(`参考素材「${name}」包含真人面孔，请先完成真人认证并加入真人资产库`, "ASSET_REAL_PERSON");
      }
      throw error;
    }
    assetId = created.Id;
    await deps.cacheSet(cacheKey, assetId);
    deps.saveAsset?.({ id: assetId, ownerId, groupId, uploadId, name, assetType, status: "Processing", createdAt: deps.now(), updatedAt: deps.now() });
    console.info(JSON.stringify({ type: "provider_asset_created", at: new Date().toISOString(), ownerId, uploadId, assetId, groupId }));
  }
  } finally { if (creationLock && deps.releaseAssetLock) await deps.releaseAssetLock(creationLock).catch(() => undefined); }
  const active = await waitForActive(assetId, name, deps);
  deps.saveAsset?.({ id: assetId, ownerId, groupId: active.GroupId ?? groupId, uploadId, name: active.Name ?? name, assetType: active.AssetType ?? assetType, status: "Active", url: active.URL, createdAt: deps.now(), updatedAt: deps.now() });
  console.info(JSON.stringify({ type: "provider_asset_active", at: new Date().toISOString(), ownerId, uploadId, assetId }));
  return assetId;
};

export const prepareProviderAssets = async (input: GenerationInput, ownerId: string, deps: RegistrationDeps = defaultDeps()): Promise<GenerationInput> => {
  if (!input.model.startsWith("dreamina-seedance-2-")) return input;
  const assets = new Array<GenerationInput["assets"][number]>(input.assets.length);
  let cursor = 0;
  const prepareNext = async () => {
    while (cursor < input.assets.length) {
      const index = cursor++;
      const asset = input.assets[index];
      if (!asset) continue;
      if (asset.assetId) {
        if (deps.readOwnedAsset && !deps.readOwnedAsset(asset.assetId, ownerId)) throw new AssetRegistrationRejected(`参考素材「${asset.name}」不属于当前用户`, "ASSET_NOT_OWNED");
        const active = await waitForActive(asset.assetId, asset.name, deps);
        deps.saveAsset?.({ id: asset.assetId, ownerId, groupId: active.GroupId ?? "", name: active.Name ?? asset.name, assetType: active.AssetType ?? (asset.type === "video" ? "Video" : asset.type === "audio" ? "Audio" : "Image"), status: "Active", url: active.URL, createdAt: deps.now(), updatedAt: deps.now() });
        assets[index] = asset;
      } else if (asset.uploadId) {
        const assetId = await registerUpload(asset.uploadId, ownerId, asset.name, asset.type, deps);
        assets[index] = { ...asset, assetId, url: undefined };
      } else assets[index] = asset;
    }
  };
  await Promise.all(Array.from({ length: Math.min(config.assetRegistrationConcurrency, Math.max(1, input.assets.length)) }, prepareNext));
  return { ...input, assets };
};
