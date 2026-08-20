import crypto from "node:crypto";
import { config } from "./config.js";
import { AssetApiError, callAssetApi } from "./asset-api.js";
import type { AssetRegistrationOperation, UserAsset } from "./db.js";
import { users } from "./store.js";
import { redis } from "./redis.js";
import { resolveUploadMediaUrl } from "./media-url.js";

import type { GenerationInput } from "./provider.js";

const GROUP_NAME = "Firefly Auto References";
const CACHE_TTL_SECONDS = 7 * 24 * 3600;
const ACTIVE_DEADLINE_MS = 3 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;
const UNKNOWN_RETRY_AFTER_MS = 10 * 60 * 1000;
const PENDING_RETRY_AFTER_MS = 2 * 60 * 1000;

export type AssetRejectionCode = "ASSET_REAL_PERSON" | "ASSET_NOT_OWNED" | "ASSET_PROVIDER_FAILED" | "ASSET_PROCESSING_TIMEOUT" | "ASSET_REGISTRATION_PENDING";

export class AssetRegistrationRejected extends Error {
  readonly code: AssetRejectionCode;
  constructor(message: string, code: AssetRejectionCode) {
    super(message);
    this.name = "AssetRegistrationRejected";
    this.code = code;
  }
}

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
  saveAsset?: (asset: { id: string; ownerId: string; groupId: string; uploadId?: string; name: string; assetType: "Image" | "Video" | "Audio"; status: "Active" | "Processing" | "Failed"; url?: string; createdAt: number; updatedAt: number }) => unknown;
  readOperation?: (ownerId: string, uploadId: string) => AssetRegistrationOperation | null;
  createOperation?: (operation: Omit<AssetRegistrationOperation, "status" | "attemptCount">) => { inserted: boolean; operation: AssetRegistrationOperation };
  updateOperation?: (ownerId: string, uploadId: string, patch: Partial<Pick<AssetRegistrationOperation, "status" | "providerAssetId" | "attemptCount" | "updatedAt">> & { lastError?: string | null }) => AssetRegistrationOperation | null;
  claimOperation?: (ownerId: string, uploadId: string, expectedUpdatedAt: number, updatedAt: number) => AssetRegistrationOperation | null;
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
  saveAsset: (asset) => users.upsertUserAsset(asset),
  readOperation: (ownerId, uploadId) => users.readAssetRegistrationOperation(ownerId, uploadId),
  createOperation: (operation) => users.createAssetRegistrationOperation(operation),
  updateOperation: (ownerId, uploadId, patch) => users.updateAssetRegistrationOperation(ownerId, uploadId, patch),
  claimOperation: (ownerId, uploadId, expectedUpdatedAt, updatedAt) => users.claimAssetRegistrationRetry(ownerId, uploadId, expectedUpdatedAt, updatedAt)
};

let groupIdPromise: Promise<string> | undefined;

