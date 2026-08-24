import type { CreationSession, CreationSnapshot, CreationSnapshotReference, ImageGenerationTask, MediaObject, StoredTask, UserAsset } from "./db.js";
import { MODELS } from "./capabilities.js";
import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS, IMAGE_RATIOS } from "./image-models.js";

type ReferenceRole = "reference_image" | "reference_video" | "reference_audio" | "first_frame" | "last_frame";
type ReferenceType = "image" | "video" | "audio";
type StoredReference = { id?: unknown; bindingId?: unknown; uploadId?: unknown; assetId?: unknown; name?: unknown; type?: unknown; role?: unknown };
export type ReeditWarning = { code: string; message: string; bindingId?: string; name?: string; type?: ReferenceType };
export type ReeditAdjustment = { field: string; requested: string | number; effective: string | number; reason: string };

export type ReeditAsset = {
  id: string; bindingId: string; uploadId?: string; assetId?: string; snapshotReferenceId?: string;
  name: string; type: ReferenceType; size: number; role: ReferenceRole; progress: 100; phase: "ready";
  preview?: string; status?: "Active"; expiresAt?: number;
};

export type GenerationReeditPayload = {
  source: { id: string; type: "video" | "image"; sessionId?: string };
  sourceId: string; sourceType: "video" | "image"; sessionId?: string; snapshotVersion: number;
  recoveryQuality: "exact" | "partial" | "unknown"; sourceSessionStatus: "active" | "deleted" | "missing";
  omittedAssets: number; warnings: ReeditWarning[]; adjustments: ReeditAdjustment[];
  editorPrompt: string;
  references: ReeditAsset[];
  parameters: Record<string, string | number | boolean>;
  state: {
    engine: "video" | "image"; prompt: string; modelId: string;
    mode: "omni" | "first_frame" | "first_last" | "edit" | "extend" | "text";
    ratio: string; resolution: string; duration: number; generateAudio: boolean; cameraFixed: boolean;
    watermark: boolean; seed: number; imageModelId: string; imageRatio: string; imageResolution: string;
    imageCount: number; assets: ReeditAsset[];
  };
};

type ReeditPayloadCore = Omit<GenerationReeditPayload, "source" | "editorPrompt" | "references" | "parameters">;
const withPublicContract = (payload: ReeditPayloadCore): GenerationReeditPayload => {
  const state = payload.state;
  let parameters: Record<string, string | number | boolean>;
  if (state.engine === "image") parameters = { model: state.imageModelId, ratio: state.imageRatio, resolution: state.imageResolution, count: state.imageCount };
  else parameters = { model: state.modelId, mode: state.mode, ratio: state.ratio, resolution: state.resolution, duration: state.duration, generateAudio: state.generateAudio, cameraFixed: state.cameraFixed, watermark: state.watermark, seed: state.seed };
  return { ...payload, source: { id: payload.sourceId, type: payload.sourceType, sessionId: payload.sessionId }, editorPrompt: state.prompt, references: state.assets, parameters };
};

export type GenerationReeditDependencies = {
  readUploadState(uploadId: string): MediaObject | null;
  readUserAsset(assetId: string): UserAsset | null;
  readSnapshot?(sourceType: "video" | "image", sourceId: string): CreationSnapshot | null;
  listSnapshotReferences?(sourceType: "video" | "image", sourceId: string): CreationSnapshotReference[];
  readSession?(sessionId: string, includeDeleted?: boolean): CreationSession | null;
  now(): number;
  inputRetentionDays: number;
};

const modes = new Set<GenerationReeditPayload["state"]["mode"]>(["omni", "first_frame", "first_last", "edit", "extend", "text"]);
const types = new Set<ReferenceType>(["image", "video", "audio"]);
const roles = new Set<ReferenceRole>(["reference_image", "reference_video", "reference_audio", "first_frame", "last_frame"]);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const bool = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;
const integer = (value: unknown, fallback: number) => typeof value === "number" && Number.isInteger(value) ? value : fallback;

const sessionStatus = (sessionId: string | undefined, deps: GenerationReeditDependencies) => {
  if (!sessionId || !deps.readSession) return "missing" as const;
  if (deps.readSession(sessionId)) return "active" as const;
  return deps.readSession(sessionId, true)?.deletedAt ? "deleted" as const : "missing" as const;
};

const mediaAvailable = (media: MediaObject | null, ownerId: string, deps: GenerationReeditDependencies) => Boolean(
  media && media.ownerId === ownerId && media.status === "ready"
  && (!media.objectKey.startsWith("inputs/") || deps.now() - media.createdAt < deps.inputRetentionDays * 86_400_000),
);

