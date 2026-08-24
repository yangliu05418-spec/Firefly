import { AssetApiError, AUTO_REFERENCE_GROUP_TYPE, callAssetApi } from "./asset-api.js";
import { ensureAutoReferenceGroup } from "./asset-registration.js";
import type { UserAsset } from "./db.js";
import { resolveUploadMediaUrl } from "./media-url.js";
import { users } from "./store.js";
import { providerAssetName } from "./asset-name.js";
import { promoteUserAssetMedia } from "./asset-media.js";

const ACTIVE_DEADLINE_MS = 3 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;
const UNKNOWN_CREATE_DEADLINE_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_CREATE_MESSAGE = "素材已上传，正在确认生成引用";

type ProviderAssetRecord = {
  Id: string;
  Name?: string;
  AssetType?: UserAsset["assetType"];
  Status?: UserAsset["status"];
  URL?: string;
  GroupId?: string;
  CreateTime?: string;
};

export type AssetIngestDependencies = {
  readAsset: (id: string) => UserAsset | null;
  recordDeletedProviderAsset: (id: string, providerAssetId: string) => unknown;
  readUpload: typeof users.readUpload;
  readUploadState: typeof users.readUploadState;
  saveAsset: (asset: UserAsset) => unknown;
  callAsset: typeof callAssetApi;
  ensureGroup: () => Promise<string>;
  resolveMediaUrl: (media: { objectKey: string; uploadId?: string; fileName: string }) => Promise<string>;
  promoteMedia: typeof promoteUserAssetMedia;
  sleep: (ms: number) => Promise<unknown>;
  now: () => number;
};

let productionDependencies: AssetIngestDependencies | undefined;
const defaultDependencies = () => productionDependencies ??= {
  readAsset: (id) => users.readUserAsset(id),
  recordDeletedProviderAsset: (id, providerAssetId) => users.recordProviderIdForDeletedUserAsset(id, providerAssetId),
  readUpload: (uploadId) => users.readUpload(uploadId),
  readUploadState: (uploadId) => users.readUploadState(uploadId),
  saveAsset: (asset) => users.upsertUserAsset(asset),
  callAsset: callAssetApi,
  ensureGroup: ensureAutoReferenceGroup,
  resolveMediaUrl: (media) => resolveUploadMediaUrl(media),
  promoteMedia: (media) => promoteUserAssetMedia(media),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now
};

export class AssetUploadPendingError extends Error {
  readonly code = "ASSET_UPLOAD_PENDING";
  constructor() { super("素材已传输，正在完成内容校验"); this.name = "AssetUploadPendingError"; }
}

export class AssetCreateUnknownError extends Error {
  readonly code = "ASSET_CREATE_UNKNOWN";
  constructor(message = UNKNOWN_CREATE_MESSAGE, options?: ErrorOptions) { super(message, options); this.name = "AssetCreateUnknownError"; }
}

const isAmbiguousCreateFailure = (error: unknown) => !(error instanceof AssetApiError) || error.status >= 500;

const reconcileCreatedAsset = async (asset: UserAsset, groupId: string, providerName: string, deps: AssetIngestDependencies) => {
  const result = await deps.callAsset<{ Items?: ProviderAssetRecord[] }>("ListAssets", {
    Filter: { GroupType: AUTO_REFERENCE_GROUP_TYPE, GroupIds: [groupId], Name: providerName },
    PageNumber: 1,
    PageSize: 100,
  });
  const exact = (result.Items ?? []).filter((candidate) => candidate.Name === providerName
    && candidate.GroupId === groupId
    && (!candidate.AssetType || candidate.AssetType === asset.assetType));
  exact.sort((left, right) => String(right.CreateTime ?? "").localeCompare(String(left.CreateTime ?? "")));
  if (exact.length > 1) console.warn(JSON.stringify({ type: "asset_ingest_reconcile_duplicates", at: new Date().toISOString(), assetId: asset.id, ownerId: asset.ownerId, count: exact.length }));
  return exact[0];
};

const saved = (asset: UserAsset, patch: Partial<UserAsset>, deps: AssetIngestDependencies) => {
  const next = { ...asset, ...patch, updatedAt: deps.now() };
  deps.saveAsset(next);
  return next;
};

export const markAssetIngestFailed = (assetId: string, message: string, deps: AssetIngestDependencies = defaultDependencies()) => {
  const asset = deps.readAsset(assetId);
  if (!asset) return null;
  return saved(asset, { status: "Failed", lastError: message.slice(0, 300) }, deps);
};

