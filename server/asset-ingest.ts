import { callAssetApi } from "./asset-api.js";
import { ensureAutoReferenceGroup } from "./asset-registration.js";
import type { UserAsset } from "./db.js";
import { resolveUploadMediaUrl } from "./media-url.js";
import { users } from "./store.js";
import { providerAssetName } from "./asset-name.js";
import { promoteUserAssetMedia } from "./asset-media.js";

const ACTIVE_DEADLINE_MS = 3 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;

type ProviderAssetRecord = {
  Id: string;
  Name?: string;
  AssetType?: UserAsset["assetType"];
  Status?: UserAsset["status"];
  URL?: string;
  GroupId?: string;
};

export type AssetIngestDependencies = {
  readAsset: (id: string) => UserAsset | null;
  recordDeletedProviderAsset: (id: string, providerAssetId: string) => unknown;
  readUpload: typeof users.readUpload;
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
  saveAsset: (asset) => users.upsertUserAsset(asset),
  callAsset: callAssetApi,
  ensureGroup: ensureAutoReferenceGroup,
  resolveMediaUrl: (media) => resolveUploadMediaUrl(media),
  promoteMedia: (media) => promoteUserAssetMedia(media),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now
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
  if (!uploaded || uploaded.ownerId !== asset.ownerId || uploaded.status !== "ready") {
    return markAssetIngestFailed(asset.id, "已上传文件不存在或尚未完成校验", deps);
  }
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
    let created: ProviderAssetRecord;
    try {
      created = await deps.callAsset<ProviderAssetRecord>("CreateAsset", {
        GroupId: groupId,
        URL: await deps.resolveMediaUrl(media),
        AssetType: asset.assetType,
        Name: providerAssetName(asset.name)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "素材服务暂时不可用";
      // CreateAsset has no idempotency token. An ambiguous timeout must not be replayed automatically.
      markAssetIngestFailed(asset.id, /timeout|aborted/i.test(message) ? "素材已上传，但生成引用建立超时，请稍后重试" : message, deps);
      console.warn(JSON.stringify({ type: "asset_ingest_create_failed", at: new Date().toISOString(), assetId: asset.id, ownerId: asset.ownerId, code: (error as { code?: string }).code ?? "unknown" }));
      return;
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