const restoreLegacyReference = (source: StoredReference, ownerId: string, deps: GenerationReeditDependencies): ReeditAsset | null => {
  const type = types.has(source.type as ReferenceType) ? source.type as ReferenceType : null;
  const role = roles.has(source.role as ReferenceRole) ? source.role as ReferenceRole : null;
  if (!type || !role) return null;
  const bindingId = text(source.bindingId, text(source.id, text(source.assetId, text(source.uploadId))));
  if (!bindingId) return null;
  const assetId = text(source.assetId);
  if (assetId) {
    const asset = deps.readUserAsset(assetId);
    if (!asset || asset.ownerId !== ownerId || asset.status !== "Active" || !asset.uploadId) return null;
    const media = deps.readUploadState(asset.uploadId);
    if (!mediaAvailable(media, ownerId, deps)) return null;
    const actualType = asset.assetType.toLowerCase() as ReferenceType;
    return { id: bindingId, bindingId, assetId, uploadId: asset.uploadId, name: asset.name, type: actualType, size: media!.size, role, progress: 100, phase: "ready", status: "Active", preview: actualType === "image" ? `/api/assets/${encodeURIComponent(assetId)}/source?variant=thumbnail` : undefined };
  }
  const uploadId = text(source.uploadId);
  if (!uploadId) return null;
  const media = deps.readUploadState(uploadId);
  if (!mediaAvailable(media, ownerId, deps)) return null;
  return { id: bindingId, bindingId, uploadId, name: media!.fileName || text(source.name, "参考素材"), type, size: media!.size, role, progress: 100, phase: "ready", preview: type === "image" ? `/api/uploads/${encodeURIComponent(uploadId)}/source?variant=thumbnail` : undefined, expiresAt: media!.objectKey.startsWith("inputs/") ? media!.createdAt + deps.inputRetentionDays * 86_400_000 : undefined };
};

const restoreSnapshotReferences = (references: CreationSnapshotReference[], ownerId: string, deps: GenerationReeditDependencies) => {
  const assets: ReeditAsset[] = [];
  const warnings: ReeditWarning[] = [];
  let omitted = 0;
  for (const reference of references) {
    if (reference.status === "ready" && reference.objectKey) {
      assets.push({ id: reference.bindingId, bindingId: reference.bindingId, snapshotReferenceId: reference.id, name: reference.displayName, type: reference.mediaType, size: reference.size, role: reference.role, progress: 100, phase: "ready", preview: reference.mediaType === "image" ? `/api/creation-references/${encodeURIComponent(reference.id)}/source?variant=thumbnail` : undefined });
    } else {
      const source = { id: reference.bindingId, bindingId: reference.bindingId, uploadId: reference.originalUploadId, assetId: reference.originalAssetId, name: reference.displayName, type: reference.mediaType, role: reference.role };
      let fallback = restoreLegacyReference(source, ownerId, deps);
      if (!fallback && reference.originalAssetId && reference.originalUploadId) fallback = restoreLegacyReference({ ...source, assetId: undefined }, ownerId, deps);
      if (fallback) {
        assets.push(fallback);
        warnings.push({ code: reference.status === "promoting" ? "REFERENCE_ARCHIVING_FALLBACK" : "REFERENCE_ORIGINAL_FALLBACK", message: reference.status === "promoting" ? `素材「${reference.displayName}」仍在长期归档，当前使用原素材` : `素材「${reference.displayName}」的长期副本暂不可用，当前使用原素材`, bindingId: reference.bindingId, name: reference.displayName, type: reference.mediaType });
      } else {
        omitted++;
        warnings.push({ code: reference.status === "promoting" ? "REFERENCE_ARCHIVING" : "REFERENCE_UNAVAILABLE", message: reference.status === "promoting" ? `素材「${reference.displayName}」仍在长期归档且原素材已失效` : `素材「${reference.displayName}」无法恢复`, bindingId: reference.bindingId, name: reference.displayName, type: reference.mediaType });
      }
    }
  }
  return { assets, warnings, omitted };
};

