import { describe, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";
import { acquireAssetCreationLock, acquireUploadCompletionLock, claimUploadSlot, releaseAssetCreationLock, releaseUploadCompletionLock, releaseUploadSlot, renewUploadSlot, UPLOAD_SLOT_TTL_SECONDS } from "./upload-slots.js";

describe("upload concurrency guards", () => {
  it("uses one atomic Redis operation to claim a bounded user slot", async () => {
    const redis = { eval: vi.fn(async () => 1) } as unknown as Redis;
    await expect(claimUploadSlot(redis, "user-1", "upload-1", 6, 1000)).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, "upload-slots:user-1", 1000, 1000 + UPLOAD_SLOT_TTL_SECONDS * 1000, 6, "upload-1");
  });

  it("renews only an upload slot that is still active", async () => {
    const evalCall = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const redis = { eval: evalCall } as unknown as Redis;
    await expect(renewUploadSlot(redis, "user-1", "upload-1", 2000)).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, "upload-slots:user-1", 2000, 2000 + UPLOAD_SLOT_TTL_SECONDS * 1000, "upload-1");
    await expect(renewUploadSlot(redis, "user-1", "expired-upload", 3000)).resolves.toBe(false);
  });

  it("returns null when another completion owns the lock", async () => {
    const redis = { set: vi.fn(async () => null) } as unknown as Redis;
    await expect(acquireUploadCompletionLock(redis, "upload-1")).resolves.toBeNull();
  });

  it("releases slots and completion locks with ownership-safe operations", async () => {
    const redis = { zrem: vi.fn(async () => 1), eval: vi.fn(async () => 1) } as unknown as Redis;
    await releaseUploadSlot(redis, "user-1", "upload-1");
    await releaseUploadCompletionLock(redis, "upload-1", "token-1");
    expect(redis.zrem).toHaveBeenCalledWith("upload-slots:user-1", "upload-1");
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it("serializes provider asset creation for one user upload", async () => {
    const redis = { set: vi.fn(async () => "OK"), eval: vi.fn(async () => 1) } as unknown as Redis;
    const lock = await acquireAssetCreationLock(redis, "owner-1", "upload-1");
    expect(lock?.key).toBe("asset-create:owner-1:upload-1");
    expect(redis.set).toHaveBeenCalledWith(lock?.key, lock?.token, "EX", 120, "NX");
    await releaseAssetCreationLock(redis, lock!);
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, lock?.key, lock?.token);
  });
});
