import crypto from "node:crypto";
import type {
  CreationSnapshotBundle,
  CreationSnapshotReference,
  CreationSourceType,
  MediaObject,
  UserAsset,
} from "./db.js";
import { taskReferenceObjectKey } from "./tos.js";

const markerPattern = /\[\[firefly-(?:asset|ref):([^\]]+)\]\]/g;

export type CreationReferenceInput = {
  id?: string;
  bindingId?: string;
  uploadId?: string;
  assetId?: string;
  snapshotReferenceId?: string;
  name: string;
  type: "image" | "video" | "audio";
  role: CreationSnapshotReference["role"];
};

export type CreationSnapshotDependencies = {
  readUploadState(uploadId: string): MediaObject | null;
  readUserAsset(assetId: string): UserAsset | null;
  readSnapshotReference(id: string): CreationSnapshotReference | null;
};

export class UnresolvedPromptReferenceError extends Error {
  readonly code = "UNRESOLVED_PROMPT_REFERENCE";
  constructor(readonly bindingId: string) {
    super("提示词包含无法解析的素材引用，请重新选择素材");
    this.name = "UnresolvedPromptReferenceError";
  }
}

export const referenceBindingId = (reference: CreationReferenceInput) =>
  reference.bindingId?.trim() || reference.id?.trim() || crypto.randomUUID();

export const materializeCreationPrompt = (editorPrompt: string, references: { bindingId: string; mediaType: CreationReferenceInput["type"] }[]) => {
  const bindings = new Map(references.map((reference) => [reference.bindingId, reference]));
  if (bindings.size !== references.length) throw new Error("参考素材绑定标识重复");
  const ordinals = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const reference of references) {
    const ordinal = (ordinals.get(reference.mediaType) ?? 0) + 1;
    ordinals.set(reference.mediaType, ordinal);
    labels.set(reference.bindingId, `${reference.mediaType === "image" ? "Image" : reference.mediaType === "video" ? "Video" : "Audio"} ${ordinal}`);
  }
  const providerPrompt = editorPrompt.replace(markerPattern, (_marker, bindingId: string) => {
    if (!bindings.has(bindingId)) throw new UnresolvedPromptReferenceError(bindingId);
    return labels.get(bindingId)!;
  }).replace(/[ \t]{2,}/g, " ").trim();
  if (markerPattern.test(providerPrompt)) throw new Error("提示词引用解析失败");
  markerPattern.lastIndex = 0;
  return providerPrompt;
};

const resolveSource = (reference: CreationReferenceInput, ownerId: string, deps: CreationSnapshotDependencies) => {
  if (reference.snapshotReferenceId) {
    const source = deps.readSnapshotReference(reference.snapshotReferenceId);
    if (!source || source.ownerId !== ownerId || source.status !== "ready" || !source.objectKey) return null;
    return { objectKey: source.objectKey, contentType: source.contentType, size: source.size, etag: source.etag };
  }
  let uploadId = reference.uploadId;
  if (reference.assetId) {
    const asset = deps.readUserAsset(reference.assetId);
    if (!asset || asset.ownerId !== ownerId || asset.status !== "Active") return null;
    uploadId = asset.uploadId;
  }
  if (!uploadId) return null;
  const media = deps.readUploadState(uploadId);
  if (!media || media.ownerId !== ownerId || media.status !== "ready") return null;
  return { objectKey: media.objectKey, contentType: media.contentType, size: media.size, etag: media.etag };
};

export const buildCreationSnapshot = (input: {
  sourceType: CreationSourceType;
  sourceId: string;
  ownerId: string;
  sessionId?: string;
  editorPrompt: string;
  parameters: unknown;
  references: CreationReferenceInput[];
  recoveryQuality?: CreationSnapshotBundle["snapshot"]["recoveryQuality"];
  createdAt: number;
}, deps: CreationSnapshotDependencies): CreationSnapshotBundle => {
  const normalized = input.references.map((reference) => ({ ...reference, bindingId: referenceBindingId(reference) }));
  const providerPrompt = materializeCreationPrompt(input.editorPrompt, normalized.map((reference) => ({ bindingId: reference.bindingId, mediaType: reference.type })));
  const references: CreationSnapshotReference[] = normalized.map((reference, position) => {
    const source = resolveSource(reference, input.ownerId, deps);
    const id = crypto.createHash("sha256").update(`${input.ownerId}:${input.sourceType}:${input.sourceId}:${reference.bindingId}`).digest("hex");
    return {
      id, sourceType: input.sourceType, sourceId: input.sourceId, ownerId: input.ownerId,
      bindingId: reference.bindingId, position, mediaType: reference.type, role: reference.role,
      displayName: reference.name.slice(0, 180) || "参考素材", originalUploadId: reference.uploadId,
      originalAssetId: reference.assetId, sourceObjectKey: source?.objectKey,
      objectKey: source ? taskReferenceObjectKey(input.ownerId, input.sourceType, input.sourceId, reference.bindingId, reference.name) : undefined,
      contentType: source?.contentType ?? "", size: source?.size ?? 0, etag: source?.etag ?? "",
      status: source ? "promoting" : "unavailable", lastError: source ? undefined : "素材源文件不可用",
      createdAt: input.createdAt, updatedAt: input.createdAt,
    };
  });
  return {
    snapshot: {
      sourceType: input.sourceType, sourceId: input.sourceId, ownerId: input.ownerId, sessionId: input.sessionId,
      editorPrompt: input.editorPrompt, providerPrompt, parameters: input.parameters,
      bindingVersion: 1, recoveryQuality: input.recoveryQuality ?? "exact", createdAt: input.createdAt, updatedAt: input.createdAt,
    },
    references,
  };
};

export const containsInternalPromptMarker = (prompt: string) => {
  markerPattern.lastIndex = 0;
  const found = markerPattern.test(prompt);
  markerPattern.lastIndex = 0;
  return found;
};
