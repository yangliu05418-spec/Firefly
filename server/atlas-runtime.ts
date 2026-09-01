import crypto from "node:crypto";
import type { RequestHandler } from "express";
import { config } from "./config.js";
import { resolveCanvasProjectMedia } from "./canvas-project-assets.js";
import { AtlasAgentSqliteStore } from "./atlas-agent-store.js";
import { registerAtlasGlobalExport } from "./atlas-global-assets.js";
import { OpenRouterAtlasAgentProvider } from "./atlas-agent-provider.js";
import { AtlasAgentService } from "./atlas-agent-service.js";
import { createAtlasAgentRouter, type AtlasAgentQueue } from "./atlas-agent-routes.js";
import { createAtlasRouter, type AtlasAssetPresentation, type AtlasImportSource, type AtlasStorageDependencies } from "./atlas-routes.js";
import { AtlasStore } from "./atlas-store.js";
import { users } from "./store.js";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  deleteObject,
  listAllUploadedParts,
  signUploadPart,
  signedObjectUrl,
  tos,
  verifyStoredObject,
} from "./tos.js";

const responseHeader = (headers: unknown, name: string) => {
  if (!headers || typeof headers !== "object") return "";
  const values = headers as Record<string, string | number | undefined>;
  return String(values[name] ?? values[name.toLowerCase()] ?? values[name.toUpperCase()] ?? "");
};

const mediaKind = (contentType: string): AtlasImportSource["kind"] | null => {
  const normalized = contentType.toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";
  return null;
};

const importSource = (input: { objectKey: string; fileName: string; contentType: string; size: number } & Partial<Pick<AtlasImportSource, "duration" | "width" | "height" | "hasAudio">>): AtlasImportSource | null => {
  const kind = mediaKind(input.contentType);
  return kind && input.size > 0 ? { ...input, kind } : null;
};

const generatedFileName = (prompt: string, id: string, extension: string) => {
  const title = Array.from(prompt.normalize("NFKC").replace(/\s+/g, " ").trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/[.\s-]+$/g, "")).slice(0, 40).join("");
  return `${title || "Firefly生成素材"}-${id.slice(0, 8)}.${extension}`;
};

const isLegacyGeneratedFileName = (fileName: string) => /^(?:preview|result|output)(?:[-_.]|$)/i.test(fileName.trim());

const videoDimensions = (ratio: string, resolution: string) => {
  const shortEdge = resolution === "1080p" ? 1080 : resolution === "720p" ? 720 : resolution === "480p" ? 480 : 0;
  const match = /^(\d+):(\d+)$/.exec(ratio);
  if (!shortEdge || !match) return {};
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!x || !y) return {};
  if (x >= y) return { width: Math.round(shortEdge * x / y), height: shortEdge };
  return { width: shortEdge, height: Math.round(shortEdge * y / x) };
};

export const resolveAtlasImportSource = async (input: {
  ownerId: string;
  sourceType: "user_asset" | "generation" | "generated" | "canvas_project";
  sourceId: string;
}): Promise<AtlasImportSource | null> => {
  if (input.sourceType === "user_asset") {
    const asset = users.readUserAsset(input.sourceId);
    const media = asset?.uploadId ? users.readUpload(asset.uploadId) : null;
    return asset?.ownerId === input.ownerId && media?.ownerId === input.ownerId && media.status === "ready" ? importSource(media) : null;
  }
  if (input.sourceType === "generation") {
    const task = users.readTask(input.sourceId);
    const media = users.readTaskMedia(input.sourceId, "preview") ?? users.readTaskMedia(input.sourceId, "output");
    if (task?.ownerId !== input.ownerId || media?.ownerId !== input.ownerId || media.status !== "ready") return null;
    const extension = media.contentType === "video/quicktime" ? "mov" : "mp4";
    const request = task.request && typeof task.request === "object" ? task.request as Record<string, unknown> : {};
    return importSource({
      ...media,
      fileName: generatedFileName(task.prompt, task.id, extension),
      duration: task.duration,
      ...videoDimensions(task.ratio, task.resolution),
      hasAudio: typeof request.generateAudio === "boolean" ? request.generateAudio : true,
    });
  }
  if (input.sourceType === "generated") {
    const media = users.readMedia(input.sourceId);
    if (media?.ownerId !== input.ownerId || media.status !== "ready" || media.kind !== "generated") return null;
    const task = media.taskId ? users.readImageGeneration(media.taskId) : null;
    const extension = media.contentType === "image/png" ? "png" : media.contentType === "image/webp" ? "webp" : "jpg";
    return importSource({ ...media, fileName: generatedFileName(task?.prompt ?? "Firefly生成图片", task?.id ?? media.id, extension) });
  }
  const asset = users.readCanvasProjectAsset(input.sourceId);
  if (!asset || asset.ownerId !== input.ownerId || asset.status !== "ready") return null;
  try { return importSource(resolveCanvasProjectMedia(asset)); }
  catch { return null; }
};

