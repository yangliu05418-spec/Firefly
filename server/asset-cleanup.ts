import { callAssetApi, isMissingProviderAssetError } from "./asset-api.js";
import type { UserAsset } from "./db.js";
import { users } from "./store.js";

export type AssetCleanupDependencies = {
  readAssetIncludingDeleted: (id: string) => UserAsset | null;
  clearProviderId: (id: string, providerAssetId: string) => unknown;
  callAsset: typeof callAssetApi;
};

let productionDependencies: AssetCleanupDependencies | undefined;
const defaultDependencies = () => productionDependencies ??= {
  readAssetIncludingDeleted: (id) => users.readUserAssetIncludingDeleted(id),
  clearProviderId: (id, providerAssetId) => users.clearDeletedUserAssetProviderId(id, providerAssetId),
  callAsset: callAssetApi
};

export const deleteProviderAssetSafely = async (providerAssetId: string, callAsset: typeof callAssetApi = callAssetApi) => {
  try {
    await callAsset("DeleteAsset", { Id: providerAssetId });
  } catch (deleteError) {
    if (isMissingProviderAssetError(deleteError)) return;
    try { await callAsset("GetAsset", { Id: providerAssetId }); }
    catch (readError) {
      if (isMissingProviderAssetError(readError)) return;
      throw readError;
    }
    throw deleteError;
  }
};

/**
 * Delete a provider asset after the local soft-delete has already committed.
 * The tombstone keeps providerAssetId until deletion is confirmed, making the
 * operation recoverable after Redis loss, worker restarts, and ambiguous HTTP failures.
 */
export const deleteQueuedProviderAsset = async (assetId: string, deps: AssetCleanupDependencies = defaultDependencies()) => {
  const asset = deps.readAssetIncludingDeleted(assetId);
  if (!asset?.deletedAt || !asset.providerAssetId) return;
  const providerAssetId = asset.providerAssetId;

  await deleteProviderAssetSafely(providerAssetId, deps.callAsset);
  deps.clearProviderId(asset.id, providerAssetId);
  console.info(JSON.stringify({ type: "asset_provider_delete_completed", at: new Date().toISOString(), assetId: asset.id, ownerId: asset.ownerId, providerAssetId }));
};