const normalizeVideo = (parameters: Record<string, unknown>) => {
  const adjustments: ReeditAdjustment[] = [];
  const requestedModel = text(parameters.model);
  const model = MODELS.find((item) => item.id === requestedModel) ?? MODELS[0];
  if (!model) throw new Error("当前没有可用的视频模型");
  if (requestedModel && requestedModel !== model.id) adjustments.push({ field: "modelId", requested: requestedModel, effective: model.id, reason: "原模型已下线，已切换到默认模型" });
  const requestedMode = text(parameters.mode, "omni") as GenerationReeditPayload["state"]["mode"];
  const mode = modes.has(requestedMode) && model.modes.includes(requestedMode) ? requestedMode : model.modes[0];
  if (requestedMode !== mode) adjustments.push({ field: "mode", requested: requestedMode, effective: mode, reason: "原生成模式不再受当前模型支持" });
  const choose = (field: "ratio" | "resolution", requested: string, values: string[], preferred: string) => {
    const effective = values.includes(requested) ? requested : values.includes(preferred) ? preferred : values[0];
    if (requested !== effective) adjustments.push({ field, requested, effective, reason: `原${field === "ratio" ? "画幅" : "清晰度"}不再受支持` });
    return effective;
  };
  const ratio = choose("ratio", text(parameters.ratio, "16:9"), model.ratios, "16:9");
  const resolution = choose("resolution", text(parameters.resolution, "720p"), model.resolutions, "720p");
  const requestedDuration = integer(parameters.duration, model.duration[0]);
  const duration = Math.min(model.duration[1], Math.max(model.duration[0], requestedDuration));
  if (requestedDuration !== duration) adjustments.push({ field: "duration", requested: requestedDuration, effective: duration, reason: "原时长超出当前模型范围" });
  return { model, mode, ratio, resolution, duration, adjustments };
};

const normalizeImage = (parameters: Record<string, unknown>) => {
  const adjustments: ReeditAdjustment[] = [];
  const requestedModel = text(parameters.model);
  const model = IMAGE_MODELS.find((item) => item.id === requestedModel) ?? IMAGE_MODELS.find((item) => item.id === DEFAULT_IMAGE_MODEL) ?? IMAGE_MODELS[0];
  if (!model) throw new Error("当前没有可用的图片模型");
  if (requestedModel && requestedModel !== model.id) adjustments.push({ field: "imageModelId", requested: requestedModel, effective: model.id, reason: "原图片模型已下线，已切换到默认模型" });
  const requestedRatio = text(parameters.ratio, "1:1");
  const ratio = IMAGE_RATIOS.includes(requestedRatio as typeof IMAGE_RATIOS[number]) ? requestedRatio : "1:1";
  if (requestedRatio !== ratio) adjustments.push({ field: "imageRatio", requested: requestedRatio, effective: ratio, reason: "原图片比例不再受支持" });
  const requestedResolution = text(parameters.resolution, model.defaultResolution);
  const resolution = model.resolutions.includes(requestedResolution) ? requestedResolution : model.defaultResolution;
  if (requestedResolution !== resolution) adjustments.push({ field: "imageResolution", requested: requestedResolution, effective: resolution, reason: "原分辨率不再受当前模型支持" });
  const requestedCount = integer(parameters.count, 1);
  const count = Math.min(model.maxCount, Math.max(1, requestedCount));
  if (requestedCount !== count) adjustments.push({ field: "imageCount", requested: requestedCount, effective: count, reason: "原生成数量超出当前模型范围" });
  return { model, ratio, resolution, count, adjustments };
};

const fromSnapshot = (snapshot: CreationSnapshot, deps: GenerationReeditDependencies): GenerationReeditPayload => {
  const parameters = record(snapshot.parameters);
  const restored = restoreSnapshotReferences(deps.listSnapshotReferences?.(snapshot.sourceType, snapshot.sourceId) ?? [], snapshot.ownerId, deps);
  if (snapshot.sourceType === "video") {
    const normalized = normalizeVideo(parameters);
    return withPublicContract({ sourceId: snapshot.sourceId, sourceType: "video", sessionId: snapshot.sessionId, snapshotVersion: snapshot.bindingVersion, recoveryQuality: snapshot.recoveryQuality, sourceSessionStatus: sessionStatus(snapshot.sessionId, deps), omittedAssets: restored.omitted, warnings: restored.warnings, adjustments: normalized.adjustments, state: { engine: "video", prompt: snapshot.editorPrompt, modelId: normalized.model.id, mode: normalized.mode, ratio: normalized.ratio, resolution: normalized.resolution, duration: normalized.duration, generateAudio: bool(parameters.generateAudio, true) && normalized.model.supportsAudio, cameraFixed: bool(parameters.cameraFixed, false), watermark: bool(parameters.watermark, false), seed: integer(parameters.seed, -1), imageModelId: "", imageRatio: "1:1", imageResolution: "", imageCount: 1, assets: restored.assets } });
  }
  const normalized = normalizeImage(parameters);
  return withPublicContract({ sourceId: snapshot.sourceId, sourceType: "image", sessionId: snapshot.sessionId, snapshotVersion: snapshot.bindingVersion, recoveryQuality: snapshot.recoveryQuality, sourceSessionStatus: sessionStatus(snapshot.sessionId, deps), omittedAssets: restored.omitted, warnings: restored.warnings, adjustments: normalized.adjustments, state: { engine: "image", prompt: snapshot.editorPrompt, modelId: MODELS[0]?.id ?? "", mode: "omni", ratio: "16:9", resolution: "720p", duration: 4, generateAudio: true, cameraFixed: false, watermark: false, seed: -1, imageModelId: normalized.model.id, imageRatio: normalized.ratio, imageResolution: normalized.resolution, imageCount: normalized.count, assets: restored.assets } });
};