const describeAtlasAsset = (asset: import("./atlas-store.js").AtlasProjectAsset): AtlasAssetPresentation => {
  if (asset.sourceType === "generation" && asset.sourceId) {
    const task = users.readTask(asset.sourceId);
    const poster = users.readTaskMedia(asset.sourceId, "poster");
    const request = task?.request && typeof task.request === "object" ? task.request as Record<string, unknown> : {};
    return {
      displayName: task && isLegacyGeneratedFileName(asset.fileName)
        ? generatedFileName(task.prompt, task.id, asset.contentType === "video/quicktime" ? "mov" : "mp4")
        : undefined,
      thumbnailUrl: poster?.status === "ready" ? `/api/generations/${encodeURIComponent(asset.sourceId)}/poster` : undefined,
      duration: task?.duration,
      ...(task ? videoDimensions(task.ratio, task.resolution) : {}),
      hasAudio: typeof request.generateAudio === "boolean" ? request.generateAudio : true,
    };
  }
  if (asset.sourceType === "generated" && asset.sourceId) {
    const media = users.readMedia(asset.sourceId);
    const task = media?.taskId ? users.readImageGeneration(media.taskId) : null;
    const extension = asset.contentType === "image/png" ? "png" : asset.contentType === "image/webp" ? "webp" : "jpg";
    return {
      displayName: isLegacyGeneratedFileName(asset.fileName)
        ? generatedFileName(task?.prompt ?? "Firefly生成图片", task?.id ?? asset.sourceId, extension)
        : undefined,
      thumbnailUrl: `/api/image-media/${encodeURIComponent(asset.sourceId)}?variant=thumbnail`,
    };
  }
  if (asset.sourceType === "user_asset" && asset.sourceId && asset.kind === "image") {
    return { thumbnailUrl: `/api/assets/${encodeURIComponent(asset.sourceId)}/source?variant=thumbnail` };
  }
  return asset.kind === "image" && asset.status === "ready"
    ? { thumbnailUrl: `/api/atlas/project-assets/${encodeURIComponent(asset.id)}/media` }
    : {};
};

const verifyAtlasObject: AtlasStorageDependencies["verifyObject"] = async (objectKey) => {
  const response = await verifyStoredObject(objectKey);
  const data = response.data as unknown as Record<string, string | number | object | undefined>;
  const size = Number(data["content-length"] ?? responseHeader(response.headers, "content-length"));
  const contentType = String(data["content-type"] ?? responseHeader(response.headers, "content-type")).split(";", 1)[0]!.trim().toLowerCase();
  const etag = String(data.etag ?? responseHeader(response.headers, "etag")).replace(/^"|"$/g, "");
  if (!Number.isSafeInteger(size) || size <= 0 || !contentType || !etag) throw new Error("TOS 对象元数据校验失败");
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key.toLowerCase().startsWith("x-tos-meta-") && typeof value === "string") metadata[key.slice("x-tos-meta-".length).toLowerCase()] = value;
  }
  for (const [key, value] of Object.entries((response.headers ?? {}) as Record<string, unknown>)) {
    if (key.toLowerCase().startsWith("x-tos-meta-") && (typeof value === "string" || typeof value === "number")) metadata[key.slice("x-tos-meta-".length).toLowerCase()] = String(value);
  }
  for (const candidate of [data.meta, data.metadata]) {
    if (!candidate || typeof candidate !== "object") continue;
    for (const [key, value] of Object.entries(candidate as Record<string, unknown>)) {
      if (typeof value === "string" || typeof value === "number") metadata[key.toLowerCase()] = String(value);
    }
  }
  return { size, contentType, etag, metadata };
};

