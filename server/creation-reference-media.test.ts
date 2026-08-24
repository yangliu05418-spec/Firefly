import { describe, expect, it } from "vitest";
import { resolveCreationSnapshotReferences } from "./creation-reference-media.js";
import type { GenerationInput } from "./provider.js";

const input = (): GenerationInput => ({
  prompt: "Image 1", editorPrompt: "[[firefly-ref:binding-1]]", model: "dreamina-seedance-2-5-260628",
  mode: "omni", ratio: "16:9", resolution: "720p", duration: 5, generateAudio: true,
  seed: -1, cameraFixed: false, watermark: false, outputFormat: "mp4",
  assets: [{ id: "binding-1", bindingId: "binding-1", snapshotReferenceId: "a".repeat(64), name: "角色.png", type: "image", role: "reference_image" }],
});

describe("creation snapshot reference resolution", () => {
  it("adds a fresh TOS URL while retaining the stable id for Seedance asset registration", () => {
    const result = resolveCreationSnapshotReferences(input(), "owner-1", {
      readReference: () => ({
        id: "a".repeat(64), sourceType: "video", sourceId: "source-1", ownerId: "owner-1", bindingId: "binding-1",
        position: 0, mediaType: "image", role: "reference_image", displayName: "角色.png",
        objectKey: "task-inputs/a/reference.png", contentType: "image/png", size: 10, etag: "etag",
        status: "ready", createdAt: 1, updatedAt: 1,
      }),
      signObject: (key) => `https://tos.example/${key}`,
    });
    expect(result.assets[0]).toMatchObject({ snapshotReferenceId: "a".repeat(64), url: "https://tos.example/task-inputs/a/reference.png" });
  });

  it("rejects cross-user and non-ready references", () => {
    expect(() => resolveCreationSnapshotReferences(input(), "owner-1", {
      readReference: () => ({
        id: "a".repeat(64), sourceType: "video", sourceId: "source-1", ownerId: "owner-2", bindingId: "binding-1",
        position: 0, mediaType: "image", role: "reference_image", displayName: "角色.png",
        objectKey: "task-inputs/a/reference.png", contentType: "image/png", size: 10, etag: "etag",
        status: "ready", createdAt: 1, updatedAt: 1,
      }),
      signObject: () => "https://tos.example/reference",
    })).toThrow("不存在或尚未归档完成");
  });
});
