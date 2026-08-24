import type { ImageGenerationTask, MediaObject, StoredTask, UserAsset } from "./db.js";

type ReferenceRole = "reference_image" | "reference_video" | "reference_audio" | "first_frame" | "last_frame";
type ReferenceType = "image" | "video" | "audio";

type StoredReference = {
  id?: unknown;
  uploadId?: unknown;
  assetId?: unknown;
  name?: unknown;
  type?: unknown;
  role?: unknown;
};

export type ReeditAsset = {
  id: string;
  uploadId?: string;
  assetId?: string;
  name: string;
  type: ReferenceType;
  size: number;
  role: ReferenceRole;
  progress: 100;
  phase: "ready";
  preview?: string;
  status?: "Active";
};

export type GenerationReeditPayload = {
  sourceId: string;
  sourceType: "video" | "image";
  sessionId?: string;
  omittedAssets: number;
  state: {
    engine: "video" | "image";
    prompt: string;
    modelId: string;
    mode: "omni" | "first_frame" | "first_last" | "edit" | "extend" | "text";
    ratio: string;
    resolution: string;
    duration: number;
    generateAudio: boolean;
    cameraFixed: boolean;
    watermark: boolean;
    seed: number;
    imageModelId: string;
    imageRatio: string;
    imageResolution: string;
    imageCount: number;
    assets: ReeditAsset[];
  };
};

export type GenerationReeditDependencies = {
  readUploadState(uploadId: string): MediaObject | null;
  readUserAsset(assetId: string): UserAsset | null;
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

const mediaStillAvailable = (media: MediaObject | null, ownerId: string, deps: GenerationReeditDependencies) => {
  if (!media || media.ownerId !== ownerId || media.status !== "ready") return false;
  if (!media.objectKey.startsWith("inputs/")) return true;
  return deps.now() - media.createdAt < deps.inputRetentionDays * 24 * 60 * 60 * 1000;
};

const restoreReference = (
  source: StoredReference,
  ownerId: string,
  deps: GenerationReeditDependencies,
): ReeditAsset | null => {
  const type = types.has(source.type as ReferenceType) ? source.type as ReferenceType : null;
  const role = roles.has(source.role as ReferenceRole) ? source.role as ReferenceRole : null;
  if (!type || !role) return null;

  const assetId = text(source.assetId);
  if (assetId) {
    const asset = deps.readUserAsset(assetId);
    if (!asset || asset.ownerId !== ownerId || asset.status !== "Active" || !asset.uploadId) return null;
    const media = deps.readUploadState(asset.uploadId);
    if (!mediaStillAvailable(media, ownerId, deps)) return null;
    const actualType = asset.assetType.toLowerCase() as ReferenceType;
    return {
      id: asset.id,
      assetId: asset.id,
      uploadId: asset.uploadId,
      name: asset.name,
      type: actualType,
      size: media!.size,
      role,
      progress: 100,
      phase: "ready",
      status: "Active",
      preview: actualType === "image" ? `/api/assets/${encodeURIComponent(asset.id)}/source?variant=thumbnail` : undefined,
    };
  }

  const uploadId = text(source.uploadId);
  if (!uploadId) return null;
  const media = deps.readUploadState(uploadId);
  if (!mediaStillAvailable(media, ownerId, deps)) return null;
  return {
    id: text(source.id, uploadId),
    uploadId,
    name: media!.fileName || text(source.name, "参考素材"),
    type,
    size: media!.size,
    role,
    progress: 100,
    phase: "ready",
    preview: type === "image" ? `/api/uploads/${encodeURIComponent(uploadId)}/source?variant=thumbnail` : undefined,
  };
};

const restoreReferences = (sources: StoredReference[], ownerId: string, deps: GenerationReeditDependencies) => {
  const assets: ReeditAsset[] = [];
  let omittedAssets = 0;
  for (const source of sources) {
    const restored = restoreReference(source, ownerId, deps);
    if (restored) assets.push(restored);
    else omittedAssets += 1;
  }
  return { assets, omittedAssets };
};

export const buildVideoReeditPayload = (
  task: StoredTask,
  ownerId: string,
  deps: GenerationReeditDependencies,
): GenerationReeditPayload => {
  const request = record(task.request);
  const sources = Array.isArray(request.assets) ? request.assets.map((item) => record(item) as StoredReference) : [];
  const { assets, omittedAssets } = restoreReferences(sources, ownerId, deps);
  const requestedMode = text(request.mode, task.mode) as GenerationReeditPayload["state"]["mode"];
  return {
    sourceId: task.id,
    sourceType: "video",
    sessionId: task.sessionId,
    omittedAssets,
    state: {
      engine: "video",
      prompt: text(request.prompt, task.prompt),
      modelId: text(request.model, task.model),
      mode: modes.has(requestedMode) ? requestedMode : "omni",
      ratio: text(request.ratio, task.ratio),
      resolution: text(request.resolution, task.resolution),
      duration: integer(request.duration, task.duration),
      generateAudio: bool(request.generateAudio, true),
      cameraFixed: bool(request.cameraFixed, false),
      watermark: bool(request.watermark, false),
      seed: integer(request.seed, -1),
      imageModelId: "",
      imageRatio: "1:1",
      imageResolution: "",
      imageCount: 1,
      assets,
    },
  };
};

export const buildImageReeditPayload = (
  task: ImageGenerationTask,
  ownerId: string,
  defaultVideoModelId: string,
  deps: GenerationReeditDependencies,
): GenerationReeditPayload => {
  const references: StoredReference[] = task.referenceUploadIds.map((uploadId, index) => ({
    id: uploadId,
    uploadId,
    name: `参考图 ${index + 1}`,
    type: "image",
    role: "reference_image",
  }));
  const { assets, omittedAssets } = restoreReferences(references, ownerId, deps);
  return {
    sourceId: task.id,
    sourceType: "image",
    sessionId: task.sessionId,
    omittedAssets,
    state: {
      engine: "image",
      prompt: task.prompt,
      modelId: defaultVideoModelId,
      mode: "omni",
      ratio: "16:9",
      resolution: "720p",
      duration: 4,
      generateAudio: true,
      cameraFixed: false,
      watermark: false,
      seed: -1,
      imageModelId: task.model,
      imageRatio: task.ratio,
      imageResolution: task.resolution,
      imageCount: task.requestedCount,
      assets,
    },
  };
};