export const createAtlasStorage = (enqueueDelete: (objectKey: string) => Promise<void>): AtlasStorageDependencies => ({
  createMultipartUpload: ({ objectKey, contentType, fileName, metadata }) => createMultipartUpload(objectKey, contentType, fileName, metadata),
  signUploadPart: ({ objectKey, uploadId, partNumber }) => signUploadPart(objectKey, uploadId, partNumber),
  listParts: async ({ objectKey, uploadId }) => (await listAllUploadedParts(objectKey, uploadId)).map((part) => ({ partNumber: part.partNumber, etag: part.eTag })),
  completeMultipartUpload: async ({ objectKey, uploadId, parts }) => {
    await completeMultipartUpload(objectKey, uploadId, parts.map((part) => ({ partNumber: part.partNumber, eTag: part.etag.replace(/^"|"$/g, "") })));
  },
  abortMultipartUpload: async ({ objectKey, uploadId }) => { await abortMultipartUpload(objectKey, uploadId); },
  deleteObject: async (objectKey) => { await deleteObject(objectKey); },
  verifyObject: verifyAtlasObject,
  copyObject: async ({ sourceObjectKey, destinationObjectKey, contentType, fileName }) => {
    try {
      await tos.copyObject({
        bucket: config.tosBucket,
        key: destinationObjectKey,
        srcBucket: config.tosBucket,
        srcKey: sourceObjectKey,
        forbidOverwrite: true,
        metadataDirective: "REPLACE",
        contentType,
        contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        cacheControl: "private, max-age=31536000, immutable, no-transform",
      });
    } catch (error) {
      const status = Number((error as { statusCode?: number }).statusCode ?? 0);
      const code = String((error as { code?: string }).code ?? "");
      if (![409, 412].includes(status) && !/already|exist|overwrite|precondition/i.test(code)) throw error;
      await verifyStoredObject(destinationObjectKey, contentType);
    }
  },
  signedObjectUrl: (objectKey, options) => signedObjectUrl(objectKey, { download: options.attachment, fileName: options.fileName }),
  enqueueDelete,
});

export const createAtlasRuntime = (input: {
  requireAuth: RequestHandler;
  agentQueue: AtlasAgentQueue;
  enqueueMediaDelete: (objectKey: string, jobId: string) => Promise<void>;
}) => {
  const projectStore = new AtlasStore(config.databasePath);
  const agentStore = AtlasAgentSqliteStore.open(config.databasePath);
  const agentService = new AtlasAgentService({
    store: agentStore,
    provider: new OpenRouterAtlasAgentProvider({ model: config.atlasAgentModel, timeoutMs: config.atlasAgentRequestTimeoutMs }),
    executionAuthorizer: {
      hasActiveLease: ({ ownerId, projectId, leaseToken, now }) => projectStore.hasLease(
        projectId,
        ownerId,
        crypto.createHash("sha256").update(leaseToken).digest("hex"),
        now,
      ),
      resolveExportAsset: ({ ownerId, projectId, assetId }) => {
        const asset = projectStore.readAsset(assetId, ownerId);
        return asset?.projectId === projectId ? asset : null;
      },
    },
    maxToolCalls: config.atlasAgentMaxToolCalls,
    maxRounds: config.atlasAgentMaxRounds,
    phase: config.atlasAgentPhase === "off" ? "core" : config.atlasAgentPhase,
  });
  const storage = createAtlasStorage((objectKey) => input.enqueueMediaDelete(
    objectKey,
    `atlas-delete-${crypto.createHash("sha256").update(objectKey).digest("hex").slice(0, 32)}`,
  ));
  const projectRouter = createAtlasRouter({
    store: projectStore,
    requireAuth: input.requireAuth,
    storage,
    resolveImportSource: resolveAtlasImportSource,
    describeAsset: describeAtlasAsset,
    enabled: config.atlasEnabled,
    agentEnabled: config.atlasAgentEnabled && config.atlasAgentPhase !== "off",
    generateEnabled: config.atlasGenerateEnabled,
    maxUploadBytes: config.atlasMaxUploadBytes,
    registerGlobalAsset: registerAtlasGlobalExport,
  });
  const agentRouter = createAtlasAgentRouter({
    service: agentService,
    queue: input.agentQueue,
    requireAuth: input.requireAuth,
    enabled: config.atlasEnabled && config.atlasAgentEnabled && config.atlasAgentPhase !== "off",
  });
  return {
    projectStore,
    agentStore,
    projectRouter,
    agentRouter,
    close: () => { projectStore.close(); agentStore.close(); },
  };
};
