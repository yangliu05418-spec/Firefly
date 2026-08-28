import { describe, expect, it } from "vitest";
import type { CreationSnapshot, CreationSnapshotReference, StoredTask } from "../server/db";
import { buildVideoReeditPayload } from "../server/generation-reedit";
import { areAttachedUploadsAdmissible } from "../src/upload-state";

const now = 2_000_000_000_000;
const ownerId = "owner-1";
const task: StoredTask = {
  id: "task-with-nine-references", sessionId: "session-1", ownerId, visibility: "private", status: "succeeded",
  prompt: "provider prompt", model: "dreamina-seedance-2-5-260628", mode: "omni", ratio: "16:9", resolution: "1080p", duration: 8,
  request: {}, createdAt: now - 60_000, updatedAt: now,
};
const snapshot: CreationSnapshot = {
  sourceType: "video", sourceId: task.id, ownerId, sessionId: task.sessionId,
  editorPrompt: "使用九个长期引用", providerPrompt: "provider prompt",
  parameters: { model: task.model, mode: task.mode, ratio: task.ratio, resolution: task.resolution, duration: task.duration },
  bindingVersion: 1, recoveryQuality: "exact", createdAt: task.createdAt, updatedAt: now,
};
const references: CreationSnapshotReference[] = Array.from({ length: 9 }, (_, position) => ({
  id: (position + 1).toString(16).padStart(64, "0"), sourceType: "video", sourceId: task.id, ownerId,
  bindingId: `binding-${position + 1}`, position, mediaType: "image", role: "reference_image",
  displayName: `参考图 ${position + 1}`, originalUploadId: `expired-upload-${position + 1}`,
  objectKey: `task-inputs/aa/${ownerId}/video/${task.id}/binding-${position + 1}/reference.png`,
  contentType: "image/png", size: 1024 + position, etag: `etag-${position + 1}`,
  status: "ready", createdAt: task.createdAt, updatedAt: now,
}));

describe("re-edit snapshot readiness contract", () => {
  it("admits the exact nine-reference payload without falling back to uploads", () => {
    const payload = buildVideoReeditPayload(task, ownerId, {
      readUploadState: () => null,
      readUserAsset: () => null,
      readSnapshot: () => snapshot,
      listSnapshotReferences: () => references,
      now: () => now,
      inputRetentionDays: 7,
    });

    expect(payload.recoveryQuality).toBe("exact");
    expect(payload.omittedAssets).toBe(0);
    expect(payload.state.assets).toHaveLength(9);
    expect(payload.state.assets.map((asset) => asset.snapshotReferenceId)).toEqual(references.map((reference) => reference.id));
    expect(payload.state.assets.every((asset) => asset.progress === 100 && asset.phase === "ready" && !asset.uploadId)).toBe(true);
    expect(areAttachedUploadsAdmissible(payload.state.assets)).toBe(true);
  });
});