const resolveGroupId = async (deps: RegistrationDeps) => {
  const listed = await deps.callAsset<{ Items?: GroupRecord[] }>("ListAssetGroups", {
    Filter: { GroupType: "AIGC", Name: GROUP_NAME }, PageNumber: 1, PageSize: 20
  });
  const existing = listed.Items?.find((group) => group.Name === GROUP_NAME);
  if (existing) return existing.Id;
  try {
    const created = await deps.callAsset<{ Id: string }>("CreateAssetGroup", {
      Name: GROUP_NAME, Description: "Firefly 自动入库的已授权参考素材", GroupType: "AIGC"
    });
    return created.Id;
  } catch (error) {
    if (!(error instanceof AssetApiError) || !error.resultUnknown) throw error;
    const reconciled = await deps.callAsset<{ Items?: GroupRecord[] }>("ListAssetGroups", {
      Filter: { GroupType: "AIGC", Name: GROUP_NAME }, PageNumber: 1, PageSize: 20
    });
    const group = reconciled.Items?.find((candidate) => candidate.Name === GROUP_NAME);
    if (group) return group.Id;
    throw error;
  }
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

export const deterministicAssetName = (ownerId: string, uploadId: string, fileName: string) => {
  const identity = crypto.createHash("sha256").update(`${ownerId}:${uploadId}`).digest("hex").slice(0, 16);
  const safeName = fileName.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "asset";
  return `ff-${identity}-${safeName}`.slice(0, 80);
};

const reconcileAsset = async (groupId: string, deterministicName: string, deps: RegistrationDeps) => {
  const listed = await deps.callAsset<{ Items?: AssetRecord[] }>("ListAssets", {
    Filter: { GroupId: groupId, Name: deterministicName }, PageNumber: 1, PageSize: 100
  });
  return listed.Items?.find((asset) => asset.GroupId === groupId && asset.Name === deterministicName) ?? null;
};

const pendingRegistration = (name: string) => new AssetRegistrationRejected(`参考素材「${name}」已提交，正在与素材服务核对，请稍后刷新`, "ASSET_REGISTRATION_PENDING");

const createOrReconcileUpload = async (uploadId: string, ownerId: string, name: string, inputType: "image" | "video" | "audio", deps: RegistrationDeps) => {
  const media = deps.readUpload(uploadId);
  if (!media || media.ownerId !== ownerId || media.status !== "ready") throw new Error(`参考素材「${name}」不存在或尚未完成上传`);
  const groupId = await ensureGroupId(deps);
  const assetType: "Image" | "Video" | "Audio" = media.contentType.startsWith("video/") ? "Video" : media.contentType.startsWith("audio/") ? "Audio" : "Image";
  const deterministicName = deterministicAssetName(ownerId, uploadId, media.fileName);
  let operation = deps.readOperation?.(ownerId, uploadId) ?? null;
  let mayCreate = !operation;

  if (operation?.providerAssetId) return { assetId: operation.providerAssetId, groupId, assetType, mediaName: media.fileName };
  if (!operation) {
    const reconciled = await reconcileAsset(groupId, deterministicName, deps);
    if (reconciled) {
      deps.createOperation?.({ ownerId, uploadId, deterministicName, groupId, providerAssetId: reconciled.Id, assetType, createdAt: deps.now(), updatedAt: deps.now() });
      deps.updateOperation?.(ownerId, uploadId, { status: "created", providerAssetId: reconciled.Id, lastError: null, updatedAt: deps.now() });
      console.info(JSON.stringify({ type: "provider_asset_reconciled", at: new Date().toISOString(), ownerId, uploadId, assetId: reconciled.Id, phase: "before_create" }));
      return { assetId: reconciled.Id, groupId, assetType, mediaName: media.fileName };
    }
  }
  if (operation) {
    const reconciled = await reconcileAsset(groupId, deterministicName, deps);
    if (reconciled) {
      deps.updateOperation?.(ownerId, uploadId, { status: "created", providerAssetId: reconciled.Id, lastError: null, updatedAt: deps.now() });
      console.info(JSON.stringify({ type: "provider_asset_reconciled", at: new Date().toISOString(), ownerId, uploadId, assetId: reconciled.Id, phase: "existing_operation" }));
      return { assetId: reconciled.Id, groupId, assetType, mediaName: media.fileName };
    }
    const retryAfter = operation.status === "unknown" ? UNKNOWN_RETRY_AFTER_MS : PENDING_RETRY_AFTER_MS;
    if (operation.status === "failed") throw new AssetRegistrationRejected(`参考素材「${name}」注册失败，请检查素材规格后重新上传`, "ASSET_PROVIDER_FAILED");
    if (deps.now() - operation.updatedAt < retryAfter) throw pendingRegistration(name);
    mayCreate = true;
    if (deps.claimOperation) {
      const claimed = deps.claimOperation(ownerId, uploadId, operation.updatedAt, deps.now());
      if (!claimed) throw pendingRegistration(name);
      operation = claimed;
    } else {
      operation = deps.updateOperation?.(ownerId, uploadId, { status: "pending", attemptCount: operation.attemptCount + 1, lastError: null, updatedAt: deps.now() }) ?? operation;
    }
  }

  if (!operation && deps.createOperation) {
    const createdOperation = deps.createOperation({ ownerId, uploadId, deterministicName, groupId, assetType, createdAt: deps.now(), updatedAt: deps.now() });
    operation = createdOperation.operation;
    mayCreate = createdOperation.inserted;
    if (!createdOperation.inserted) throw pendingRegistration(name);
  }
  if (!mayCreate) throw pendingRegistration(name);

  try {
    const created = await deps.callAsset<{ Id: string }>("CreateAsset", {
      GroupId: groupId,
      URL: await deps.resolveMediaUrl(media),
      AssetType: assetType,
      Name: deterministicName
    });
    if (!created.Id?.startsWith("asset-")) throw new Error("素材服务未返回有效资产 ID");
    deps.updateOperation?.(ownerId, uploadId, { status: "created", providerAssetId: created.Id, lastError: null, updatedAt: deps.now() });
    console.info(JSON.stringify({ type: "provider_asset_create_acknowledged", at: new Date().toISOString(), ownerId, uploadId, assetId: created.Id, groupId }));
    return { assetId: created.Id, groupId, assetType, mediaName: media.fileName };
  } catch (error) {
    if (/real[ -]?person|real human|真人|人脸/i.test(error instanceof Error ? error.message : String(error))) {
      deps.updateOperation?.(ownerId, uploadId, { status: "failed", lastError: "real_person_rejected", updatedAt: deps.now() });
      throw new AssetRegistrationRejected(`参考素材「${name}」包含真人面孔，请先完成真人认证并加入真人资产库`, "ASSET_REAL_PERSON");
    }
    if (error instanceof AssetApiError && error.resultUnknown) {
      deps.updateOperation?.(ownerId, uploadId, { status: "unknown", lastError: error.providerCode ?? "transport_unknown", updatedAt: deps.now() });
      console.warn(JSON.stringify({ type: "provider_asset_result_unknown", at: new Date().toISOString(), ownerId, uploadId, code: error.providerCode ?? "transport_unknown" }));
      const reconciled = await reconcileAsset(groupId, deterministicName, deps).catch(() => null);
      if (reconciled) {
        deps.updateOperation?.(ownerId, uploadId, { status: "created", providerAssetId: reconciled.Id, lastError: null, updatedAt: deps.now() });
        console.info(JSON.stringify({ type: "provider_asset_reconciled", at: new Date().toISOString(), ownerId, uploadId, assetId: reconciled.Id, phase: "after_unknown" }));
        return { assetId: reconciled.Id, groupId, assetType, mediaName: media.fileName };
      }
      throw pendingRegistration(name);
    }
    deps.updateOperation?.(ownerId, uploadId, { status: "failed", lastError: error instanceof Error ? error.message.slice(0, 300) : "provider_failed", updatedAt: deps.now() });
    console.warn(JSON.stringify({ type: "provider_asset_registration_failed", at: new Date().toISOString(), ownerId, uploadId, code: error instanceof AssetApiError ? error.providerCode ?? "provider_failed" : "provider_failed" }));
    throw error;
  }
};

const registerUpload = async (uploadId: string, ownerId: string, name: string, inputType: "image" | "video" | "audio", deps: RegistrationDeps) => {
  const cacheKey = `provider-asset:${ownerId}:${uploadId}`;
  let assetId = await deps.cacheGet(cacheKey);
  let groupId = "";
  let assetType: "Image" | "Video" | "Audio" = inputType === "video" ? "Video" : inputType === "audio" ? "Audio" : "Image";
  if (!assetId) {
    const registered = await createOrReconcileUpload(uploadId, ownerId, name, inputType, deps);
    assetId = registered.assetId;
    groupId = registered.groupId;
    assetType = registered.assetType;
    await deps.cacheSet(cacheKey, assetId);
    deps.saveAsset?.({ id: assetId, ownerId, groupId, uploadId, name: registered.mediaName, assetType, status: "Processing", createdAt: deps.now(), updatedAt: deps.now() });
    console.info(JSON.stringify({ type: "provider_asset_created", at: new Date().toISOString(), ownerId, uploadId, assetId, groupId }));
  }
  const active = await waitForActive(assetId, name, deps);
  deps.saveAsset?.({ id: assetId, ownerId, groupId: active.GroupId ?? groupId, uploadId, name: active.Name ?? name, assetType: active.AssetType ?? assetType, status: "Active", url: active.URL, createdAt: deps.now(), updatedAt: deps.now() });
  console.info(JSON.stringify({ type: "provider_asset_active", at: new Date().toISOString(), ownerId, uploadId, assetId }));
  return assetId;
};

export const registerProviderUpload = async (input: { uploadId: string; ownerId: string; name: string; inputType: "image" | "video" | "audio"; waitUntilActive?: boolean }, deps: RegistrationDeps = defaultDeps()): Promise<UserAsset> => {
  const registered = await createOrReconcileUpload(input.uploadId, input.ownerId, input.name, input.inputType, deps);
  const now = deps.now();
  let asset: UserAsset = { id: registered.assetId, ownerId: input.ownerId, groupId: registered.groupId, uploadId: input.uploadId, name: registered.mediaName, assetType: registered.assetType, status: "Processing", createdAt: now, updatedAt: now };
  deps.saveAsset?.(asset);
  if (input.waitUntilActive) {
    const active = await waitForActive(asset.id, input.name, deps);
    asset = { ...asset, groupId: active.GroupId ?? asset.groupId, name: active.Name ?? asset.name, assetType: active.AssetType ?? asset.assetType, status: "Active", url: active.URL, updatedAt: deps.now() };
    deps.saveAsset?.(asset);
  }
  return asset;
};

export const reconcileProviderRegistrations = async (ownerId: string, limit = 6) => {
  const lockKey = `asset-registration-reconcile:${ownerId}`;
  const lockToken = crypto.randomUUID();
  if (!(await redis.set(lockKey, lockToken, "EX", 30, "NX"))) return 0;
  try {
    const operations = users.listAssetRegistrationOperations(ownerId, limit)
      .filter((operation) => !users.readUserAssetByUpload(ownerId, operation.uploadId));
    const results = await Promise.allSettled(operations.map((operation) => registerProviderUpload({
      ownerId,
      uploadId: operation.uploadId,
      name: operation.deterministicName,
      inputType: operation.assetType.toLowerCase() as "image" | "video" | "audio"
    })));
    return results.filter((result) => result.status === "fulfilled").length;
  } finally {
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lockKey, lockToken).catch(() => undefined);
  }
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
