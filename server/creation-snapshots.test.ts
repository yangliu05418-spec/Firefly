import { describe, expect, it } from "vitest";
import type { CreationSnapshotReference, MediaObject, UserAsset } from "./db.js";
import {
  buildCreationSnapshot,
  containsInternalPromptMarker,
  materializeCreationPrompt,
  UnresolvedPromptReferenceError,
} from "./creation-snapshots.js";
import { taskReferenceObjectKey } from "./tos.js";

const now = 2_000_000_000_000;
const media = (uploadId: string, objectKey = `inputs/aa/owner-1/${uploadId}/reference.png`): MediaObject => ({
  id: `media-${uploadId}`, ownerId: "owner-1", uploadId, kind: "input", objectKey,
  status: "ready", fileName: "reference.png", contentType: "image/png", size: 123,
  etag: "source-etag", createdAt: now, updatedAt: now,
});
const asset = (uploadId: string): UserAsset => ({
  id: "asset-local-1", ownerId: "owner-1", groupId: "group-1", uploadId, name: "角色",
  assetType: "Image", status: "Active", category: "character", createdAt: now, updatedAt: now,
});
const priorReference = (id: string): CreationSnapshotReference => ({
  id, sourceType: "video", sourceId: "source-old", ownerId: "owner-1", bindingId: "old-binding",
  position: 0, mediaType: "image", role: "reference_image", displayName: "旧参考图",
  objectKey: "task-inputs/aa/owner-1/video/source-old/old-binding/reference.png", contentType: "image/png",
  size: 123, etag: "source-etag", status: "ready", createdAt: now, updatedAt: now,
});

describe("immutable creation snapshots", () => {
  it("materializes mixed media ordinals without leaking internal markers", () => {
    const prompt = "让 [[firefly-ref:image-a]] 看向 [[firefly-ref:video-a]]，再切到 [[firefly-ref:image-b]]";
    const providerPrompt = materializeCreationPrompt(prompt, [
      { bindingId: "image-a", mediaType: "image" },
      { bindingId: "video-a", mediaType: "video" },
      { bindingId: "image-b", mediaType: "image" },
    ]);
    expect(providerPrompt).toBe("让 Image 1 看向 Video 1，再切到 Image 2");
    expect(containsInternalPromptMarker(providerPrompt)).toBe(false);
  });

  it("rejects missing and duplicate bindings before provider submission", () => {
    expect(() => materializeCreationPrompt("使用 [[firefly-ref:missing]]", [])).toThrow(UnresolvedPromptReferenceError);
    expect(() => materializeCreationPrompt("", [
      { bindingId: "same", mediaType: "image" },
      { bindingId: "same", mediaType: "image" },
    ])).toThrow("绑定标识重复");
  });

  it("preserves submitted order and resolves uploads, assets, and prior snapshots to deterministic task keys", () => {
    const upload = media("upload-12345678901234567890");
    const libraryUpload = media("upload-asset-123456789012345", "assets/aa/owner-1/upload-asset/reference.png");
    const previous = priorReference("previous-reference-id");
    const bundle = buildCreationSnapshot({
      sourceType: "video", sourceId: "task-1", ownerId: "owner-1", sessionId: "session-1",
      editorPrompt: "[[firefly-ref:upload-binding]] / [[firefly-ref:asset-binding]] / [[firefly-ref:prior-binding]]",
      parameters: { model: "dreamina-seedance-2-5-260628" }, createdAt: now,
      references: [
        { id: "upload-binding", bindingId: "upload-binding", uploadId: upload.uploadId, name: "本地.png", type: "image", role: "reference_image" },
        { id: "asset-binding", bindingId: "asset-binding", assetId: "asset-local-1", name: "角色.png", type: "image", role: "reference_image" },
        { id: "prior-binding", bindingId: "prior-binding", snapshotReferenceId: previous.id, name: "旧素材.png", type: "image", role: "reference_image" },
      ],
    }, {
      readUploadState: (id) => id === upload.uploadId ? upload : id === libraryUpload.uploadId ? libraryUpload : null,
      readUserAsset: (id) => id === "asset-local-1" ? asset(libraryUpload.uploadId!) : null,
      readSnapshotReference: (id) => id === previous.id ? previous : null,
    });

    expect(bundle.snapshot).toMatchObject({ editorPrompt: expect.stringContaining("firefly-ref"), providerPrompt: "Image 1 / Image 2 / Image 3", recoveryQuality: "exact" });
    expect(bundle.references.map((reference) => reference.position)).toEqual([0, 1, 2]);
    expect(bundle.references.map((reference) => reference.sourceObjectKey)).toEqual([upload.objectKey, libraryUpload.objectKey, previous.objectKey]);
    expect(bundle.references.every((reference) => reference.objectKey?.startsWith("task-inputs/"))).toBe(true);
    const collidingPrefix = "x".repeat(150);
    expect(taskReferenceObjectKey("owner-1", "video", "task-1", `${collidingPrefix}a`, "same.png"))
      .not.toBe(taskReferenceObjectKey("owner-1", "video", "task-1", `${collidingPrefix}b`, "same.png"));
    expect(buildCreationSnapshot({
      sourceType: "video", sourceId: "task-1", ownerId: "owner-1", editorPrompt: "", parameters: {}, createdAt: now,
      references: [{ id: "upload-binding", bindingId: "upload-binding", uploadId: upload.uploadId, name: "本地.png", type: "image", role: "reference_image" }],
    }, { readUploadState: () => upload, readUserAsset: () => null, readSnapshotReference: () => null }).references[0].id).toBe(bundle.references[0].id);
  });
});
