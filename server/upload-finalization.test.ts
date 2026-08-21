import { describe, expect, it, vi } from "vitest";
import type { MediaObject } from "./db.js";
import { finalizeQueuedUpload, type UploadFinalizationDependencies } from "./upload-finalization.js";

const pending = (patch: Partial<MediaObject> = {}): MediaObject => ({
  id: "input:upload-1", ownerId: "owner-1", uploadId: "upload-1", kind: "input",
  objectKey: "inputs/a/upload-1/image.png", status: "uploading", fileName: "image.png",
  contentType: "image/png", size: 10, etag: "etag", createdAt: 1, updatedAt: 1, ...patch
});

const setup = (media: MediaObject | null = pending()) => {
  const deps: UploadFinalizationDependencies = {
    readMedia: vi.fn(() => media),
    markReady: vi.fn(),
    markDeleted: vi.fn(),
    inspect: vi.fn(async () => ({ ImageWidth: { value: "1024" }, ImageHeight: { value: "768" } })) as never,
    validate: vi.fn(async () => undefined),
    signedUrl: vi.fn(() => "https://tos.example/audio.mp3") as never,
    deleteObject: vi.fn(async () => undefined)
  };
  return deps;
};

describe("asynchronous upload finalization", () => {
  it("marks an image ready only after authoritative TOS metadata passes", async () => {
    const deps = setup();
    await expect(finalizeQueuedUpload("upload-1", deps)).resolves.toEqual({ status: "ready" });
    expect(deps.inspect).toHaveBeenCalledWith("inputs/a/upload-1/image.png", "image");
    expect(deps.markReady).toHaveBeenCalledWith("input:upload-1");
    expect(deps.deleteObject).not.toHaveBeenCalled();
  });

  it("deletes and tombstones a deterministic media violation", async () => {
    const deps = setup();
    deps.inspect = vi.fn(async () => ({ ImageWidth: { value: "120" }, ImageHeight: { value: "120" } })) as never;
    await expect(finalizeQueuedUpload("upload-1", deps)).resolves.toMatchObject({ status: "failed", error: expect.stringContaining("300") });
    expect(deps.deleteObject).toHaveBeenCalledTimes(1);
    expect(deps.markDeleted).toHaveBeenCalledWith("input:upload-1");
    expect(deps.markReady).not.toHaveBeenCalled();
  });

  it("treats an already absent rejected object as deleted", async () => {
    const deps = setup();
    deps.inspect = vi.fn(async () => ({ ImageWidth: { value: "120" }, ImageHeight: { value: "120" } })) as never;
    deps.deleteObject = vi.fn(async () => { throw Object.assign(new Error("missing"), { statusCode: 404 }); });
    await expect(finalizeQueuedUpload("upload-1", deps)).resolves.toMatchObject({ status: "failed" });
    expect(deps.markDeleted).toHaveBeenCalledWith("input:upload-1");
  });

  it("throws transient TOS failures so BullMQ can retry", async () => {
    const deps = setup();
    deps.inspect = vi.fn(async () => { throw new Error("TOS temporarily unavailable"); }) as never;
    await expect(finalizeQueuedUpload("upload-1", deps)).rejects.toThrow("temporarily unavailable");
    expect(deps.markReady).not.toHaveBeenCalled();
    expect(deps.markDeleted).not.toHaveBeenCalled();
  });

  it("uses the bounded ffprobe path only for audio", async () => {
    const deps = setup(pending({ contentType: "audio/mpeg", fileName: "voice.mp3" }));
    await finalizeQueuedUpload("upload-1", deps);
    expect(deps.validate).toHaveBeenCalledWith("https://tos.example/audio.mp3", "audio");
    expect(deps.inspect).not.toHaveBeenCalled();
  });

  it("is idempotent for missing or already finalized rows", async () => {
    const deps = setup(pending({ status: "ready" }));
    await expect(finalizeQueuedUpload("upload-1", deps)).resolves.toEqual({ status: "noop" });
    expect(deps.inspect).not.toHaveBeenCalled();
  });
});
