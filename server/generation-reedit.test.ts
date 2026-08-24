import { describe, expect, it } from "vitest";
import type { CreationSnapshot, CreationSnapshotReference, ImageGenerationTask, MediaObject, StoredTask, UserAsset } from "./db.js";
import { buildImageReeditPayload, buildVideoReeditPayload, type GenerationReeditDependencies } from "./generation-reedit.js";

const now = 2_000_000_000_000;
const media = (patch: Partial<MediaObject> = {}): MediaObject => ({
  id: "media-1", ownerId: "owner-1", uploadId: "upload-12345678901234567890", kind: "input",
  objectKey: "inputs/aa/owner-1/upload-1/reference.png", status: "ready", fileName: "reference.png",
  contentType: "image/png", size: 1234, etag: "etag", createdAt: now - 60_000, updatedAt: now - 60_000,
  ...patch,
});
const userAsset = (patch: Partial<UserAsset> = {}): UserAsset => ({
  id: "asset-local-1", ownerId: "owner-1", groupId: "group-1", uploadId: "upload-asset-123456789012345",
  name: "角色参考", assetType: "Image", status: "Active", category: "character", createdAt: now - 60_000,
  updatedAt: now - 60_000, ...patch,
});
const dependencies = (uploads: Record<string, MediaObject | null>, assets: Record<string, UserAsset | null> = {}): GenerationReeditDependencies => ({
  readUploadState: (id) => uploads[id] ?? null,
  readUserAsset: (id) => assets[id] ?? null,
  now: () => now,
  inputRetentionDays: 7,
});
const videoTask = (patch: Partial<StoredTask> = {}): StoredTask => ({
  id: "task-1", sessionId: "session-1", ownerId: "owner-1", visibility: "private", status: "succeeded",
  prompt: "最终提示词", model: "dreamina-seedance-2-5-260628", mode: "omni", ratio: "16:9", resolution: "1080p", duration: 8,
  request: { prompt: "最终提示词", model: "dreamina-seedance-2-5-260628", mode: "omni", ratio: "16:9", resolution: "1080p", duration: 8, generateAudio: false, seed: 42, cameraFixed: true, watermark: true, assets: [] },
  createdAt: now - 120_000, updatedAt: now - 60_000, ...patch,
});

