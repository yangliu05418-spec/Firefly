import type { CreationSnapshotBundle, ImageGenerationTask, StoredTask } from "./db.js";
import { buildCreationSnapshot, type CreationReferenceInput, type CreationSnapshotDependencies } from "./creation-snapshots.js";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const types = new Set<CreationReferenceInput["type"]>(["image", "video", "audio"]);
const roles = new Set<CreationReferenceInput["role"]>(["reference_image", "reference_video", "reference_audio", "first_frame", "last_frame"]);

const legacyVideoReferences = (request: Record<string, unknown>) => Array.isArray(request.assets)
  ? request.assets.flatMap((value, position): CreationReferenceInput[] => {
      const source = record(value);
      const type = text(source.type) as CreationReferenceInput["type"];
      const role = text(source.role) as CreationReferenceInput["role"];
      const uploadId = text(source.uploadId) || undefined;
      const assetId = text(source.assetId) || undefined;
      const snapshotReferenceId = text(source.snapshotReferenceId) || undefined;
      const bindingId = text(source.bindingId) || text(source.id) || assetId || uploadId || snapshotReferenceId || `legacy-${position + 1}`;
      if (!types.has(type) || !roles.has(role) || !(uploadId || assetId || snapshotReferenceId)) return [];
      return [{ id: bindingId, bindingId, uploadId, assetId, snapshotReferenceId, name: text(source.name) || `参考素材 ${position + 1}`, type, role }];
    })
  : [];

export const buildLegacyVideoSnapshot = (task: StoredTask, deps: CreationSnapshotDependencies): CreationSnapshotBundle => {
  if (!task.ownerId) throw new Error("共享历史任务缺少可归属用户");
  const request = record(task.request);
  return buildCreationSnapshot({
    sourceType: "video", sourceId: task.id, ownerId: task.ownerId, sessionId: task.sessionId,
    editorPrompt: text(request.editorPrompt) || text(request.prompt) || task.prompt,
    parameters: {
      model: text(request.model) || task.model, mode: text(request.mode) || task.mode,
      ratio: text(request.ratio) || task.ratio, resolution: text(request.resolution) || task.resolution,
      duration: typeof request.duration === "number" ? request.duration : task.duration,
      generateAudio: request.generateAudio, seed: request.seed, cameraFixed: request.cameraFixed, watermark: request.watermark,
    },
    references: legacyVideoReferences(request), recoveryQuality: "partial", createdAt: Date.now(),
  }, deps);
};

export const buildLegacyImageSnapshot = (task: ImageGenerationTask, deps: CreationSnapshotDependencies): CreationSnapshotBundle => buildCreationSnapshot({
  sourceType: "image", sourceId: task.id, ownerId: task.ownerId, sessionId: task.sessionId,
  editorPrompt: task.prompt,
  parameters: { model: task.model, ratio: task.ratio, resolution: task.resolution, count: task.requestedCount },
  references: task.referenceUploadIds.map((uploadId, index) => ({
    id: uploadId, bindingId: uploadId, uploadId, name: `参考图 ${index + 1}`, type: "image", role: "reference_image",
  })),
  recoveryQuality: task.referenceUploadIds.length ? "partial" : "unknown", createdAt: Date.now(),
}, deps);
