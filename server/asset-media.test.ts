import { describe, expect, it, vi } from "vitest";
import type { MediaObject } from "./db.js";
import { promoteUserAssetMedia, type AssetMediaPromotionDependencies } from "./asset-media.js";

const media = (objectKey = "inputs/ab/owner-1/upload-1/reference.png"): MediaObject => ({
  id: "media-upload-1", ownerId: "owner-1", uploadId: "upload-1", kind: "input", objectKey,
  status: "ready", fileName: "reference.png", contentType: "image/png", size: 2048, etag: "source-etag",
  createdAt: 1, updatedAt: 1
});

const setup = () => {
  const deps: AssetMediaPromotionDependencies = {
    copy: vi.fn(async () => ({ requestId: "copy-request" })),
    verify: vi.fn(async () => ({ size: 2048, etag: "target-etag", requestId: "head-request" })),
    save: vi.fn(),
    now: vi.fn(() => 2)
  };
  return deps;
};

describe("user asset media promotion", () => {
  it("copies an input to a deterministic durable key and persists it only after verification", async () => {
    const deps = setup();
    const result = await promoteUserAssetMedia(media(), deps);
    expect(deps.copy).toHaveBeenCalledWith(
      expect.stringMatching(/^inputs\//),
      expect.stringMatching(/^assets\/[a-f0-9]{2}\/owner-1\/upload-1\/reference\.png$/),
      expect.any(Object)
    );
    expect(deps.verify).toHaveBeenCalledWith(result.objectKey, "image/png");
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ objectKey: result.objectKey, etag: "target-etag", updatedAt: 2 }));
  });

  it("reconciles a copy whose successful response was lost", async () => {
    const deps = setup();
    deps.copy = vi.fn(async () => { throw new Error("socket closed"); });
    await expect(promoteUserAssetMedia(media(), deps)).resolves.toMatchObject({ objectKey: expect.stringMatching(/^assets\//) });
    expect(deps.save).toHaveBeenCalledTimes(1);
  });

  it("does not persist a mismatched destination", async () => {
    const deps = setup();
    deps.verify = vi.fn(async () => ({ size: 1024, etag: "wrong" }));
    await expect(promoteUserAssetMedia(media(), deps)).rejects.toThrow("大小不一致");
    expect(deps.save).not.toHaveBeenCalled();
  });

  it("does no object work after the durable key is stored", async () => {
    const deps = setup();
    await expect(promoteUserAssetMedia(media("assets/ab/owner-1/upload-1/reference.png"), deps))
      .resolves.toMatchObject({ objectKey: expect.stringMatching(/^assets\//) });
    expect(deps.copy).not.toHaveBeenCalled();
    expect(deps.verify).not.toHaveBeenCalled();
  });
});
