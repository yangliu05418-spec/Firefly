import { describe, expect, it, vi } from "vitest";
import { AssetApiError } from "./asset-api.js";
import { deleteQueuedProviderAsset, type AssetCleanupDependencies } from "./asset-cleanup.js";
import type { UserAsset } from "./db.js";

const deletedAsset = (): UserAsset => ({
  id: "asset-local-1", providerAssetId: "asset-provider-1", ownerId: "owner-1",
  groupId: "group-1", name: "actor.png", assetType: "Image", status: "Active",
  category: "character", createdAt: 1, updatedAt: 2, deletedAt: 3
});

const setup = (asset: UserAsset | null = deletedAsset()) => {
  const clearProviderId = vi.fn();
  const callAsset = vi.fn(async () => ({}));
  const deps: AssetCleanupDependencies = {
    readAssetIncludingDeleted: vi.fn(() => asset),
    clearProviderId,
    callAsset: callAsset as never
  };
  return { deps, clearProviderId, callAsset };
};

describe("provider asset cleanup", () => {
  it("clears the tombstone only after provider deletion succeeds", async () => {
    const context = setup();
    await deleteQueuedProviderAsset("asset-local-1", context.deps);
    expect(context.callAsset).toHaveBeenCalledWith("DeleteAsset", { Id: "asset-provider-1" });
    expect(context.clearProviderId).toHaveBeenCalledWith("asset-local-1", "asset-provider-1");
  });

  it("reconciles an ambiguous delete response when GetAsset confirms absence", async () => {
    const context = setup();
    context.deps.callAsset = vi.fn(async (action: string) => {
      if (action === "DeleteAsset") throw new TypeError("fetch failed");
      throw new AssetApiError("asset does not exist", 404, "NotFound", "GetAsset");
    }) as never;
    await deleteQueuedProviderAsset("asset-local-1", context.deps);
    expect(context.deps.callAsset).toHaveBeenCalledTimes(2);
    expect(context.clearProviderId).toHaveBeenCalledTimes(1);
  });

  it("keeps the tombstone retryable when the provider asset still exists", async () => {
    const context = setup();
    context.deps.callAsset = vi.fn(async (action: string) => {
      if (action === "DeleteAsset") throw new TypeError("fetch failed");
      return { Id: "asset-provider-1", Status: "Active" };
    }) as never;
    await expect(deleteQueuedProviderAsset("asset-local-1", context.deps)).rejects.toThrow("fetch failed");
    expect(context.clearProviderId).not.toHaveBeenCalled();
  });

  it("does nothing for active rows or tombstones without a provider id", async () => {
    const active = setup({ ...deletedAsset(), deletedAt: undefined });
    await deleteQueuedProviderAsset("asset-local-1", active.deps);
    expect(active.callAsset).not.toHaveBeenCalled();
    const localOnly = setup({ ...deletedAsset(), providerAssetId: undefined });
    await deleteQueuedProviderAsset("asset-local-1", localOnly.deps);
    expect(localOnly.callAsset).not.toHaveBeenCalled();
  });
});
