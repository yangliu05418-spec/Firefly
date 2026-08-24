import { describe, expect, it, vi } from "vitest";
import { AssetCreateUnknownError, AssetUploadPendingError, registerQueuedAsset, type AssetIngestDependencies } from "./asset-ingest.js";
import { providerAssetName } from "./asset-name.js";
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
    recordDeletedProviderAsset: vi.fn(),
    readUpload: vi.fn(() => ({ ownerId: "owner-1", status: "ready", objectKey: "inputs/actor.png", uploadId: "upload-1", fileName: "actor.png" }) as never),
    readUploadState: vi.fn(() => ({ ownerId: "owner-1", status: "ready", objectKey: "inputs/actor.png", uploadId: "upload-1", fileName: "actor.png" }) as never),
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
    expect(context.callAsset).toHaveBeenCalledWith("ListAssets", expect.objectContaining({
      Filter: expect.objectContaining({ GroupType: "AIGC", GroupIds: ["group-1"] })
    }));
    expect(context.callAsset).toHaveBeenCalledWith("CreateAsset", expect.objectContaining({ GroupId: "group-1", AssetType: "Image" }));
    expect(context.stored()).toMatchObject({ id: "asset-local-1", providerAssetId: "asset-provider-1", status: "Active", url: "https://provider.example/actor.png" });
  });

  it("never blindly replays an ambiguous CreateAsset timeout", async () => {
    const context = setup();
    context.deps.callAsset = vi.fn(async (action: string) => {
      if (action === "ListAssets") return { Items: [] };
      throw new Error("The operation was aborted due to timeout");
    }) as never;
    await expect(registerQueuedAsset("asset-local-1", context.deps)).rejects.toBeInstanceOf(AssetCreateUnknownError);
    expect(context.deps.callAsset).toHaveBeenCalledTimes(3);
    expect(context.stored()).toMatchObject({ status: "Processing", lastError: "素材已上传，正在确认生成引用" });
  });

  it("reconciles an ambiguous CreateAsset response by deterministic name", async () => {
    const context = setup();
    const name = providerAssetName("actor.png", "upload-1");
    let listCount = 0;
    const callAsset = vi.fn(async (action: string) => {
      if (action === "CreateAsset") throw new Error("socket closed after request");
      if (action === "ListAssets") return { Items: ++listCount === 1 ? [] : [{ Id: "asset-provider-1", Name: name, GroupId: "group-1", AssetType: "Image", Status: "Processing" }] };
      if (action === "GetAsset") return { Id: "asset-provider-1", Status: "Active", URL: "https://provider.example/actor.png" };
      return {};
    });
    context.deps.callAsset = callAsset as never;

    await registerQueuedAsset("asset-local-1", context.deps);

    expect(callAsset.mock.calls.map(([action]) => action)).toEqual(["ListAssets", "CreateAsset", "ListAssets", "GetAsset"]);
    expect(context.stored()).toMatchObject({ providerAssetId: "asset-provider-1", status: "Active" });
  });

  it("reuses a provider asset after a worker crash instead of creating a duplicate", async () => {
    const context = setup();
    const name = providerAssetName("actor.png", "upload-1");
    const callAsset = vi.fn(async (action: string) => {
      if (action === "ListAssets") return { Items: [{ Id: "asset-provider-existing", Name: name, GroupId: "group-1", AssetType: "Image", Status: "Processing" }] };
      if (action === "GetAsset") return { Id: "asset-provider-existing", Status: "Active" };
      throw new Error(action);
    });
    context.deps.callAsset = callAsset as never;

    await registerQueuedAsset("asset-local-1", context.deps);

    expect(callAsset.mock.calls.map(([action]) => action)).toEqual(["ListAssets", "GetAsset"]);
    expect(context.stored()).toMatchObject({ providerAssetId: "asset-provider-existing", status: "Active" });
  });

  it("keeps reconciling an unknown create result without issuing another create", async () => {
    const context = setup({ ...pending(), groupId: "group-1", lastError: "素材已上传，正在确认生成引用" });
    const callAsset = vi.fn(async (_action: string, _body: Record<string, unknown>) => ({ Items: [] }));
    context.deps.callAsset = callAsset as never;

    await expect(registerQueuedAsset("asset-local-1", context.deps)).rejects.toBeInstanceOf(AssetCreateUnknownError);

    expect(callAsset.mock.calls.map(([action]) => action)).toEqual(["ListAssets"]);
    expect(context.stored()).toMatchObject({ status: "Processing" });
  });

  it("keeps a just-transported asset processing until deep upload validation completes", async () => {
    const context = setup();
    context.deps.readUpload = vi.fn(() => null);
    context.deps.readUploadState = vi.fn(() => ({ ownerId: "owner-1", status: "uploading" }) as never);
    await expect(registerQueuedAsset("asset-local-1", context.deps)).rejects.toBeInstanceOf(AssetUploadPendingError);
    expect(context.stored()).toMatchObject({ status: "Processing" });
    expect(context.callAsset).not.toHaveBeenCalled();
  });

  it("records a created provider id on the tombstone when deletion wins the registration race", async () => {
    const context = setup();
    context.deps.readAsset = vi.fn()
      .mockReturnValueOnce(pending())
      .mockReturnValueOnce(null);
    await registerQueuedAsset("asset-local-1", context.deps);
    expect(context.deps.recordDeletedProviderAsset).toHaveBeenCalledWith("asset-local-1", "asset-provider-1");
    expect(context.callAsset.mock.calls.map(([action]) => action)).toEqual(["ListAssets", "CreateAsset"]);
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
