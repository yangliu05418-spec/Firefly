import { describe, expect, it, vi } from "vitest";
import { AssetApiError } from "./asset-api.js";
import { AssetRegistrationRejected, deterministicAssetName, prepareProviderAssets } from "./asset-registration.js";
import { buildProviderPayload, type GenerationInput } from "./provider.js";

const input = (): GenerationInput => ({
  prompt: "Image 1 walks through a room", model: "dreamina-seedance-2-5-260628", mode: "omni",
  ratio: "16:9", resolution: "720p", duration: 5, generateAudio: true, seed: -1,
  cameraFixed: false, watermark: false, outputFormat: "mp4",
  assets: [{ id: "local-1", uploadId: "upload-12345678901234567890", name: "actor.png", type: "image", role: "reference_image" }]
});

describe("trusted asset registration", () => {
  it("registers a TOS upload, waits for Active, and passes asset URI metadata", async () => {
    const callAsset = vi.fn(async (action: string) => {
      if (action === "ListAssetGroups") return { Items: [{ Id: "group-1", Name: "Firefly Auto References" }] };
      if (action === "ListAssets") return { Items: [] };
      if (action === "CreateAsset") return { Id: "asset-1" };
      if (action === "GetAsset") return { Id: "asset-1", Status: "Active" };
      throw new Error(action);
    });
    const result = await prepareProviderAssets(input(), "owner-1", {
      readUpload: vi.fn(() => ({ ownerId: "owner-1", status: "ready", contentType: "image/png", objectKey: "inputs/a.png", fileName: "actor.png" }) as never),
      cacheGet: vi.fn(async () => null), cacheSet: vi.fn(async () => undefined), callAsset: callAsset as never,
      resolveMediaUrl: vi.fn(async () => "https://tos.example/asset") as never, sleep: vi.fn(async () => undefined), now: vi.fn(() => 1)
    });
    expect(result.assets[0]).toMatchObject({ uploadId: "upload-12345678901234567890", assetId: "asset-1" });
    expect(callAsset).toHaveBeenCalledWith("CreateAsset", expect.objectContaining({ GroupId: "group-1", AssetType: "Image" }));
    expect(buildProviderPayload(result).content).toEqual([
      { type: "text", text: "Image 1 walks through a room" },
      { type: "image_url", image_url: { url: "asset://asset-1" }, role: "reference_image" }
    ]);
  });

  it("reuses a cached asset id without creating a duplicate", async () => {
    const callAsset = vi.fn(async (action: string) => action === "GetAsset" ? { Id: "asset-existing", Status: "Active" } : (() => { throw new Error(action); })());
    const result = await prepareProviderAssets(input(), "owner-1", {
      readUpload: vi.fn() as never, cacheGet: vi.fn(async () => "asset-existing"), cacheSet: vi.fn(async () => undefined),
      callAsset: callAsset as never, resolveMediaUrl: vi.fn(async () => "https://tos.example/asset") as never, sleep: vi.fn(async () => undefined), now: vi.fn(() => 1)
    });
    expect(result.assets[0]?.assetId).toBe("asset-existing");
    expect(callAsset).toHaveBeenCalledTimes(1);
  });

  it("reconciles an unknown operation by deterministic name without another create", async () => {
    const deterministicName = deterministicAssetName("owner-1", "upload-12345678901234567890", "actor.png");
    const callAsset = vi.fn(async (action: string) => {
      if (action === "ListAssetGroups") return { Items: [{ Id: "group-1", Name: "Firefly Auto References" }] };
      if (action === "ListAssets") return { Items: [{ Id: "asset-reconciled", GroupId: "group-1", Name: deterministicName, Status: "Processing" }] };
      if (action === "GetAsset") return { Id: "asset-reconciled", Status: "Active" };
      throw new Error(action);
    });
    const result = await prepareProviderAssets(input(), "owner-1", {
      readUpload: vi.fn(() => ({ ownerId: "owner-1", status: "ready", contentType: "image/png", objectKey: "inputs/a.png", fileName: "actor.png" }) as never),
      cacheGet: vi.fn(async () => null), cacheSet: vi.fn(async () => undefined), callAsset: callAsset as never,
      resolveMediaUrl: vi.fn(async () => "https://tos.example/asset") as never, sleep: vi.fn(async () => undefined), now: vi.fn(() => 100),
      readOperation: vi.fn(() => ({ ownerId: "owner-1", uploadId: "upload-12345678901234567890", deterministicName, groupId: "group-1", assetType: "Image" as const, status: "unknown" as const, attemptCount: 1, createdAt: 1, updatedAt: 1 })),
      updateOperation: vi.fn(() => null)
    });
    expect(result.assets[0]?.assetId).toBe("asset-reconciled");
    expect(callAsset.mock.calls.filter(([action]) => action === "CreateAsset")).toHaveLength(0);
  });

  it("reconciles a lost CreateAsset response instead of retrying the mutation", async () => {
    const deterministicName = deterministicAssetName("owner-1", "upload-12345678901234567890", "actor.png");
    let listCalls = 0;
    const callAsset = vi.fn(async (action: string) => {
      if (action === "ListAssetGroups") return { Items: [{ Id: "group-1", Name: "Firefly Auto References" }] };
      if (action === "ListAssets") return { Items: ++listCalls === 1 ? [] : [{ Id: "asset-after-timeout", GroupId: "group-1", Name: deterministicName }] };
      if (action === "CreateAsset") throw new AssetApiError("socket reset", { retryable: true, resultUnknown: true });
      if (action === "GetAsset") return { Id: "asset-after-timeout", Status: "Active" };
      throw new Error(action);
    });
    const result = await prepareProviderAssets(input(), "owner-1", {
      readUpload: vi.fn(() => ({ ownerId: "owner-1", status: "ready", contentType: "image/png", objectKey: "inputs/a.png", fileName: "actor.png" }) as never),
      cacheGet: vi.fn(async () => null), cacheSet: vi.fn(async () => undefined), callAsset: callAsset as never,
      resolveMediaUrl: vi.fn(async () => "https://tos.example/asset") as never, sleep: vi.fn(async () => undefined), now: vi.fn(() => 100),
      createOperation: vi.fn((operation) => ({ inserted: true, operation: { ...operation, status: "pending", attemptCount: 1 } })),
      updateOperation: vi.fn(() => null)
    });
    expect(result.assets[0]?.assetId).toBe("asset-after-timeout");
    expect(callAsset.mock.calls.filter(([action]) => action === "CreateAsset")).toHaveLength(1);
  });

  it("reconciles a lost CreateAssetGroup response without creating a second group", async () => {
    let groupLists = 0;
    const callAsset = vi.fn(async (action: string) => {
      if (action === "ListAssetGroups") return { Items: ++groupLists === 1 ? [] : [{ Id: "group-reconciled", Name: "Firefly Auto References" }] };
      if (action === "CreateAssetGroup") throw new AssetApiError("timeout", { retryable: true, resultUnknown: true });
      if (action === "ListAssets") return { Items: [] };
      if (action === "CreateAsset") return { Id: "asset-1" };
      if (action === "GetAsset") return { Id: "asset-1", Status: "Active" };
      throw new Error(action);
    });
    const result = await prepareProviderAssets(input(), "owner-1", {
      readUpload: vi.fn(() => ({ ownerId: "owner-1", status: "ready", contentType: "image/png", objectKey: "inputs/a.png", fileName: "actor.png" }) as never),
      cacheGet: vi.fn(async () => null), cacheSet: vi.fn(async () => undefined), callAsset: callAsset as never,
      resolveMediaUrl: vi.fn(async () => "https://tos.example/asset") as never, sleep: vi.fn(async () => undefined), now: vi.fn(() => 100)
    });
    expect(result.assets[0]?.assetId).toBe("asset-1");
    expect(callAsset.mock.calls.filter(([action]) => action === "CreateAssetGroup")).toHaveLength(1);
  });

  it("validates selected assets and preserves prompt reference order under concurrent preparation", async () => {
    const selected = input();
    selected.assets = [
      { id: "selected-2", assetId: "asset-2", name: "second.png", type: "image", role: "reference_image" },
      { id: "selected-1", assetId: "asset-1", name: "first.png", type: "image", role: "reference_image" }
    ];
    const callAsset = vi.fn(async (_action: string, body: Record<string, unknown>) => ({ Id: body.Id, Status: "Active" }));
    const result = await prepareProviderAssets(selected, "owner-1", {
      readUpload: vi.fn() as never, cacheGet: vi.fn(async () => null), cacheSet: vi.fn(async () => undefined),
      callAsset: callAsset as never, resolveMediaUrl: vi.fn(async () => "https://tos.example/asset") as never, sleep: vi.fn(async () => undefined), now: vi.fn(() => 1)
    });
    expect(result.assets.map((asset) => asset.assetId)).toEqual(["asset-2", "asset-1"]);
    expect(callAsset).toHaveBeenCalledTimes(2);
  });

  it("rejects a selected asset whose provider status is Failed", async () => {
    const selected = input();
    selected.assets[0] = { ...selected.assets[0]!, uploadId: undefined, assetId: "asset-failed" };
    await expect(prepareProviderAssets(selected, "owner-1", {
      readUpload: vi.fn() as never, cacheGet: vi.fn(async () => null), cacheSet: vi.fn(async () => undefined),
      callAsset: vi.fn(async () => ({ Id: "asset-failed", Status: "Failed" })) as never,
      resolveMediaUrl: vi.fn(async () => "https://tos.example/asset") as never, sleep: vi.fn(async () => undefined), now: vi.fn(() => 1)
    })).rejects.toThrow("处理失败，无法用于生成");
  });

  it("rejects a selected asset that is not owned by the current user", async () => {
    const selected = input();
    selected.assets[0] = { ...selected.assets[0]!, uploadId: undefined, assetId: "asset-other-user" };
    await expect(prepareProviderAssets(selected, "owner-1", {
      readUpload: vi.fn() as never, readOwnedAsset: vi.fn(() => false), cacheGet: vi.fn(async () => null), cacheSet: vi.fn(async () => undefined),
      callAsset: vi.fn() as never, resolveMediaUrl: vi.fn(async () => "https://tos.example/asset") as never, sleep: vi.fn(async () => undefined), now: vi.fn(() => 1)
    })).rejects.toThrow("不属于当前用户");
  });

  it("exposes structured rejection codes for processing timeout and provider failure", async () => {
    const selected = input();
    selected.assets[0] = { ...selected.assets[0]!, uploadId: undefined, assetId: "asset-slow" };
    let tick = 0;
    const timeout = await prepareProviderAssets(selected, "owner-1", {
      readUpload: vi.fn() as never, cacheGet: vi.fn(async () => null), cacheSet: vi.fn(async () => undefined),
      callAsset: vi.fn(async () => ({ Id: "asset-slow", Status: "Processing" })) as never,
      resolveMediaUrl: vi.fn(async () => "https://tos.example/asset") as never, sleep: vi.fn(async () => undefined),
      now: vi.fn(() => (tick += 60_000))
    }).catch((error: unknown) => error as AssetRegistrationRejected);
    expect(timeout).toBeInstanceOf(AssetRegistrationRejected);
    expect((timeout as AssetRegistrationRejected).code).toBe("ASSET_PROCESSING_TIMEOUT");
    expect((timeout as AssetRegistrationRejected).message).toContain("仍在可信资产处理中");

    const failed = await prepareProviderAssets(selected, "owner-1", {
      readUpload: vi.fn() as never, cacheGet: vi.fn(async () => null), cacheSet: vi.fn(async () => undefined),
      callAsset: vi.fn(async () => ({ Id: "asset-slow", Status: "Failed" })) as never,
      resolveMediaUrl: vi.fn(async () => "https://tos.example/asset") as never, sleep: vi.fn(async () => undefined), now: vi.fn(() => 1)
    }).catch((error: unknown) => error as AssetRegistrationRejected);
    expect((failed as AssetRegistrationRejected).code).toBe("ASSET_PROVIDER_FAILED");
  });
});