export const buildVideoReeditPayload = (task: StoredTask, ownerId: string, deps: GenerationReeditDependencies): GenerationReeditPayload => {
  const snapshot = deps.readSnapshot?.("video", task.id);
  if (snapshot?.ownerId === ownerId) return fromSnapshot(snapshot, deps);
  const request = record(task.request);
  const sources = Array.isArray(request.assets) ? request.assets.map((item) => record(item) as StoredReference) : [];
  const assets = sources.flatMap((source) => restoreLegacyReference(source, ownerId, deps) ?? []);
  const omittedAssets = sources.length - assets.length;
  const normalized = normalizeVideo({ ...request, model: text(request.model, task.model), mode: text(request.mode, task.mode), ratio: text(request.ratio, task.ratio), resolution: text(request.resolution, task.resolution), duration: integer(request.duration, task.duration) });
  return withPublicContract({ sourceId: task.id, sourceType: "video", sessionId: task.sessionId, snapshotVersion: 0, recoveryQuality: "partial", sourceSessionStatus: sessionStatus(task.sessionId, deps), omittedAssets, warnings: omittedAssets ? [{ code: "LEGACY_REFERENCE_MISSING", message: `${omittedAssets} 个历史素材无法恢复` }] : [{ code: "LEGACY_SNAPSHOT_PARTIAL", message: "该历史任务创建于精确快照启用前" }], adjustments: normalized.adjustments, state: { engine: "video", prompt: text(request.editorPrompt, text(request.prompt, task.prompt)), modelId: normalized.model.id, mode: normalized.mode, ratio: normalized.ratio, resolution: normalized.resolution, duration: normalized.duration, generateAudio: bool(request.generateAudio, true), cameraFixed: bool(request.cameraFixed, false), watermark: bool(request.watermark, false), seed: integer(request.seed, -1), imageModelId: "", imageRatio: "1:1", imageResolution: "", imageCount: 1, assets } });
};

export const buildImageReeditPayload = (task: ImageGenerationTask, ownerId: string, _defaultVideoModelId: string, deps: GenerationReeditDependencies): GenerationReeditPayload => {
  const snapshot = deps.readSnapshot?.("image", task.id);
  if (snapshot?.ownerId === ownerId) return fromSnapshot(snapshot, deps);
  const sources: StoredReference[] = task.referenceUploadIds.map((uploadId, index) => ({ id: uploadId, bindingId: uploadId, uploadId, name: `参考图 ${index + 1}`, type: "image", role: "reference_image" }));
  const assets = sources.flatMap((source) => restoreLegacyReference(source, ownerId, deps) ?? []);
  const omittedAssets = sources.length - assets.length;
  const normalized = normalizeImage({ model: task.model, ratio: task.ratio, resolution: task.resolution, count: task.requestedCount });
  const unknown = task.referenceUploadIds.length === 0;
  return withPublicContract({ sourceId: task.id, sourceType: "image", sessionId: task.sessionId, snapshotVersion: 0, recoveryQuality: unknown ? "unknown" : "partial", sourceSessionStatus: sessionStatus(task.sessionId, deps), omittedAssets, warnings: [{ code: unknown ? "LEGACY_BINDINGS_UNKNOWN" : "LEGACY_SNAPSHOT_PARTIAL", message: unknown ? "该历史图片任务无法确认是否曾使用参考图" : "该历史任务创建于精确快照启用前" }], adjustments: normalized.adjustments, state: { engine: "image", prompt: task.prompt, modelId: MODELS[0]?.id ?? "", mode: "omni", ratio: "16:9", resolution: "720p", duration: 4, generateAudio: true, cameraFixed: false, watermark: false, seed: -1, imageModelId: normalized.model.id, imageRatio: normalized.ratio, imageResolution: normalized.resolution, imageCount: normalized.count, assets } });
};