describe("generation re-edit payload", () => {
  it("restores exact video parameters and only durable owned references", () => {
    const task = videoTask({ request: {
      prompt: "Image 1 作为角色，Video 1 作为动作参考", model: "dreamina-seedance-2-5-260628", mode: "omni", ratio: "21:9", resolution: "1080p", duration: 11,
      generateAudio: false, seed: 42, cameraFixed: true, watermark: true,
      assets: [
        { id: "local-image", uploadId: "upload-12345678901234567890", name: "本地图片.png", type: "image", role: "reference_image" },
        { id: "asset-local-1", assetId: "asset-local-1", uploadId: "upload-asset-123456789012345", name: "旧名字", type: "image", role: "reference_image" },
      ],
    } });
    const result = buildVideoReeditPayload(task, "owner-1", dependencies({
      "upload-12345678901234567890": media(),
      "upload-asset-123456789012345": media({ id: "media-2", uploadId: "upload-asset-123456789012345", objectKey: "assets/aa/owner-1/asset-local-1/reference.png" }),
    }, { "asset-local-1": userAsset() }));

    expect(result).toMatchObject({
      sourceId: "task-1", sourceType: "video", sessionId: "session-1", omittedAssets: 0,
      state: { engine: "video", prompt: "Image 1 作为角色，Video 1 作为动作参考", modelId: "dreamina-seedance-2-5-260628", mode: "omni", ratio: "21:9", resolution: "1080p", duration: 11, generateAudio: false, seed: 42, cameraFixed: true, watermark: true },
    });
    expect(result.state.assets).toEqual([
      expect.objectContaining({ id: "local-image", uploadId: "upload-12345678901234567890", preview: "/api/uploads/upload-12345678901234567890/source?variant=thumbnail" }),
      expect.objectContaining({ id: "asset-local-1", assetId: "asset-local-1", name: "角色参考", preview: "/api/assets/asset-local-1/source?variant=thumbnail" }),
    ]);
    expect(JSON.stringify(result)).not.toContain("bytepluses.com.cn");
  });

  it("omits expired, missing, and cross-owner references instead of returning broken links", () => {
    const task = videoTask({ request: { prompt: "重试", model: "video-model", mode: "omni", ratio: "16:9", resolution: "720p", duration: 4, assets: [
      { id: "expired", uploadId: "upload-expired-1234567890", name: "expired.png", type: "image", role: "reference_image" },
      { id: "foreign", uploadId: "upload-foreign-1234567890", name: "foreign.png", type: "image", role: "reference_image" },
      { id: "missing", uploadId: "upload-missing-1234567890", name: "missing.png", type: "image", role: "reference_image" },
    ] } });
    const result = buildVideoReeditPayload(task, "owner-1", dependencies({
      "upload-expired-1234567890": media({ uploadId: "upload-expired-1234567890", createdAt: now - 8 * 24 * 60 * 60 * 1000 }),
      "upload-foreign-1234567890": media({ uploadId: "upload-foreign-1234567890", ownerId: "owner-2" }),
    }));
    expect(result.omittedAssets).toBe(3);
    expect(result.state.assets).toEqual([]);
  });

  it("restores persisted image references and image controls", () => {
    const task: ImageGenerationTask = {
      id: "image-task-1", sessionId: "session-2", ownerId: "owner-1", model: "google/gemini-3-pro-image", modelName: "Image Model",
      ratio: "16:9", resolution: "2048", prompt: "电影感雨夜", referenceUploadIds: ["upload-12345678901234567890"],
      requestedCount: 3, status: "succeeded", items: [], failures: [], createdAt: now - 10_000, updatedAt: now,
    };
    const result = buildImageReeditPayload(task, "owner-1", "default-video", dependencies({ "upload-12345678901234567890": media() }));
    expect(result).toMatchObject({
      sourceType: "image", sessionId: "session-2", omittedAssets: 0,
      state: { engine: "image", prompt: "电影感雨夜", imageModelId: "google/gemini-3-pro-image", imageRatio: "16:9", imageResolution: "2048", imageCount: 3 },
    });
    expect(result.state.assets[0]).toMatchObject({ uploadId: "upload-12345678901234567890", type: "image", role: "reference_image" });
    expect(result).toMatchObject({
      source: { id: "image-task-1", type: "image", sessionId: "session-2" },
      editorPrompt: "电影感雨夜",
      parameters: { model: "google/gemini-3-pro-image", ratio: "16:9", resolution: "2048", count: 3 },
    });
  });

  it("uses a ready immutable task reference even after the original input lifecycle", () => {
    const task = videoTask();
    const snapshot: CreationSnapshot = {
      sourceType: "video", sourceId: task.id, ownerId: "owner-1", sessionId: task.sessionId,
      editorPrompt: "让 [[firefly-ref:binding-1]] 走入雨中", providerPrompt: "让 Image 1 走入雨中",
      parameters: { model: task.model, mode: task.mode, ratio: task.ratio, resolution: task.resolution, duration: task.duration },
      bindingVersion: 1, recoveryQuality: "exact", createdAt: now - 8 * 24 * 60 * 60 * 1000, updatedAt: now,
    };
    const reference: CreationSnapshotReference = {
      id: "reference-ready", sourceType: "video", sourceId: task.id, ownerId: "owner-1", bindingId: "binding-1",
      position: 0, mediaType: "image", role: "reference_image", displayName: "角色.png",
      originalUploadId: "expired-upload", objectKey: "task-inputs/aa/owner-1/video/task-1/binding-1/reference.png",
      contentType: "image/png", size: 123, etag: "etag", status: "ready", createdAt: snapshot.createdAt, updatedAt: now,
    };
    const result = buildVideoReeditPayload(task, "owner-1", {
      ...dependencies({}), readSnapshot: () => snapshot, listSnapshotReferences: () => [reference],
    });
    expect(result).toMatchObject({ recoveryQuality: "exact", omittedAssets: 0, editorPrompt: snapshot.editorPrompt });
    expect(result.references).toEqual([expect.objectContaining({ bindingId: "binding-1", snapshotReferenceId: "reference-ready", preview: "/api/creation-references/reference-ready/source?variant=thumbnail" })]);
    expect(result.parameters).toMatchObject({ model: task.model, ratio: task.ratio });
  });

  it("uses the still-valid original while the immutable task reference is archiving", () => {
    const task = videoTask();
    const snapshot: CreationSnapshot = {
      sourceType: "video", sourceId: task.id, ownerId: "owner-1", sessionId: task.sessionId,
      editorPrompt: "让 [[firefly-ref:binding-1]] 走入雨中", providerPrompt: "让 Image 1 走入雨中",
      parameters: { model: task.model, mode: task.mode, ratio: task.ratio, resolution: task.resolution, duration: task.duration },
      bindingVersion: 1, recoveryQuality: "partial", createdAt: now - 60_000, updatedAt: now,
    };
    const reference: CreationSnapshotReference = {
      id: "reference-promoting", sourceType: "video", sourceId: task.id, ownerId: "owner-1", bindingId: "binding-1",
      position: 0, mediaType: "image", role: "reference_image", displayName: "角色.png",
      originalUploadId: "upload-12345678901234567890", sourceObjectKey: "inputs/a/reference.png",
      objectKey: "task-inputs/a/reference.png", contentType: "image/png", size: 1234, etag: "etag",
      status: "promoting", createdAt: snapshot.createdAt, updatedAt: now,
    };
    const result = buildVideoReeditPayload(task, "owner-1", {
      ...dependencies({ "upload-12345678901234567890": media() }),
      readSnapshot: () => snapshot, listSnapshotReferences: () => [reference],
    });
    expect(result.omittedAssets).toBe(0);
    expect(result.references).toEqual([expect.objectContaining({ bindingId: "binding-1", uploadId: "upload-12345678901234567890" })]);
    expect(result.warnings).toEqual([expect.objectContaining({ code: "REFERENCE_ARCHIVING_FALLBACK" })]);
  });
});
