import { describe, expect, it, vi } from "vitest";
import { coordinateUploadFinalization, type UploadFinalizationCoordinatorDependencies } from "./upload-finalization-coordinator.js";
import type { MediaObject, UserAsset } from "./db.js";

const setup = (result: { status: "ready" } | { status: "failed"; error: string }) => {
  let status: "uploading" | "ready" | "deleted" = "uploading";
  const media = (): MediaObject => ({ id: "input:upload-1", ownerId: "owner-1", uploadId: "upload-1", kind: "input", objectKey: "inputs/one", status, fileName: "one.png", contentType: "image/png", size: 1, etag: "", createdAt: 1, updatedAt: 1 });
  const asset = (): UserAsset => ({ id: "asset-local-1", ownerId: "owner-1", groupId: "", uploadId: "upload-1", name: "one.png", assetType: "Image", status: "Processing", category: "material", createdAt: 1, updatedAt: 1 });
  const deps: UploadFinalizationCoordinatorDependencies = {
    readUploadState: vi.fn(() => media()),
    readAsset: vi.fn(() => asset()),
    finalize: vi.fn(async () => { status = result.status === "ready" ? "ready" : "deleted"; return result; }),
    rememberError: vi.fn(async () => undefined), clearUploadKeys: vi.fn(async () => undefined), failAsset: vi.fn(), enqueueAsset: vi.fn(async () => undefined),
  };
  return deps;
};

describe("upload finalization coordinator", () => {
  it("queues a pending asset as soon as its upload becomes authoritative", async () => {
    const deps = setup({ status: "ready" });
    await coordinateUploadFinalization("upload-1", deps);
    expect(deps.enqueueAsset).toHaveBeenCalledWith("asset-local-1");
    expect(deps.clearUploadKeys).toHaveBeenCalledWith("upload-1", true);
    expect(deps.failAsset).not.toHaveBeenCalled();
  });

  it("turns a rejected upload into an explicit asset failure without provider registration", async () => {
    const deps = setup({ status: "failed", error: "invalid dimensions" });
    await coordinateUploadFinalization("upload-1", deps);
    expect(deps.rememberError).toHaveBeenCalledWith("upload-1", "invalid dimensions");
    expect(deps.failAsset).toHaveBeenCalledWith("asset-local-1", "invalid dimensions");
    expect(deps.enqueueAsset).not.toHaveBeenCalled();
  });

  it("persists rejection before Redis cleanup so a cache outage cannot strand the asset", async () => {
    const deps = setup({ status: "failed", error: "invalid image" });
    const events: string[] = [];
    deps.failAsset = vi.fn(() => { events.push("database"); });
    deps.rememberError = vi.fn(async () => { events.push("redis"); throw new Error("redis unavailable"); });
    await expect(coordinateUploadFinalization("upload-1", deps)).rejects.toThrow("redis unavailable");
    expect(events).toEqual(["database", "redis"]);
    expect(deps.failAsset).toHaveBeenCalledWith("asset-local-1", "invalid image");
  });
});
