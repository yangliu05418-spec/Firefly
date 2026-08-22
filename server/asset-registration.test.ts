import { describe, expect, it, vi } from "vitest";
import { AssetRegistrationRejected, isRetryableAssetRejection, prepareProviderAssets } from "./asset-registration.js";
import { providerAssetName } from "./asset-name.js";
import { buildProviderPayload, type GenerationInput } from "./provider.js";
import { UploadReferencePendingError } from "./asset-upload-admission.js";

const input = (): GenerationInput => ({
  prompt: "Image 1 walks through a room", model: "dreamina-seedance-2-5-260628", mode: "omni",
  ratio: "16:9", resolution: "720p", duration: 5, generateAudio: true, seed: -1,
  cameraFixed: false, watermark: false, outputFormat: "mp4",
  assets: [{ id: "local-1", uploadId: "upload-12345678901234567890", name: "actor.png", type: "image", role: "reference_image" }]
});

describe("trusted asset registration", () => {
  it("retries processing timeouts but not deterministic provider rejections", () => {
    expect(isRetryableAssetRejection(new AssetRegistrationRejected("processing", "ASSET_PROCESSING_TIMEOUT"))).toBe(true);
    expect(isRetryableAssetRejection(new AssetRegistrationRejected("rejected", "ASSET_PROVIDER_FAILED"))).toBe(false);
  });
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

  it("defers provider asset registration until deep upload validation is ready", async () => {
    const callAsset = vi.fn();
    await expect(prepareProviderAssets(input(), "owner-1", {
      readUpload: vi.fn(() => null) as never,
      readUploadState: vi.fn(() => ({ ownerId: "owner-1", status: "uploading" })) as never,
      cacheGet: vi.fn(async () => null), cacheSet: vi.fn(async () => undefined), callAsset: callAsset as never,
      resolveMediaUrl: vi.fn(async () => "https://tos.example/asset") as never, sleep: vi.fn(async () => undefined), now: vi.fn(() => 1),
    })).rejects.toBeInstanceOf(UploadReferencePendingError);
    expect(callAsset).not.toHaveBeenCalled();
  });

  it("reconciles a CreateAsset response loss by deterministic upload name", async () => {
    const expectedName = providerAssetName("actor.png", "upload-12345678901234567890");
    let listCount = 0;
    const cacheSet = vi.fn(async () => undefined);
    const callAsset = vi.fn(async (action: string) => {
      if (action === "ListAssetGroups") return { Items: [{ Id: "group-1", Name: "Firefly Auto References" }] };
      if (action === "ListAssets") return { Items: ++listCount === 1 ? [] : [{ Id: "asset-reconciled", Name: expectedName, GroupId: "group-1", AssetType: "Image" }] };
      if (action === "CreateAsset") throw new Error("connection reset after request");
      if (action === "GetAsset") return { Id: "asset-reconciled", Status: "Active", GroupId: "group-1", AssetType: "Image" };
      throw new Error(action);
    });
    const result = await prepareProviderAssets(input(), "owner-1", {
      readUpload: vi.fn(() => ({ ownerId: "owner-1", status: "ready", contentType: "image/png", objectKey: "inputs/a.png", fileName: "actor.png" }) as never),
      cacheGet: vi.fn(async () => null), cacheSet, callAsset: callAsset as never,
      resolveMediaUrl: vi.fn(async () => "https://tos.example/asset") as never, sleep: vi.fn(async () => undefined), now: vi.fn(() => 10)
    });
    expect(result.assets[0]?.assetId).toBe("asset-reconciled");
    expect(callAsset.mock.calls.filter(([action]) => action === "CreateAsset")).toHaveLength(1);
    expect(cacheSet).toHaveBeenCalledWith(expect.any(String), "create-unknown:10");
    expect(cacheSet).toHaveBeenLastCalledWith(expect.any(String), "asset-reconciled");
  });

  it("never repeats CreateAsset while an ambiguous result is being reconciled", async () => {
    const callAsset = vi.fn(async (action: string) => {
      if (action === "ListAssetGroups") return { Items: [{ Id: "group-1", Name: "Firefly Auto References" }] };
      if (action === "ListAssets") return { Items: [] };
      throw new Error(action);
    });
    const result = await prepareProviderAssets(input(), "owner-1", {
      readUpload: vi.fn(() => ({ ownerId: "owner-1", status: "ready", contentType: "image/png", objectKey: "inputs/a.png", fileName: "actor.png" }) as never),
      cacheGet: vi.fn(async () => "create-unknown:10"), cacheSet: vi.fn(async () => undefined), callAsset: callAsset as never,
      resolveMediaUrl: vi.fn(async () => "https://tos.example/asset") as never, sleep: vi.fn(async () => undefined), now: vi.fn(() => 20)
    }).catch((caught: unknown) => caught);
    const error = result as AssetRegistrationRejected;
    expect(error).toBeInstanceOf(AssetRegistrationRejected);
    expect(error.code).toBe("ASSET_PROCESSING_TIMEOUT");
    expect(callAsset.mock.calls.map(([action]) => action)).toEqual(["ListAssetGroups", "ListAssets"]);
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

  it("resolves a stable local library id to the provider asset id before submission", async () => {
    const selected = input();
    selected.assets[0] = { ...selected.assets[0]!, uploadId: undefined, assetId: "asset-local-stable" };
    const saveAsset = vi.fn();
    const result = await prepareProviderAssets(selected, "owner-1", {
      readUpload: vi.fn() as never,
      readOwnedAsset: vi.fn(() => ({ providerAssetId: "asset-provider-ready", status: "Active" as const })),
      cacheGet: vi.fn(async () => null), cacheSet: vi.fn(async () => undefined),
      callAsset: vi.fn(async () => ({ Id: "asset-provider-ready", Status: "Active" })) as never,
      resolveMediaUrl: vi.fn(async () => "https://tos.example/asset") as never,
      sleep: vi.fn(async () => undefined), now: vi.fn(() => 1), saveAsset
    });
    expect(result.assets[0]?.assetId).toBe("asset-provider-ready");
    expect(saveAsset).toHaveBeenCalledWith(expect.objectContaining({ id: "asset-local-stable", providerAssetId: "asset-provider-ready", status: "Active" }));
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
      readUpload: vi.fn() as never, readOwnedAsset: vi.fn(() => null), cacheGet: vi.fn(async () => null), cacheSet: vi.fn(async () => undefined),
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
