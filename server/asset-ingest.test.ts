import { describe, expect, it, vi } from "vitest";
import { registerQueuedAsset, type AssetIngestDependencies } from "./asset-ingest.js";
import type { UserAsset } from "./db.js";

const pending = (): UserAsset => ({
  id: "asset-local-1", ownerId: "owner-1", groupId: "group-1", uploadId: "upload-1",
  name: "actor.png", assetType: "Image", status: "Processing", category: "character",
  createdAt: 1, updatedAt: 1
});

const setup = (asset = pending()) => {
  let stored: UserAsset | null = asset;
  const callAsset = vi.fn(async (action: string) => {
    if (action === "CreateAsset") return { Id: "asset-provider-1", Status: "Processing" };
    if (action === "GetAsset") return { Id: "asset-provider-1", Status: "Active", URL: "https://provider.example/actor.png" };
    return {};
  });
  const deps: AssetIngestDependencies = {
    readAsset: () => stored,
    readUpload: vi.fn(() => ({ ownerId: "owner-1", status: "ready", objectKey: "inputs/actor.png", uploadId: "upload-1", fileName: "actor.png" }) as never),
    saveAsset: (next) => { stored = next; },
    callAsset: callAsset as never,
    ensureGroup: vi.fn(async () => "group-1"),
    resolveMediaUrl: vi.fn(async () => "https://tos.example/actor.png"),
    promoteMedia: vi.fn(async (media) => media),
    sleep: vi.fn(async () => undefined),
    now: vi.fn(() => 2)
  };
  return { deps, callAsset, stored: () => stored };
};

describe("background asset ingestion", () => {
  it("persists the provider id and activates a TOS upload without blocking the upload request", async () => {
    const context = setup();
    await registerQueuedAsset("asset-local-1", context.deps);
    expect(context.callAsset).toHaveBeenCalledWith("CreateAsset", expect.objectContaining({ GroupId: "group-1", AssetType: "Image" }));
    expect(context.stored()).toMatchObject({ id: "asset-local-1", providerAssetId: "asset-provider-1", status: "Active", url: "https://provider.example/actor.png" });
  });

  it("never blindly replays an ambiguous CreateAsset timeout", async () => {
    const context = setup();
    context.deps.callAsset = vi.fn(async () => { throw new Error("The operation was aborted due to timeout"); }) as never;
    await registerQueuedAsset("asset-local-1", context.deps);
    expect(context.deps.callAsset).toHaveBeenCalledTimes(1);
    expect(context.stored()).toMatchObject({ status: "Failed", lastError: expect.stringContaining("已上传") });
  });

  it("resumes polling from a persisted provider id without creating another asset", async () => {
    const context = setup({ ...pending(), providerAssetId: "asset-provider-1" });
    await registerQueuedAsset("asset-local-1", context.deps);
    expect(context.callAsset.mock.calls.map(([action]) => action)).toEqual(["GetAsset"]);
    expect(context.stored()).toMatchObject({ status: "Active" });
  });

  it("promotes an already active uploaded asset without recreating the provider asset", async () => {
    const context = setup({ ...pending(), providerAssetId: "asset-provider-1", status: "Active" });
    await registerQueuedAsset("asset-local-1", context.deps);
    expect(context.deps.promoteMedia).toHaveBeenCalledTimes(1);
    expect(context.callAsset).not.toHaveBeenCalled();
  });

  it("does not regress an active provider asset when durable copying is temporarily unavailable", async () => {
    const context = setup({ ...pending(), providerAssetId: "asset-provider-1", status: "Active" });
    context.deps.promoteMedia = vi.fn(async () => { throw new Error("TOS timeout"); });
    await expect(registerQueuedAsset("asset-local-1", context.deps)).resolves.toBeUndefined();
    expect(context.stored()).toMatchObject({ status: "Active" });
    expect(context.callAsset).not.toHaveBeenCalled();
  });
});