export const registerQueuedAsset = async (assetId: string, deps: AssetIngestDependencies = defaultDependencies()) => {
  let asset = deps.readAsset(assetId);
  if (!asset) return;
  if (!asset.uploadId) return markAssetIngestFailed(asset.id, "素材缺少上传记录", deps);

  const uploaded = deps.readUpload(asset.uploadId);
  if (!uploaded) {
    const state = deps.readUploadState(asset.uploadId);
    if (state?.ownerId === asset.ownerId && state.status === "uploading") throw new AssetUploadPendingError();
    return markAssetIngestFailed(asset.id, "已上传文件不存在或尚未完成校验", deps);
  }
  if (uploaded.ownerId !== asset.ownerId || uploaded.status !== "ready") return markAssetIngestFailed(asset.id, "已上传文件不存在或尚未完成校验", deps);
  let media = uploaded;
  try {
    media = await deps.promoteMedia(uploaded);
  } catch (error) {
    // An already registered provider asset remains usable while the background
    // scanner retries the durable TOS copy. Do not regress it to Failed.
    if (asset.status === "Active" && asset.providerAssetId) {
      console.warn(JSON.stringify({ type: "tos_asset_promotion_failed", at: new Date().toISOString(), assetId: asset.id, ownerId: asset.ownerId, code: (error as { code?: string }).code ?? "unknown" }));
      return;
    }
    throw error;
  }
  if (asset.status === "Active" && asset.providerAssetId) return;

  let providerAssetId = asset.providerAssetId;
  if (!providerAssetId) {
    const groupId = asset.groupId || await deps.ensureGroup();
    const providerName = providerAssetName(asset.name, asset.uploadId);
    let created: ProviderAssetRecord;
    if (asset.lastError === UNKNOWN_CREATE_MESSAGE) {
      if (deps.now() - asset.createdAt > UNKNOWN_CREATE_DEADLINE_MS) return markAssetIngestFailed(asset.id, "素材生成引用的创建结果长时间无法确认，请重新上传", deps);
      try {
        const reconciled = await reconcileCreatedAsset(asset, groupId, providerName, deps);
        if (!reconciled) throw new AssetCreateUnknownError();
        created = reconciled;
      } catch (error) {
        if (error instanceof AssetCreateUnknownError) throw error;
        throw new AssetCreateUnknownError(UNKNOWN_CREATE_MESSAGE, { cause: error });
      }
    } else {
      const reconciledBeforeCreate = await reconcileCreatedAsset(asset, groupId, providerName, deps);
      if (reconciledBeforeCreate) created = reconciledBeforeCreate;
      else {
        try {
          created = await deps.callAsset<ProviderAssetRecord>("CreateAsset", {
            GroupId: groupId,
            URL: await deps.resolveMediaUrl(media),
            AssetType: asset.assetType,
            Name: providerName
          });
        } catch (error) {
          if (error instanceof AssetApiError && error.status === 429) throw error;
          const message = error instanceof Error ? error.message : "素材服务暂时不可用";
          if (!isAmbiguousCreateFailure(error)) {
            markAssetIngestFailed(asset.id, message, deps);
            console.warn(JSON.stringify({ type: "asset_ingest_create_failed", at: new Date().toISOString(), assetId: asset.id, ownerId: asset.ownerId, code: (error as { code?: string }).code ?? "unknown" }));
            return;
          }
          asset = saved(asset, { groupId, status: "Processing", lastError: UNKNOWN_CREATE_MESSAGE }, deps);
          console.warn(JSON.stringify({ type: "asset_ingest_create_unknown", at: new Date().toISOString(), assetId: asset.id, ownerId: asset.ownerId, code: (error as { code?: string }).code ?? "unknown" }));
          try {
            const reconciled = await reconcileCreatedAsset(asset, groupId, providerName, deps);
            if (!reconciled) throw new AssetCreateUnknownError();
            created = reconciled;
          } catch (reconcileError) {
            if (reconcileError instanceof AssetCreateUnknownError) throw reconcileError;
            throw new AssetCreateUnknownError(UNKNOWN_CREATE_MESSAGE, { cause: reconcileError });
          }
        }
      }
    }
    if (!created.Id?.startsWith("asset-")) return markAssetIngestFailed(asset.id, "素材服务未返回有效资产 ID", deps);
    providerAssetId = created.Id;
    const current = deps.readAsset(asset.id);
    if (!current) {
      // A concurrent local delete won the race. Persist the remote id on its tombstone;
      // the cleanup worker will reconcile deletion without swallowing failures here.
      deps.recordDeletedProviderAsset(asset.id, providerAssetId);
      return;
    }
    asset = saved(current, {
      providerAssetId,
      groupId: created.GroupId ?? groupId,
      name: current.name,
      assetType: created.AssetType ?? current.assetType,
      status: created.Status ?? "Processing",
      url: created.URL,
      lastError: undefined
    }, deps);
    console.info(JSON.stringify({ type: "asset_ingest_created", at: new Date().toISOString(), assetId: asset.id, ownerId: asset.ownerId, providerAssetId }));
    if (asset.status === "Active") return;
  }

  const deadline = deps.now() + ACTIVE_DEADLINE_MS;
  while (deps.now() < deadline) {
    const current = deps.readAsset(asset.id);
    if (!current) {
      // The tombstone already retains providerAssetId. Let the durable cleanup queue
      // own provider deletion instead of hiding a best-effort failure in this worker.
      return;
    }
    const provider = await deps.callAsset<ProviderAssetRecord>("GetAsset", { Id: providerAssetId });
    if (provider.Status === "Active") {
      saved(current, {
        providerAssetId,
        groupId: provider.GroupId ?? current.groupId,
        name: current.name,
        assetType: provider.AssetType ?? current.assetType,
        status: "Active",
        url: provider.URL ?? current.url,
        lastError: undefined
      }, deps);
      console.info(JSON.stringify({ type: "asset_ingest_active", at: new Date().toISOString(), assetId: current.id, ownerId: current.ownerId, providerAssetId }));
      return;
    }
    if (provider.Status === "Failed") return markAssetIngestFailed(current.id, "素材服务处理失败，请检查素材内容后重试", deps);
    await deps.sleep(POLL_INTERVAL_MS);
  }
  throw new Error("素材仍在生成引用处理中");
};
