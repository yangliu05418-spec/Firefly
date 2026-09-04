import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import { z } from "zod";
import { config } from "./config.js";
import { MODELS, availableModels } from "./capabilities.js";
import { clearSession, createSession, getSessionUser, publicUser, requireAuth, type SessionUser } from "./auth.js";
import type { AssetCategory, CanvasJob, CanvasProject, CanvasProjectAsset, CreationSession, CreationSnapshotBundle, ImageGenerationTask, UploadSession, UserAsset } from "./db.js";
import { users } from "./store.js";
import { canvasDocumentSchema, DEFAULT_CANVAS_DOCUMENT, DEFAULT_CANVAS_DOCUMENT_V1, parseCanvasDocumentSafe, toCanvasDocumentV2 } from "./canvas-document.js";
import { resolveCanvasContext } from "./canvas-context.js";
import { publicCanvasProject, publicCanvasProjectDetail } from "./canvas-public.js";
import { consumeFeishuAuthorization, createFeishuAuthorization, exchangeFeishuCode } from "./feishu.js";
import { archiveQueue, assetQueue, atlasAgentQueue, canvasQueue, generationQueue, imageGenerationQueue, mediaQueue, migrateLegacyTasks, previewQueue, queueConnection, readTask, redis, type StoredTask, uploadFinalizationQueue } from "./redis.js";
import { canAccessTask } from "./task-access.js";
import { publicTask } from "./task-public.js";
import { validateGeneration } from "./provider.js";
import { callAssetApi } from "./asset-api.js";
import { ensureAutoReferenceGroup } from "./asset-registration.js";
import { previewRedirectCacheControl } from "./media-cache.js";
import { stablePreviewUrl } from "./preview-url-cache.js";
import { abortMultipartUpload, canvasExportObjectKey, completeMultipartUpload, createMultipartUpload, deleteObject, headObject, inputObjectKey, inspectMediaObject, signUploadPart, signedObjectUrl, tosConfigured, tosEnabled, tosHealth, verifyStoredObject } from "./tos.js";
import { DependencyHealthGate } from "./dependency-health.js";
import { canonicalUploadContentType, uploadKindFromContentType } from "./upload-policy.js";
import { acquireUploadCompletionLock, claimUploadSlot, releaseUploadCompletionLock, releaseUploadSlot, renewUploadSlot, UPLOAD_SESSION_TTL_SECONDS } from "./upload-slots.js";
import { canCreatePendingAsset } from "./asset-upload-admission.js";
import { createCanvasAssetFromUpload, isAdmissibleCanvasUpload, prepareCanvasAssetFromUpload } from "./canvas-assets.js";
import { createCanvasMediaHandler } from "./canvas-media-route.js";
import { createServiceWorkerHandler } from "./static-web.js";
import { scheduleBestEffort, scheduleTaskCleanup } from "./cleanup-handoff.js";
import { resolveUploadMediaUrl } from "./media-url.js";
import { publicUserAsset } from "./user-asset-public.js";
import { IMAGE_MODELS, IMAGE_RATIOS, imageModelById, DEFAULT_IMAGE_MODEL } from "./image-models.js";
import { openRouterPool } from "./openrouter.js";
import { publicImageGeneration } from "./image-generation-public.js";
import { providerAssetName } from "./asset-name.js";
import { acquireCanvasLease, releaseCanvasLease, renewCanvasLease, validateCanvasLease } from "./canvas-lease.js";
import { canvasProjectAssetSignedUrl, createCanvasProjectMediaHandler, publicCanvasProjectAsset } from "./canvas-project-assets.js";
import { readWorkerHealth, type WorkerHealthSnapshot } from "./worker-heartbeat.js";
import { canvasGeneratedMediaId } from "./canvas-job-media.js";
import { MediaValidationError, validateMedia } from "./media-validation.js";
import { withinDeadline } from "./deadline.js";
import { startAsyncJobControlPlane } from "./async-job-control-plane.js";
import { buildImageReeditPayload, buildVideoReeditPayload } from "./generation-reedit.js";
import { runReeditIntegrityCheck } from "./reedit-integrity.js";
import { buildCreationSnapshot, type CreationReferenceInput } from "./creation-snapshots.js";
import { buildLegacyImageSnapshot, buildLegacyVideoSnapshot } from "./legacy-creation-snapshot.js";
import { assertPromptLength, EDITOR_PROMPT_STORAGE_MAX_CHARS, IMAGE_PROVIDER_PROMPT_MAX_CHARS, PromptTooLongError } from "./prompt-policy.js";
import { journeyNames, recordJourneyEvent } from "./journey-observability.js";
import { createAtlasRuntime } from "./atlas-runtime.js";
import { publicLocalMedia, publicLocalMediaFromSource } from "./local-media-public.js";

let atlasRuntime: ReturnType<typeof createAtlasRuntime>;

const app = express();
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist-web");
const atlasDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist-atlas");
const verifyAtlasStaticBundle = async () => {
  const index = await fs.readFile(path.join(atlasDir, "index.html"), "utf8");
  const referencedAssets = [...index.matchAll(/\/studio\/atlas\/assets\/([A-Za-z0-9._-]+)/g)].map((match) => match[1]!);
  if (!referencedAssets.length) throw new Error("Atlas index has no immutable assets");
  await Promise.all(referencedAssets.map((asset) => fs.access(path.join(atlasDir, "assets", asset))));
  const assets = await fs.readdir(path.join(atlasDir, "assets"));
  const requiredRuntimeAssets = [
    ["Firefly editor", /^FireflyEmbeddedEditor-[A-Za-z0-9._-]+\.js$/],
    ["project lifecycle", /^projectLifecycle-[A-Za-z0-9._-]+\.js$/],
    ["timeline worker", /^timelineClipCanvas\.worker-[A-Za-z0-9._-]+\.js$/],
    ["export panel", /^ExportPanel-[A-Za-z0-9._-]+\.js$/],
  ] as const;
  for (const [name, pattern] of requiredRuntimeAssets) {
    if (!assets.some((asset) => pattern.test(asset))) {
      throw new Error(`Atlas ${name} is unavailable`);
    }
  }
};
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.locals.redis = redis;
app.use(cookieParser());
app.use(express.json({ limit: "4mb" })); // 4mb: canvas documents (whole-project PUT) can exceed 1mb
const applicationOrigin = new URL(config.origin).origin;
const previewRedirectCacheHeader = previewRedirectCacheControl(config.tosPreviewTtlSeconds);
app.use((req, res, next) => {
  const requestId = crypto.randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  const atlasDocument = req.path === "/studio/atlas" || req.path.startsWith("/studio/atlas/");
  const atlasGenerateEmbed = req.path === "/studio/generate-embed" || req.path.startsWith("/studio/generate-embed/");
  res.setHeader("Content-Security-Policy", atlasDocument
    ? "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https://*.bytepluses.com.cn"
    : atlasGenerateEmbed
      ? "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https://*.bytepluses.com.cn"
      : "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https://*.bytepluses.com.cn");
  if (atlasDocument || atlasGenerateEmbed) {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    res.setHeader("Origin-Agent-Cluster", "?1");
  }
  if (config.origin.startsWith("https://")) res.setHeader("Strict-Transport-Security", "max-age=31536000");
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  if (req.path.startsWith("/api/") && ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) && req.header("origin") !== applicationOrigin) return res.status(403).json({ error: "请求来源无效" });
  next();
});

const respondError = (res: express.Response, error: unknown, status = 400) => {
  const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "请求失败";
  const code = (error as { code?: string }).code;
  const effectiveStatus = error instanceof z.ZodError ? 400 : status;
  const event = {
    type: "api_request_failed", level: effectiveStatus >= 500 ? "error" : effectiveStatus === 409 || effectiveStatus === 429 ? "warn" : "info",
    at: new Date().toISOString(), requestId: res.locals.requestId,
    method: res.req.method, path: res.req.route?.path ?? res.req.path,
    status: effectiveStatus, code: code ?? (error instanceof z.ZodError ? "REQUEST_SCHEMA_INVALID" : "REQUEST_FAILED"),
    userId: (res.locals.user as SessionUser | undefined)?.id,
    errorType: error instanceof Error ? error.name : typeof error,
    ...(error instanceof z.ZodError ? { issues: error.issues.slice(0, 8).map((issue) => ({ code: issue.code, path: issue.path.join(".") })) } : {}),
  };
  if (effectiveStatus >= 500) console.error(JSON.stringify(event));
  else if (effectiveStatus === 409 || effectiveStatus === 429) console.warn(JSON.stringify(event));
  else console.info(JSON.stringify(event));
  res.status(effectiveStatus).json({
    error: message,
    ...(code ? { code } : {}),
    ...(error instanceof PromptTooLongError ? { details: { field: error.field, actual: error.actual, limit: error.limit } } : {}),
    requestId: res.locals.requestId,
  });
};
type GenerationRejectContext = { model?: string; mode?: string; assetCount?: number; activeCount?: number; limit?: number; causeCode?: string; errorType?: string; issues?: { code: string; path: string }[] };
const rejectGeneration = (res: express.Response, status: number, code: string, error: string, context: GenerationRejectContext = {}) => {
  const event = {
    type: "generation_rejected", level: status === 409 || status === 429 ? "warn" : status >= 500 ? "error" : "info",
    at: new Date().toISOString(), requestId: res.locals.requestId,
    userId: (res.locals.user as SessionUser | undefined)?.id,
    status, code, ...context,
  };
  if (status >= 500) console.error(JSON.stringify(event));
  else if (status === 409 || status === 429) console.warn(JSON.stringify(event));
  else console.info(JSON.stringify(event));
  return res.status(status).json({ error, code, requestId: res.locals.requestId });
};
const param = (value: string | string[]) => Array.isArray(value) ? value[0] : value;
const publicGenerationTask = (task: StoredTask) => {
  const previewMedia = users.readTaskMedia(task.id, "preview");
  const posterMedia = users.readTaskMedia(task.id, "poster");
  const outputMedia = users.readTaskMedia(task.id, "output");
  const effectivePreview = config.tosPreviewTranscodeEnabled ? previewMedia : previewMedia ?? outputMedia;
  const stablePreviewReady = tosEnabled() && config.tosPreviewTranscodeEnabled && Boolean(previewMedia);
  const stablePosterReady = tosEnabled() && Boolean(posterMedia);
  const stableOutputReady = task.status !== "succeeded" || task.mediaStatus !== "ready"
    ? true
    : !tosEnabled()
      ? true
      : Boolean(outputMedia);
  const revision = task.mediaRevision ?? 0;
  const localMedia = tosEnabled() ? {
    preview: effectivePreview ? publicLocalMedia(effectivePreview, { variant: "preview", url: `/api/generations/${task.id}/media?rev=${revision}`, cachePolicy: "warm" }) : undefined,
    poster: posterMedia ? publicLocalMedia(posterMedia, { variant: "thumbnail", url: `/api/generations/${task.id}/poster?rev=${revision}`, cachePolicy: "warm" }) : undefined,
    original: outputMedia ? publicLocalMedia(outputMedia, { variant: "original", url: `/api/generations/${task.id}/download?rev=${revision}`, cachePolicy: "on-demand" }) : undefined,
  } : undefined;
  return publicTask(task, { stableOutputReady, stablePreviewReady, stablePosterReady, outputIsPreview: !config.tosPreviewTranscodeEnabled, localMedia });
};
const publicUserAssetResponse = (asset: UserAsset) => {
  const media = asset.uploadId ? users.readUpload(asset.uploadId) : null;
  if (!media || media.ownerId !== asset.ownerId || media.status !== "ready") return publicUserAsset(asset);
  const sourceUrl = `/api/assets/${encodeURIComponent(asset.id)}/source`;
  return publicUserAsset(asset, {
    thumbnail: asset.assetType === "Image" ? publicLocalMedia(media, { variant: "thumbnail", url: `${sourceUrl}?variant=thumbnail`, cachePolicy: "warm", transform: "image/resize,w_640/format,webp" }) : undefined,
    original: publicLocalMedia(media, { variant: "original", url: sourceUrl, cachePolicy: "on-demand" }),
  });
};
const publicCreationSession = ({ ownerId: _ownerId, deletedAt: _deletedAt, ...session }: CreationSession) => session;
const createCreationSession = (ownerId: string, title = "新创作") => {
  const now = Date.now();
  return users.createCreationSession({ id: crypto.randomUUID(), ownerId, title, createdAt: now, updatedAt: now });
};
const creationSnapshotDependencies = {
  readUploadState: (uploadId: string) => users.readUploadState(uploadId),
  readUserAsset: (assetId: string) => users.readUserAsset(assetId),
  readSnapshotReference: (id: string) => users.readCreationSnapshotReference(id),
  readAtlasProjectAsset: (id: string, ownerId: string) => atlasRuntime.projectStore.readAsset(id, ownerId),
};
const atlasDestinationSchema = z.object({ kind: z.literal("atlas_project"), projectId: z.string().min(1).max(180) });
const enqueueSnapshotPromotions = (bundle: CreationSnapshotBundle) => {
  if (!config.taskReferenceArchiveEnabled) return;
  for (const reference of bundle.references) {
    if (reference.status !== "promoting") continue;
    scheduleBestEffort(
      () => mediaQueue.add("promote-creation-reference", { referenceId: reference.id }, {
        jobId: `promote-reference-${reference.id}`, attempts: 5,
        backoff: { type: "exponential", delay: 5000, jitter: .5 },
        removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 },
      }),
      (error) => console.warn(JSON.stringify({ type: "reedit_reference_handoff_failed", at: new Date().toISOString(), taskId: bundle.snapshot.sourceId, referenceId: reference.id, code: (error as { code?: string }).code ?? "unknown" })),
    );
  }
};

class UploadIntegrityError extends Error {
  readonly code = "UPLOAD_INTEGRITY_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "UploadIntegrityError";
  }
}
class RetryableUploadError extends Error {
  readonly code = "UPLOAD_TEMPORARY_FAILURE";
  constructor() {
    super("素材暂时无法完成校验，系统已保留上传进度，请稍后重试");
    this.name = "RetryableUploadError";
  }
}
const allowedExtensions = { image: new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".gif", ".heic", ".heif"]), video: new Set([".mp4", ".mov"]), audio: new Set([".mp3", ".wav"]) };

app.get("/api/auth/session", async (req, res) => {
  try {
    const user = await getSessionUser(redis, req, res);
    res.json(user ? {
      authenticated: true,
      user: { ...publicUser(user), features: { atlas: config.atlasEnabled } }
    } : { authenticated: false });
  } catch (error) { respondError(res, error, 500); }
});
app.get("/api/auth/feishu/start", async (req, res) => {
  try {
    const rateKey = `auth:oauth-start:${req.ip ?? "unknown"}`;
    const attempts = await redis.incr(rateKey);
    if (attempts === 1) await redis.expire(rateKey, 600);
    if (attempts > 20) return res.status(429).json({ error: "登录请求过于频繁，请稍后再试" });
    res.redirect(await createFeishuAuthorization(redis, typeof req.query.returnTo === "string" ? req.query.returnTo : undefined));
  }
  catch (error) { respondError(res, error, 503); }
});
app.get("/api/auth/feishu/callback", async (req, res) => {
  try {
    const state = z.string().min(20).parse(req.query.state);
    const pending = await consumeFeishuAuthorization(redis, state);
    if (req.query.error) throw new Error("已取消飞书授权");
    const code = z.string().min(10).parse(req.query.code);
    const profile = await exchangeFeishuCode(code, pending.verifier);
    const user = users.upsertFromFeishu(profile);
    if (user.status !== "active") throw new Error("账号已停用，请联系管理员");
    await createSession(redis, user, res);
    console.info(JSON.stringify({ type: "auth_login", at: new Date().toISOString(), userId: user.id, method: "feishu" }));
    res.redirect(pending.returnTo);
  } catch (error) {
    const message = error instanceof Error ? error.message : "飞书登录失败";
    console.warn(JSON.stringify({ type: "auth_failure", at: new Date().toISOString(), reason: message }));
    res.redirect(`/studio?auth_error=${encodeURIComponent(message)}`);
  }
});
app.delete("/api/auth/session", async (req, res) => { await clearSession(redis, req, res); res.status(204).end(); });

app.get("/api/models", requireAuth, (_req, res) => res.json(availableModels(config.disabledVideoModels)));

const uploadMetaSchema = z.object({ name: z.string().min(1).max(180), size: z.number().int().positive().max(200 * 1024 * 1024), type: z.enum(["image", "video", "audio"]), mime: z.string().max(100) });
const safeName = (name: string) => name.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120) || "asset";
type DirectUploadMeta = z.infer<typeof uploadMetaSchema> & {
  mime: string; name: string; ownerId: string; objectKey: string; tosUploadId: string;
  partSize: number; partCount: number; direct: true; createdAt: number; finalizing?: boolean;
};
type LegacyUploadMeta = z.infer<typeof uploadMetaSchema> & {
  mime: string; name: string; ownerId: string; received: number; mediaExpiresAt: number;
  direct: false; createdAt: number;
};
type UploadMeta = DirectUploadMeta | LegacyUploadMeta;
const directUploadMeta = (session: UploadSession): DirectUploadMeta => ({
  name: session.fileName, size: session.size, type: session.mediaKind, mime: session.contentType,
  ownerId: session.ownerId, objectKey: session.objectKey, tosUploadId: session.tosUploadId,
  partSize: session.partSize, partCount: session.partCount, direct: true, createdAt: session.createdAt,
});
const readUploadMeta = async (uploadId: string) => {
  const durable = users.readUploadSession(uploadId);
  if (durable) return durable.state === "uploading" && durable.expiresAt > Date.now() ? directUploadMeta(durable) : null;
  const raw = await redis.get(`upload:${uploadId}`);
  return raw ? JSON.parse(raw) as UploadMeta : null;
};
const publicUploadLocalMedia = (uploadId: string, objectKey: string, size: number, contentType: string) => publicLocalMediaFromSource({
  sourceId: objectKey,
  revision: `${objectKey}\0${size}\0${contentType}\0identity`,
  variant: "original",
  mediaType: uploadKindFromContentType(contentType),
  contentType,
  size,
  url: `/api/uploads/${encodeURIComponent(uploadId)}/source`,
  cachePolicy: "pin",
});

app.post("/api/uploads", requireAuth, async (req, res) => {
  try {
    const meta = uploadMetaSchema.parse(req.body);
    const extension = path.extname(meta.name).toLowerCase();
    if (!allowedExtensions[meta.type].has(extension)) throw new Error("不支持此素材格式");
    const limit = meta.type === "image" ? 30 * 1024 * 1024 : meta.type === "audio" ? 15 * 1024 * 1024 : 200 * 1024 * 1024;
    if (meta.size > limit) throw new Error(`${meta.type === "image" ? "图片" : meta.type === "audio" ? "音频" : "视频"}文件过大`);
    const id = crypto.randomBytes(24).toString("hex");
    const owner = res.locals.user as SessionUser;
    const name = safeName(meta.name);
    const mime = canonicalUploadContentType(name, meta.type);
    if (!(await claimUploadSlot(redis, owner.id, id, config.maxActiveUploadsPerUser))) {
      return res.status(429).json({ error: `同时最多处理 ${config.maxActiveUploadsPerUser} 个素材上传，请等待当前上传完成`, code: "UPLOAD_LIMIT_REACHED", requestId: res.locals.requestId });
    }
    let pendingMultipart: { objectKey: string; tosUploadId: string } | undefined;
    try {
      if (tosEnabled()) {
        if (!tosConfigured()) throw new Error("TOS 存储尚未配置完成");
        const objectKey = inputObjectKey(owner.id, id, name);
        const tosUploadId = await createMultipartUpload(objectKey, mime, name);
        pendingMultipart = { objectKey, tosUploadId };
        const partSize = config.tosUploadPartSize;
        const partCount = Math.ceil(meta.size / partSize);
        const stored = { ...meta, mime, name, ownerId: owner.id, objectKey, tosUploadId, partSize, partCount, direct: true, createdAt: Date.now() };
        const parts = Array.from({ length: partCount }, (_, index) => ({ partNumber: index + 1, url: signUploadPart(objectKey, tosUploadId, index + 1) }));
        users.createUploadSession({
          id, ownerId: owner.id, objectKey, tosUploadId, fileName: name, mediaKind: meta.type, contentType: mime,
          size: meta.size, partSize, partCount, state: "uploading", createdAt: stored.createdAt,
          updatedAt: stored.createdAt, expiresAt: stored.createdAt + UPLOAD_SESSION_TTL_SECONDS * 1000,
        });
        pendingMultipart = undefined;
        void redis.set(`upload:${id}`, JSON.stringify(stored), "EX", UPLOAD_SESSION_TTL_SECONDS).catch((error) => console.warn(JSON.stringify({ type: "upload_session_cache_failed", at: new Date().toISOString(), uploadId: id, userId: owner.id, code: (error as { code?: string }).code ?? "unknown" })));
        console.info(JSON.stringify({ type: "tos_upload_started", at: new Date().toISOString(), userId: owner.id, uploadId: id, size: meta.size, parts: partCount }));
        return res.status(201).json({ id, direct: true, chunkSize: partSize, concurrency: config.tosUploadConcurrency, parts, localMedia: publicUploadLocalMedia(id, objectKey, meta.size, mime) });
      }
      const dir = path.join(config.uploadDir, id);
      await fs.mkdir(dir, { recursive: true, mode: 0o750 });
      const stored = { ...meta, mime, name, received: 0, createdAt: Date.now(), ownerId: owner.id, mediaExpiresAt: Date.now() + UPLOAD_SESSION_TTL_SECONDS * 1000, direct: false };
      await redis.set(`upload:${id}`, JSON.stringify(stored), "EX", UPLOAD_SESSION_TTL_SECONDS);
      return res.status(201).json({ id, chunkSize: 16 * 1024 * 1024 });
    } catch (error) {
      if (pendingMultipart) await abortMultipartUpload(pendingMultipart.objectKey, pendingMultipart.tosUploadId).catch(() => undefined);
      await redis.del(`upload:${id}`).catch(() => undefined);
      if (!tosEnabled()) await fs.rm(path.join(config.uploadDir, id), { recursive: true, force: true }).catch(() => undefined);
      await releaseUploadSlot(redis, owner.id, id).catch(() => undefined);
      throw error;
    }
  } catch (error) { respondError(res, error); }
});

app.post("/api/uploads/:id/parts/sign", requireAuth, async (req, res) => {
  try {
    const uploadId = param(req.params.id);
    const meta = await readUploadMeta(uploadId);
    if (!meta) return res.status(404).json({ error: "上传不存在或已过期" });
    if (meta.ownerId !== (res.locals.user as SessionUser).id || !meta.direct) return res.status(404).json({ error: "上传不存在或已过期" });
    const body = z.object({ partNumbers: z.array(z.number().int().min(1)).min(1).max(100) }).parse(req.body);
    if (body.partNumbers.some((partNumber) => partNumber > meta.partCount)) throw new Error("分片编号超出范围");
    res.json({ parts: body.partNumbers.map((partNumber) => ({ partNumber, url: signUploadPart(meta.objectKey, meta.tosUploadId, partNumber) })) });
  } catch (error) { respondError(res, error); }
});

app.post("/api/uploads/:id/heartbeat", requireAuth, async (req, res) => {
  try {
    const uploadId = param(req.params.id);
    const owner = res.locals.user as SessionUser;
    const meta = await readUploadMeta(uploadId);
    if (!meta) return users.readUploadState(uploadId)?.ownerId === owner.id ? res.status(204).end() : res.status(404).json({ error: "上传不存在或已过期" });
    if (meta.ownerId !== owner.id) return res.status(404).json({ error: "上传不存在或已过期" });
    if (meta.direct && meta.finalizing) return res.status(204).end();
    const active = await renewUploadSlot(redis, owner.id, uploadId) || await claimUploadSlot(redis, owner.id, uploadId, config.maxActiveUploadsPerUser);
    if (!active) return res.status(429).json({ error: "当前上传并发较高，素材传输仍可继续", code: "UPLOAD_HEARTBEAT_LIMIT" });
    return res.status(204).end();
  } catch (error) { respondError(res, error); }
});

const enqueueUploadFinalization = (uploadId: string) => {
  void uploadFinalizationQueue.add("finalize-upload", { uploadId }, {
    jobId: `finalize-upload-${uploadId}`,
    priority: 1,
    attempts: 5,
    backoff: { type: "exponential", delay: 3000, jitter: .5 },
    removeOnComplete: true,
    removeOnFail: true
  }).catch((error) => console.warn(JSON.stringify({ type: "upload_finalize_enqueue_failed", at: new Date().toISOString(), uploadId, code: (error as { code?: string }).code ?? "unknown" })));
};

const respondUploadState = async (res: express.Response, uploadId: string, ownerId: string) => {
  const media = users.readUploadState(uploadId);
  if (!media || media.ownerId !== ownerId) return res.status(404).json({ error: "上传不存在或已过期", requestId: res.locals.requestId });
  const expiresAt = media.objectKey.startsWith("inputs/") ? media.createdAt + config.tosInputRetentionDays * 24 * 60 * 60 * 1000 : undefined;
  if (expiresAt && expiresAt <= Date.now()) return res.status(410).json({ error: "上传素材已过期，请重新上传", code: "UPLOAD_EXPIRED", requestId: res.locals.requestId });
  const base = {
    id: uploadId, uploadId, name: media.fileName, type: uploadKindFromContentType(media.contentType), size: media.size, expiresAt,
    localMedia: publicUploadLocalMedia(uploadId, media.objectKey, media.size, media.contentType),
  };
  if (media.status === "ready") return res.json({ ...base, state: "ready" });
  if (media.status === "uploading") return res.status(202).json({ ...base, state: "processing" });
  const cachedError = await redis.get(`upload:error:${uploadId}`).catch(() => null);
  return res.status(422).json({ error: cachedError || "素材内容校验失败，请检查格式后重新上传", code: "UPLOAD_VALIDATION_FAILED", requestId: res.locals.requestId });
};

app.get("/api/uploads/:id", requireAuth, async (req, res) => {
  try { return await respondUploadState(res, param(req.params.id), (res.locals.user as SessionUser).id); }
  catch (error) { respondError(res, error, 500); }
});

app.get("/api/uploads/:id/source", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const media = users.readUpload(param(req.params.id));
    const retentionMs = config.tosInputRetentionDays * 24 * 60 * 60 * 1000;
    const expiredInput = Boolean(media?.objectKey.startsWith("inputs/") && Date.now() - media.createdAt >= retentionMs);
    if (!media || media.ownerId !== user.id || media.status !== "ready" || expiredInput) return res.status(404).json({ error: "素材源文件不存在或已过期" });
    res.setHeader("Cache-Control", previewRedirectCacheHeader);
    res.setHeader("Vary", "Cookie");
    const process = req.query.variant === "thumbnail" && media.contentType.startsWith("image/")
      ? "image/resize,w_640/format,webp"
      : undefined;
    res.redirect(302, await stablePreviewUrl({ objectKey: media.objectKey, fileName: media.fileName, process }));
  } catch (error) { respondError(res, error, 502); }
});

app.post("/api/uploads/:id/chunks", requireAuth, express.raw({ type: "application/octet-stream", limit: "17mb" }), async (req, res) => {
  try {
    const uploadId = param(req.params.id);
    const meta = await readUploadMeta(uploadId);
    if (!meta) throw new Error("上传已过期，请重新选择文件");
    if (meta.ownerId !== (res.locals.user as SessionUser).id) return res.status(404).json({ error: "上传不存在或已过期" });
    if (meta.direct) return res.status(409).json({ error: "当前上传使用 TOS 直传" });
    const lock = await acquireUploadCompletionLock(redis, uploadId, 60);
    if (!lock) return res.status(409).json({ error: "上一分片仍在写入，请稍后重试", expectedOffset: meta.received });
    try {
    const currentRaw = await redis.get(`upload:${uploadId}`);
    if (!currentRaw) throw new Error("上传已过期，请重新选择文件");
    const current = JSON.parse(currentRaw);
    const offset = Number(req.header("x-upload-offset") ?? -1);
    if (offset !== current.received) return res.status(409).json({ error: "分片顺序不正确", expectedOffset: current.received });
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length || current.received + body.length > current.size) throw new Error("无效的上传分片");
    await fs.appendFile(path.join(config.uploadDir, uploadId, "payload"), body);
    current.received += body.length;
    await redis.set(`upload:${uploadId}`, JSON.stringify(current), "EX", UPLOAD_SESSION_TTL_SECONDS);
    return res.json({ received: current.received });
    } finally { await releaseUploadCompletionLock(redis, uploadId, lock).catch(() => undefined); }
  } catch (error) { respondError(res, error); }
});

app.post("/api/uploads/:id/complete", requireAuth, async (req, res) => {
  try {
    const startedAt = Date.now();
    const uploadId = param(req.params.id);
    const owner = res.locals.user as SessionUser;
    const completed = users.readUploadState(uploadId);
    if (completed) return await respondUploadState(res, uploadId, owner.id);
    const meta = await readUploadMeta(uploadId);
    if (!meta) return res.status(404).json({ error: "上传不存在或已过期", requestId: res.locals.requestId });
    if (meta.ownerId !== owner.id) return res.status(404).json({ error: "上传不存在或已过期" });
    const lock = await acquireUploadCompletionLock(redis, uploadId);
    if (!lock) return res.status(409).json({ error: "素材正在完成校验，请稍后重试", code: "UPLOAD_FINALIZING", requestId: res.locals.requestId });
    try {
      const reconciled = users.readUploadState(uploadId);
      if (reconciled) return await respondUploadState(res, uploadId, owner.id);
      if (meta.direct) {
        const body = z.object({ parts: z.array(z.object({ partNumber: z.number().int().min(1), eTag: z.string().min(1).max(256) })) }).parse(req.body);
        const parts = [...body.parts].sort((a, b) => a.partNumber - b.partNumber);
        if (parts.length !== meta.partCount || parts.some((part, index) => part.partNumber !== index + 1)) throw new UploadIntegrityError("上传分片不完整或顺序错误");
        const stageLog = (stage: string, extra: Record<string, unknown> = {}) => console.info(JSON.stringify({ type: "upload_complete_stage", at: new Date().toISOString(), uploadId, userId: meta.ownerId, stage, elapsedMs: Date.now() - startedAt, ...extra }));
        stageLog("start");
        try {
          try {
            await completeMultipartUpload(meta.objectKey, meta.tosUploadId, parts);
            stageLog("merged");
          } catch (mergeError) {
            // CompleteMultipartUpload may have committed even when its response was lost.
            // Reconcile by the deterministic object key before deciding whether a retry is needed.
            await headObject(meta.objectKey);
            stageLog("merge_reconciled", { errorCode: (mergeError as { code?: string }).code });
          }
          const head = await headObject(meta.objectKey);
          const size = Number(head.headers["content-length"] ?? 0);
          if (size !== meta.size) throw new UploadIntegrityError("TOS 合并后的文件大小不一致");
          stageLog("headed", { size });
          const now = Date.now();
          users.upsertMedia({ id: `input:${uploadId}`, ownerId: meta.ownerId, uploadId, kind: "input", objectKey: meta.objectKey, status: "uploading", fileName: meta.name, contentType: meta.mime, size, etag: String(head.headers.etag ?? "").replace(/^"|"$/g, ""), createdAt: now, updatedAt: now });
          users.updateUploadSessionState(uploadId, owner.id, "finalizing");
          // Keep the original multipart metadata until validation commits. Besides
          // powering recovery, this lets the previous blue/green image finish the
          // upload synchronously after an emergency rollback.
          meta.finalizing = true;
          void redis.set(`upload:${uploadId}`, JSON.stringify(meta), "EX", UPLOAD_SESSION_TTL_SECONDS).catch(() => undefined);
          void releaseUploadSlot(redis, owner.id, uploadId).catch(() => undefined);
          enqueueUploadFinalization(uploadId);
          stageLog("finalization_scheduled");
          console.info(JSON.stringify({ type: "tos_upload_transport_completed", at: new Date().toISOString(), userId: meta.ownerId, uploadId, size, requestId: head.requestId }));
          return res.status(202).json({ id: uploadId, uploadId, name: meta.name, type: meta.type, size, state: "processing", expiresAt: Date.now() + config.tosInputRetentionDays * 24 * 60 * 60 * 1000 });
        } catch (error) {
          const destructive = error instanceof UploadIntegrityError;
          console.warn(JSON.stringify({ type: "tos_upload_failed", at: new Date().toISOString(), userId: meta.ownerId, uploadId, retryable: !destructive, errorCode: (error as { code?: string }).code ?? (destructive ? "validation_failed" : "transient_failure"), message: error instanceof Error ? error.message.slice(0, 400) : undefined }));
          if (destructive) {
            users.updateUploadSessionState(uploadId, owner.id, "failed");
            await abortMultipartUpload(meta.objectKey, meta.tosUploadId).catch(() => undefined);
            await deleteObject(meta.objectKey).catch(() => undefined);
            await redis.del(`upload:${uploadId}`);
            await releaseUploadSlot(redis, owner.id, uploadId);
          }
          if (!destructive) throw new RetryableUploadError();
          throw error;
        }
      }
      if (meta.received !== meta.size) throw new UploadIntegrityError("文件上传尚未完成");
      const finalPath = path.join(config.uploadDir, uploadId, meta.name);
      await fs.rename(path.join(config.uploadDir, uploadId, "payload"), finalPath);
      try { await validateMedia(finalPath, meta.type); } catch (error) { await fs.rm(path.join(config.uploadDir, uploadId), { recursive: true, force: true }); await redis.del(`upload:${uploadId}`); await releaseUploadSlot(redis, owner.id, uploadId); throw error; }
      const now = Date.now();
      users.upsertMedia({ id: `input:${uploadId}`, ownerId: meta.ownerId, uploadId, kind: "input", objectKey: `legacy/${uploadId}/${meta.name}`, status: "ready", fileName: meta.name, contentType: meta.mime, size: meta.size, etag: "", createdAt: now, updatedAt: now });
      await releaseUploadSlot(redis, owner.id, uploadId);
      const publicUrl = await resolveUploadMediaUrl({ objectKey: `legacy/${uploadId}/${meta.name}`, uploadId, fileName: meta.name });
      return res.json({ id: uploadId, uploadId, name: meta.name, type: meta.type, size: meta.size, url: publicUrl });
    } finally { void releaseUploadCompletionLock(redis, uploadId, lock).catch(() => undefined); }
  } catch (error) { respondError(res, error, error instanceof RetryableUploadError ? 503 : 400); }
});

app.delete("/api/uploads/:id", requireAuth, async (req, res) => {
  try {
    const uploadId = param(req.params.id);
    const owner = res.locals.user as SessionUser;
    const completed = users.readUploadState(uploadId);
    if (completed && completed.status !== "deleted") return completed.ownerId === owner.id ? res.status(409).json({ error: "素材已完成上传或正在校验，不能取消" }) : res.status(404).json({ error: "上传不存在或已过期" });
    if (completed?.status === "deleted") return completed.ownerId === owner.id ? res.status(204).end() : res.status(404).json({ error: "上传不存在或已过期" });
    const meta = await readUploadMeta(uploadId);
    if (!meta) return res.status(204).end();
    if (meta.ownerId !== owner.id) return res.status(404).json({ error: "上传不存在或已过期" });
    const lock = await acquireUploadCompletionLock(redis, uploadId, 60);
    if (!lock) return res.status(409).json({ error: "素材正在完成校验，暂时不能取消", code: "UPLOAD_FINALIZING", requestId: res.locals.requestId });
    try {
      const reconciled = users.readUploadState(uploadId);
      if (reconciled) return res.status(409).json({ error: "素材已完成上传或正在校验，不能取消" });
      if (meta.direct) {
        users.updateUploadSessionState(uploadId, owner.id, "cancelled");
        await abortMultipartUpload(meta.objectKey, meta.tosUploadId).catch(() => undefined);
        await deleteObject(meta.objectKey).catch(() => undefined);
      } else {
        await fs.rm(path.join(config.uploadDir, uploadId), { recursive: true, force: true });
      }
      await redis.del(`upload:${uploadId}`);
      await releaseUploadSlot(redis, owner.id, uploadId);
      console.info(JSON.stringify({ type: "upload_cancelled", at: new Date().toISOString(), userId: owner.id, uploadId }));
      return res.status(204).end();
    } finally {
      await releaseUploadCompletionLock(redis, uploadId, lock).catch(() => undefined);
    }
  } catch (error) { respondError(res, error); }
});

app.get("/media/:id/:name", async (req, res) => {
  const uploadId = param(req.params.id); const fileName = param(req.params.name);
  const raw = await redis.get(`upload:${uploadId}`);
  if (!raw) return res.status(410).send("Expired");
  const meta = JSON.parse(raw);
  if (meta.name !== fileName) return res.status(404).end();
  const expires = Number(req.query.expires);
  const provided = typeof req.query.token === "string" ? req.query.token : "";
  const expected = crypto.createHmac("sha256", config.sessionSecret).update(`${uploadId}:${meta.name}:${expires}`).digest("base64url");
  const valid = expires === meta.mediaExpiresAt && expires > Date.now() && provided.length === expected.length && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!valid) return res.status(404).end();
  res.setHeader("Cache-Control", "private, max-age=300");
  res.sendFile(path.join(config.uploadDir, uploadId, meta.name));
});

const creationSessionTitleSchema = z.object({ title: z.string().trim().min(1, "会话名称不能为空").max(64, "会话名称不能超过 64 个字符") });
const creationSessionCreateSchema = z.object({
  requestId: z.string().uuid().optional(),
  title: z.string().trim().min(1, "会话名称不能为空").max(64, "会话名称不能超过 64 个字符").optional(),
});

app.get("/api/creation-sessions", requireAuth, (_req, res) => {
  const user = res.locals.user as SessionUser;
  res.json(users.listCreationSessions(user.id).map(publicCreationSession));
});

app.post("/api/creation-sessions", requireAuth, (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const body = creationSessionCreateSchema.parse(req.body ?? {});
    const now = Date.now();
    const admission = users.admitCreationSession({ id: body.requestId ?? crypto.randomUUID(), ownerId: user.id, title: body.title ?? "新创作", createdAt: now, updatedAt: now });
    if (admission.status === "existing" && (admission.session.ownerId !== user.id || admission.session.deletedAt)) {
      return res.status(409).json({ error: "请求标识已被使用", requestId: res.locals.requestId });
    }
    res.status(admission.status === "created" ? 201 : 200).json(publicCreationSession(admission.session));
  } catch (error) { respondError(res, error); }
});

app.get("/api/creation-sessions/:id", requireAuth, (req, res) => {
  const user = res.locals.user as SessionUser;
  const session = users.readCreationSession(param(req.params.id));
  session && session.ownerId === user.id ? res.json(publicCreationSession(session)) : res.status(404).json({ error: "创作会话不存在" });
});

app.patch("/api/creation-sessions/:id", requireAuth, (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const { title } = creationSessionTitleSchema.parse(req.body);
    const session = users.renameCreationSession(param(req.params.id), user.id, title);
    session ? res.json(publicCreationSession(session)) : res.status(404).json({ error: "创作会话不存在" });
  } catch (error) { respondError(res, error); }
});

app.delete("/api/creation-sessions/:id", requireAuth, (req, res) => {
  const user = res.locals.user as SessionUser;
  users.softDeleteCreationSession(param(req.params.id), user.id) ? res.status(204).end() : res.status(404).json({ error: "创作会话不存在" });
});

app.get("/api/creation-references/:id/source", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const reference = users.readCreationSnapshotReference(param(req.params.id));
    if (!reference || reference.ownerId !== user.id) return res.status(404).json({ error: "任务素材不存在" });
    if (reference.status !== "ready" || !reference.objectKey) return res.status(reference.status === "promoting" ? 425 : 410).json({ error: reference.status === "promoting" ? "任务素材正在长期归档" : "任务素材无法恢复" });
    res.setHeader("Cache-Control", previewRedirectCacheHeader);
    res.setHeader("Vary", "Cookie");
    const process = req.query.variant === "thumbnail" && reference.mediaType === "image" ? "image/resize,w_640/format,webp" : undefined;
    res.redirect(302, await stablePreviewUrl({ objectKey: reference.objectKey, fileName: reference.displayName, process }));
  } catch (error) { respondError(res, error, 502); }
});

app.get("/api/creation-references/:id", requireAuth, (req, res) => {
  const user = res.locals.user as SessionUser;
  const reference = users.readCreationSnapshotReference(param(req.params.id));
  if (!reference || reference.ownerId !== user.id || reference.status === "deleted") return res.status(404).json({ error: "任务素材不存在" });
  res.status(reference.status === "promoting" ? 202 : 200).json({
    id: reference.id,
    bindingId: reference.bindingId,
    name: reference.displayName,
    type: reference.mediaType,
    size: reference.size,
    state: reference.status === "ready" ? "ready" : reference.status === "promoting" ? "processing" : "unavailable",
    preview: reference.status === "ready" && reference.mediaType === "image" ? `/api/creation-references/${encodeURIComponent(reference.id)}/source?variant=thumbnail` : undefined,
  });
});

app.post("/api/reedit-sessions", requireAuth, (req, res) => {
  try {
    const body = z.object({ sourceType: z.enum(["video", "image"]), sourceId: z.string().min(1).max(200) }).parse(req.body);
    const user = res.locals.user as SessionUser;
    const source = body.sourceType === "video" ? users.readTask(body.sourceId) : users.readImageGeneration(body.sourceId);
    if (!source || source.ownerId !== user.id) return res.status(404).json({ error: "创作记录不存在或无权访问" });
    const terminal = body.sourceType === "video" ? ["succeeded", "failed"].includes(source.status) : source.status !== "running";
    if (!terminal) return res.status(409).json({ error: "任务仍在生成，暂时不能重新编辑" });
    const prompt = source.prompt.trim();
    const now = Date.now();
    const admitted = users.admitReeditSession(user.id, body.sourceType, body.sourceId, {
      id: crypto.randomUUID(), ownerId: user.id,
      title: prompt ? `重新编辑 · ${prompt.slice(0, 32)}` : "重新编辑",
      createdAt: now, updatedAt: now,
    });
    res.status(admitted.status === "created" ? 201 : 200).json(publicCreationSession(admitted.session));
  } catch (error) { respondError(res, error); }
});

app.get("/api/generation-capacity", requireAuth, (_req, res) => {
  const user = res.locals.user as SessionUser;
  const active = users.countActiveTasksForUser(user.id);
  const limit = config.maxActiveGenerationsPerUser;
  res.json({ active, limit, available: Math.max(0, limit - active) });
});

app.post("/api/generations", requireAuth, async (req, res) => {
  const requestContext: GenerationRejectContext = {
    ...(typeof req.body?.model === "string" ? { model: req.body.model } : {}),
    ...(typeof req.body?.mode === "string" ? { mode: req.body.mode } : {}),
    assetCount: Array.isArray(req.body?.assets) ? req.body.assets.length : 0,
  };
  try {
    const requestedTaskId = z.string().uuid().optional().parse(req.body?.requestId);
    const owner = res.locals.user as SessionUser;
    const destination = atlasDestinationSchema.optional().parse(req.body?.destination);
    if (destination && !config.atlasGenerateEnabled) return rejectGeneration(res, 404, "ATLAS_GENERATE_DISABLED", "Atlas生成能力尚未开放", requestContext);
    const atlasSession = destination ? atlasRuntime.projectStore.readGenerationSession(destination.projectId, owner.id) : undefined;
    if (destination && !atlasRuntime.projectStore.readProject(destination.projectId, owner.id)) return rejectGeneration(res, 404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在", requestContext);
    if (destination && !atlasSession) return rejectGeneration(res, 409, "ATLAS_GENERATION_SESSION_REQUIRED", "请重新打开Atlas生成面板", requestContext);
    if (requestedTaskId) {
      const existing = await readTask(requestedTaskId, true);
      if (existing) {
        if (existing.ownerId !== owner.id || existing.deletedAt) return rejectGeneration(res, 409, "REQUEST_ID_CONFLICT", "请求标识已被使用", requestContext);
        if (destination) {
          if (existing.sessionId !== atlasSession!.sessionId) return rejectGeneration(res, 409, "ATLAS_SESSION_MISMATCH", "Atlas生成会话已变化，请刷新后重试", requestContext);
          atlasRuntime.projectStore.createGenerationDestinations({
            ownerId: owner.id, projectId: destination.projectId, sessionId: atlasSession!.sessionId,
            sourceType: "video", sourceId: existing.id,
            outputs: [{ id: crypto.randomUUID(), outputKey: "video" }], now: Date.now(),
          });
        }
        const active = ["queued", "submitting", "running"].includes(existing.status) || existing.mediaStatus === "archiving";
        return res.status(active ? 202 : 200).json(publicGenerationTask(existing));
      }
    }
    const requestedSessionId = z.string().min(1).max(200).optional().parse(req.body?.sessionId);
    const requestedInput = validateGeneration(req.body);
    if (destination && requestedSessionId && requestedSessionId !== atlasSession?.sessionId) return rejectGeneration(res, 409, "ATLAS_SESSION_MISMATCH", "Atlas生成会话已变化，请刷新后重试", requestContext);
    const effectiveSessionId = atlasSession?.sessionId ?? requestedSessionId;
    const session = effectiveSessionId ? users.readCreationSession(effectiveSessionId) : null;
    if (effectiveSessionId && (!session || session.ownerId !== owner.id)) return rejectGeneration(res, 404, "SESSION_NOT_FOUND", "创作会话不存在", requestContext);
    const activeSession = session ?? createCreationSession(owner.id);
    const assets = [];
    for (const asset of requestedInput.assets) {
      if (asset.canvasProjectAssetId) return rejectGeneration(res, 404, "REFERENCE_NOT_FOUND", "引用素材不存在或无权访问", requestContext);
      if (asset.atlasProjectAssetId) {
        const media = atlasRuntime.projectStore.readAsset(asset.atlasProjectAssetId, owner.id);
        if (!media || media.status !== "ready" || media.projectId !== destination?.projectId || media.kind !== asset.type) return rejectGeneration(res, 404, "REFERENCE_NOT_FOUND", "Atlas项目素材不存在、尚未就绪或类型不匹配", requestContext);
        assets.push(asset);
        continue;
      }
      if (asset.uploadId) {
        const media = users.readUploadState(asset.uploadId);
        if (!canCreatePendingAsset(media, owner.id, config.tosInputRetentionDays)) return rejectGeneration(res, 404, "REFERENCE_EXPIRED", "引用素材不存在或已过期", requestContext);
        assets.push(asset);
        continue;
      }
      if (asset.assetId) {
        const owned = users.readUserAsset(asset.assetId);
        if (!owned || owned.ownerId !== owner.id) return rejectGeneration(res, 404, "REFERENCE_NOT_FOUND", "引用素材不存在或无权访问", requestContext);
        if (owned.status !== "Active") return rejectGeneration(res, 409, owned.status === "Failed" ? "REFERENCE_UNAVAILABLE" : "REFERENCE_PROCESSING", owned.status === "Failed" ? "参考素材处理失败，请重新上传" : "参考素材仍在处理中，请稍后再试", requestContext);
        assets.push(asset);
        continue;
      }
      if (asset.snapshotReferenceId) {
        const reference = users.readCreationSnapshotReference(asset.snapshotReferenceId);
        if (!reference || reference.ownerId !== owner.id || reference.status !== "ready" || reference.mediaType !== asset.type) return rejectGeneration(res, 404, "REFERENCE_NOT_READY", "引用素材不存在或尚未归档完成", requestContext);
        assets.push(asset);
        continue;
      }
      if (!asset.url) continue;
      const url = new URL(asset.url);
      if (url.origin === applicationOrigin && url.pathname.startsWith("/media/")) {
        const uploadId = url.pathname.split("/")[2];
        const raw = uploadId ? await redis.get(`upload:${uploadId}`) : null;
        if (!raw || JSON.parse(raw).ownerId !== owner.id) return rejectGeneration(res, 404, "REFERENCE_EXPIRED", "引用素材不存在或已过期", requestContext);
      }
      assets.push(asset);
    }
    const id = requestedTaskId ?? crypto.randomUUID();
    const now = Date.now();
    const editorPrompt = requestedInput.editorPrompt ?? requestedInput.prompt;
    const snapshot = buildCreationSnapshot({
      sourceType: "video", sourceId: id, ownerId: owner.id, sessionId: activeSession.id,
      editorPrompt, parameters: {
        model: requestedInput.model, mode: requestedInput.mode, ratio: requestedInput.ratio,
        resolution: requestedInput.resolution, duration: requestedInput.duration,
        generateAudio: requestedInput.generateAudio, seed: requestedInput.seed,
        cameraFixed: requestedInput.cameraFixed, watermark: requestedInput.watermark,
      },
      references: assets as CreationReferenceInput[], createdAt: now,
    }, creationSnapshotDependencies);
    if (snapshot.references.some((reference) => reference.status === "unavailable")) return rejectGeneration(res, 409, "REFERENCE_UNAVAILABLE", "有参考素材刚刚失效，请重新选择后提交", requestContext);
    const input = validateGeneration({ ...requestedInput, editorPrompt, prompt: snapshot.snapshot.providerPrompt, assets });
    const persistedRequest = { ...input, assets };
    const task: StoredTask = { id, sessionId: activeSession.id, ownerId: owner.id, visibility: "private", status: "queued", mediaStatus: "none", mediaRevision: 0, prompt: input.prompt, model: input.model, mode: input.mode, ratio: input.ratio, resolution: input.resolution, duration: input.duration, request: persistedRequest, createdAt: now, updatedAt: now };
    const intent = { queueName: "generation" as const, jobId: id, jobName: "generate", payload: { input } };
    const destinationAdmission = destination ? {
      ownerId: owner.id, projectId: destination.projectId, sessionId: activeSession.id,
      sourceType: "video" as const, sourceId: id,
      outputs: [{ id: crypto.randomUUID(), outputKey: "video" }], now,
    } : undefined;
    const admission = users.admitTaskWithinLimit(task, config.maxActiveGenerationsPerUser, intent, snapshot, destinationAdmission);
    if (admission.status === "limit") return rejectGeneration(res, 429, "GENERATION_LIMIT_REACHED", `你已有 ${config.maxActiveGenerationsPerUser} 个任务正在生成，请等待其中一个完成`, { ...requestContext, activeCount: users.countActiveTasksForUser(owner.id), limit: config.maxActiveGenerationsPerUser });
    if (admission.status === "existing") {
      if (admission.task.ownerId !== owner.id || admission.task.deletedAt) return rejectGeneration(res, 409, "REQUEST_ID_CONFLICT", "请求标识已被使用", requestContext);
      if (destination) atlasRuntime.projectStore.createGenerationDestinations({
        ownerId: owner.id, projectId: destination.projectId, sessionId: activeSession.id,
        sourceType: "video", sourceId: admission.task.id,
        outputs: [{ id: crypto.randomUUID(), outputKey: "video" }], now,
      });
      const active = ["queued", "submitting", "running"].includes(admission.task.status) || admission.task.mediaStatus === "archiving";
      return res.status(active ? 202 : 200).json(publicGenerationTask(admission.task));
    }
    enqueueSnapshotPromotions(snapshot);
    users.touchCreationSession(activeSession.id, owner.id, input.prompt);
    console.info(JSON.stringify({ type: "generation_admitted", level: "info", at: new Date().toISOString(), requestId: res.locals.requestId, taskId: id, userId: owner.id, model: input.model, mode: input.mode, assetCount: input.assets.length, activeCount: users.countActiveTasksForUser(owner.id), limit: config.maxActiveGenerationsPerUser }));
    res.status(202).json(publicGenerationTask(task));
  } catch (error) {
    if (error instanceof PromptTooLongError) {
      console.info(JSON.stringify({ type: "generation_rejected", level: "info", at: new Date().toISOString(), requestId: res.locals.requestId, userId: (res.locals.user as SessionUser).id, status: 400, code: error.code, field: error.field, actual: error.actual, limit: error.limit, ...requestContext }));
      return res.status(400).json({ error: error.message, code: error.code, details: { field: error.field, actual: error.actual, limit: error.limit }, requestId: res.locals.requestId });
    }
    const issues = error instanceof z.ZodError ? error.issues.slice(0, 8).map((issue) => ({ code: issue.code, path: issue.path.join(".") })) : undefined;
    const errorCode = (error as { code?: string }).code;
    const isClientError = error instanceof z.ZodError || errorCode === "UNRESOLVED_PROMPT_REFERENCE";
    const message = error instanceof z.ZodError
      ? error.issues[0]?.message ?? "生成参数无效"
      : isClientError && error instanceof Error
        ? error.message
        : "生成服务暂时无法接纳请求，请稍后重试";
    const publicCode = error instanceof z.ZodError ? "REQUEST_SCHEMA_INVALID" : isClientError ? errorCode! : "GENERATION_ADMISSION_FAILED";
    return rejectGeneration(res, isClientError ? 400 : 500, publicCode, message, { ...requestContext, errorType: error instanceof Error ? error.name : typeof error, ...(!isClientError && errorCode ? { causeCode: errorCode } : {}), ...(issues ? { issues } : {}) });
  }
});

const generationListQuerySchema = z.object({
  sessionId: z.string().uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
  beforeCreatedAt: z.coerce.number().int().nonnegative().optional(),
  beforeId: z.string().uuid().optional(),
}).refine((value) => (value.beforeCreatedAt === undefined) === (value.beforeId === undefined), { message: "分页游标不完整" });

app.get("/api/generations", requireAuth, async (req, res) => {
  const user = res.locals.user as SessionUser;
  const query = generationListQuerySchema.parse(req.query);
  const sessionId = query.sessionId ?? "";
  const before = query.beforeCreatedAt !== undefined && query.beforeId ? { createdAt: query.beforeCreatedAt, id: query.beforeId } : undefined;
  if (sessionId) {
    const session = users.readCreationSession(sessionId);
    if (!session || session.ownerId !== user.id) return res.status(404).json({ error: "创作会话不存在" });
    return res.json(users.listTasksForSession(user.id, sessionId, query.pageSize, before).map(publicGenerationTask));
  }
  res.json(users.listTasksForUser(user.id, query.pageSize, before).map(publicGenerationTask));
});
app.get("/api/generations/:id", requireAuth, async (req, res) => {
  const task = await readTask(param(req.params.id));
  task && canAccessTask(task, (res.locals.user as SessionUser).id) ? res.json(publicGenerationTask(task)) : res.status(404).json({ error: "任务不存在或已过期" });
});

const reeditDependencies = {
  readUploadState: (uploadId: string) => users.readUploadState(uploadId),
  readUserAsset: (assetId: string) => users.readUserAsset(assetId),
  readSnapshot: (sourceType: "video" | "image", sourceId: string) => users.readCreationSnapshot(sourceType, sourceId),
  listSnapshotReferences: (sourceType: "video" | "image", sourceId: string) => users.listCreationSnapshotReferences(sourceType, sourceId),
  readSession: (sessionId: string, includeDeleted = false) => users.readCreationSession(sessionId, includeDeleted),
  now: () => Date.now(),
  inputRetentionDays: config.tosInputRetentionDays,
  disabledVideoModels: config.disabledVideoModels,
};

const legacyReeditDependencies = {
  readUploadState: reeditDependencies.readUploadState,
  readUserAsset: reeditDependencies.readUserAsset,
  readSession: reeditDependencies.readSession,
  now: reeditDependencies.now,
  inputRetentionDays: reeditDependencies.inputRetentionDays,
  disabledVideoModels: reeditDependencies.disabledVideoModels,
};
let reeditIntegrityCache: { checkedAt: number; error?: Error } = { checkedAt: 0 };
const checkReeditIntegrity = () => {
  if (Date.now() - reeditIntegrityCache.checkedAt < 30_000) {
    if (reeditIntegrityCache.error) throw reeditIntegrityCache.error;
    return;
  }
  try {
    runReeditIntegrityCheck(users, config.tosInputRetentionDays);
    reeditIntegrityCache = { checkedAt: Date.now() };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error("re-edit integrity unavailable");
    reeditIntegrityCache = { checkedAt: Date.now(), error: failure };
    throw failure;
  }
};
const ensureVideoSnapshot = (task: StoredTask) => {
  if (!config.reeditV2Enabled || users.readCreationSnapshot("video", task.id)) return;
  const bundle = buildLegacyVideoSnapshot(task, creationSnapshotDependencies);
  if (users.createCreationSnapshotIfMissing(bundle).status === "created") enqueueSnapshotPromotions(bundle);
};
const ensureImageSnapshot = (task: ImageGenerationTask) => {
  if (!config.reeditV2Enabled || users.readCreationSnapshot("image", task.id)) return;
  const bundle = buildLegacyImageSnapshot(task, creationSnapshotDependencies);
  if (users.createCreationSnapshotIfMissing(bundle).status === "created") enqueueSnapshotPromotions(bundle);
};
const logReeditDiagnostics = (payload: ReturnType<typeof buildVideoReeditPayload>, requestId: string, userId: string) => {
  for (const warning of payload.warnings) if (warning.bindingId && ["REFERENCE_ARCHIVING", "REFERENCE_UNAVAILABLE", "LEGACY_REFERENCE_MISSING"].includes(warning.code)) console.warn(JSON.stringify({
    type: "reedit_reference_missing", at: new Date().toISOString(), requestId, taskId: payload.sourceId,
    sourceType: payload.sourceType, userId, bindingId: warning.bindingId, mediaType: warning.type, code: warning.code,
  }));
  for (const adjustment of payload.adjustments) console.info(JSON.stringify({
    type: "reedit_capability_adjusted", at: new Date().toISOString(), requestId, taskId: payload.sourceId,
    sourceType: payload.sourceType, userId, field: adjustment.field, requested: adjustment.requested,
    effective: adjustment.effective,
  }));
};
const trackReeditMetric = (metric: "started" | "failed") => {
  const key = `metrics:reedit:${Math.floor(Date.now() / 60_000)}:${metric}`;
  scheduleBestEffort(() => redis.multi().incr(key).expire(key, 10 * 60).exec(), () => undefined);
};

app.get("/api/generations/:id/reedit", requireAuth, async (req, res) => {
  const user = res.locals.user as SessionUser;
  const task = await readTask(param(req.params.id));
  if (!task || task.ownerId !== user.id) return res.status(404).json({ error: "任务不存在或无权访问" });
  if (!["succeeded", "failed"].includes(task.status)) return res.status(409).json({ error: "任务仍在生成，请完成后再重新编辑" });
  const startedAt = Date.now();
  trackReeditMetric("started");
  console.info(JSON.stringify({ type: "reedit_started", at: new Date().toISOString(), requestId: res.locals.requestId, taskId: task.id, sourceType: "video", userId: user.id }));
  try {
    ensureVideoSnapshot(task);
    const payload = buildVideoReeditPayload(task, user.id, config.reeditV2Enabled ? reeditDependencies : legacyReeditDependencies);
    logReeditDiagnostics(payload, res.locals.requestId, user.id);
    console.info(JSON.stringify({ type: payload.recoveryQuality === "exact" ? "reedit_snapshot_loaded" : "reedit_snapshot_partial", at: new Date().toISOString(), requestId: res.locals.requestId, taskId: task.id, sourceType: "video", userId: user.id, bindings: payload.state.assets.length, omitted: payload.omittedAssets, recoveryQuality: payload.recoveryQuality, elapsedMs: Date.now() - startedAt }));
    res.json(payload);
  } catch (error) {
    trackReeditMetric("failed");
    console.error(JSON.stringify({ type: "reedit_failed", at: new Date().toISOString(), requestId: res.locals.requestId, taskId: task.id, sourceType: "video", userId: user.id, code: (error as { code?: string }).code ?? "internal", elapsedMs: Date.now() - startedAt }));
    respondError(res, error, 500);
  }
});

const accessibleTask = async (req: express.Request, res: express.Response) => {
  const task = await readTask(param(req.params.id));
  const user = res.locals.user as SessionUser;
  return task && canAccessTask(task, user.id) ? task : null;
};

app.get("/api/generations/:id/media", requireAuth, async (req, res) => {
  try {
    const task = await accessibleTask(req, res);
    if (!task || task.status !== "succeeded") return res.status(404).json({ error: "预览入口暂不可用，请刷新页面后重试", code: "PREVIEW_NOT_AVAILABLE" });
    const media = config.tosPreviewTranscodeEnabled
      ? users.readTaskMedia(task.id, "preview")
      : task.mediaStatus === "ready" ? users.readTaskMedia(task.id, "preview") ?? users.readTaskMedia(task.id, "output") : null;
    if (!media) return res.status(425).json({ error: "成片正在归档到TOS，请稍后重试" });
    const target = await stablePreviewUrl({ objectKey: media.objectKey, fileName: media.fileName }); const source = "tos" as const;
    res.setHeader("Cache-Control", previewRedirectCacheHeader);
    res.setHeader("Vary", "Cookie");
    res.setHeader("X-Firefly-Media-Source", source);
    console.info(JSON.stringify({ type: "tos_media_redirect", at: new Date().toISOString(), taskId: task.id, userId: (res.locals.user as SessionUser).id, source, kind: "preview" }));
    res.redirect(302, target);
  } catch (error) { respondError(res, error, 502); }
});

app.get("/api/generations/:id/poster", requireAuth, async (req, res) => {
  try {
    const task = await accessibleTask(req, res);
    if (!task) return res.status(404).json({ error: "海报不存在" });
    const media = users.readTaskMedia(task.id, "poster");
    if (!media) return res.status(404).json({ error: "海报尚未生成" });
    res.setHeader("Cache-Control", previewRedirectCacheHeader);
    res.setHeader("Vary", "Cookie");
    res.redirect(302, await stablePreviewUrl({ objectKey: media.objectKey, fileName: media.fileName }));
  } catch (error) { respondError(res, error, 502); }
});

app.get("/api/generations/:id/download", requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Cookie");
  const taskId = param(req.params.id);
  const userId = (res.locals.user as SessionUser).id;
  try {
    const task = await accessibleTask(req, res);
    if (!task || task.status !== "succeeded") {
      console.info(JSON.stringify({ type: "download_rejected", at: new Date().toISOString(), requestId: res.locals.requestId, taskId, userId, target: "tos_original", status: 404, code: "DOWNLOAD_NOT_AVAILABLE" }));
      return res.status(404).json({ error: "下载入口暂不可用，请刷新页面后重试", code: "DOWNLOAD_NOT_AVAILABLE" });
    }
    console.info(JSON.stringify({ type: "download_request_admitted", at: new Date().toISOString(), requestId: res.locals.requestId, taskId, userId, target: "tos_original" }));
    const media = task.mediaStatus === "ready" ? users.readTaskMedia(task.id, "output") : null;
    if (!media) {
      console.info(JSON.stringify({ type: "download_rejected", at: new Date().toISOString(), requestId: res.locals.requestId, taskId, userId, target: "tos_original", status: 425, code: "ORIGINAL_ARCHIVING" }));
      return res.status(425).json({ error: "原片正在归档到北京 TOS，完成后即可高速下载", code: "ORIGINAL_ARCHIVING" });
    }
    const target = signedObjectUrl(media.objectKey, { download: true, fileName: media.fileName });
    res.setHeader("X-Firefly-Media-Source", "tos");
    console.info(JSON.stringify({ type: "download_redirect", at: new Date().toISOString(), requestId: res.locals.requestId, taskId, userId, target: "tos_original", status: 302, bytes: media.size }));
    console.info(JSON.stringify({ type: "tos_media_redirect", at: new Date().toISOString(), taskId: task.id, userId: (res.locals.user as SessionUser).id, source: "tos", kind: "original_download", archivePending: false }));
    res.redirect(302, target);
  } catch (error) {
    console.warn(JSON.stringify({ type: "download_rejected", at: new Date().toISOString(), requestId: res.locals.requestId, taskId, userId, target: "tos_original", status: 502, code: (error as { code?: string }).code ?? "DOWNLOAD_REDIRECT_FAILED" }));
    respondError(res, error, 502);
  }
});

app.get("/api/generations/:id/download/temporary", requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Cookie");
  const taskId = param(req.params.id);
  const userId = (res.locals.user as SessionUser).id;
  try {
    const task = await accessibleTask(req, res);
    if (!task || task.status !== "succeeded") {
      console.info(JSON.stringify({ type: "download_rejected", at: new Date().toISOString(), requestId: res.locals.requestId, taskId, userId, target: "temporary_original", status: 404, code: "DOWNLOAD_NOT_AVAILABLE" }));
      return res.status(404).json({ error: "下载入口暂不可用，请刷新页面后重试", code: "DOWNLOAD_NOT_AVAILABLE" });
    }
    console.info(JSON.stringify({ type: "download_request_admitted", at: new Date().toISOString(), requestId: res.locals.requestId, taskId, userId, target: "temporary_original" }));
    const available = Boolean(task.sourceVideoUrl)
      && (!task.sourceVideoExpiresAt || task.sourceVideoExpiresAt > Date.now());
    if (!available) {
      const code = task.sourceVideoUrl ? "TEMPORARY_ORIGINAL_EXPIRED" : "TEMPORARY_ORIGINAL_UNAVAILABLE";
      console.info(JSON.stringify({ type: "download_rejected", at: new Date().toISOString(), requestId: res.locals.requestId, taskId, userId, target: "temporary_original", status: 410, code }));
      return res.status(410).json({ error: task.sourceVideoUrl ? "立即下载入口已失效；原片仍在后台归档或已可高速下载" : "立即下载入口暂不可用；原片仍在后台归档或已可高速下载", code });
    }
    res.setHeader("X-Firefly-Media-Source", "provider");
    console.info(JSON.stringify({ type: "download_redirect", at: new Date().toISOString(), requestId: res.locals.requestId, taskId, userId, target: "temporary_original", status: 302, archivePending: task.mediaStatus !== "ready" }));
    console.info(JSON.stringify({ type: "tos_media_redirect", at: new Date().toISOString(), taskId: task.id, userId: (res.locals.user as SessionUser).id, source: "provider", kind: "temporary_original_download", archivePending: task.mediaStatus !== "ready" }));
    res.redirect(302, task.sourceVideoUrl!);
  } catch (error) {
    console.warn(JSON.stringify({ type: "download_rejected", at: new Date().toISOString(), requestId: res.locals.requestId, taskId, userId, target: "temporary_original", status: 502, code: (error as { code?: string }).code ?? "DOWNLOAD_REDIRECT_FAILED" }));
    respondError(res, error, 502);
  }
});

app.delete("/api/generations/:id", requireAuth, async (req, res) => {
  try {
    const taskId = param(req.params.id);
    const user = res.locals.user as SessionUser;
    if (!users.softDeleteTask(taskId, user.id)) return res.status(404).json({ error: "任务不存在" });
    scheduleTaskCleanup(taskId, {
      findGenerationJob: (id) => generationQueue.getJob(id),
      enqueueMediaDeletion: (id) => mediaQueue.add("delete-task-media", { taskId: id }, { jobId: `delete-${id}`, attempts: 8, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true }),
      reportFailure: (stage, id, error) => console.warn(JSON.stringify({ type: "task_cleanup_handoff_failed", at: new Date().toISOString(), taskId: id, stage, code: (error as { code?: string }).code ?? "unknown" })),
    });
    res.status(204).end();
  } catch (error) { respondError(res, error, 500); }
});

const mediaEventSchema = z.object({
  taskId: z.string().uuid(),
  event: z.enum(["metadata", "canplay", "playing", "waiting", "stalled", "error", "download_click"]),
  elapsedMs: z.number().int().nonnegative().max(24 * 3600 * 1000),
  readyState: z.number().int().min(0).max(4).optional(),
  networkState: z.number().int().min(0).max(3).optional(),
  currentTime: z.number().nonnegative().max(24 * 3600).optional(),
  bufferedAhead: z.number().nonnegative().max(24 * 3600).optional(),
  bufferingMs: z.number().int().nonnegative().max(3600 * 1000).optional(),
  downloadTarget: z.enum(["temporary_original", "tos_original"]).optional(),
});
app.post("/api/media-events", requireAuth, async (req, res) => {
  try {
    const event = mediaEventSchema.parse(req.body);
    const user = res.locals.user as SessionUser;
    const task = await readTask(event.taskId);
    if (!task || !canAccessTask(task, user.id)) return res.status(404).json({ error: "任务不存在或已过期" });
    console.info(JSON.stringify({ type: "media_event", at: new Date().toISOString(), userId: user.id, ...event }));
    res.status(204).end();
  } catch (error) { respondError(res, error); }
});
const localMediaEventSchema = z.object({
  type: z.enum(["local_media_hit", "local_media_miss", "local_media_fetch_started", "local_media_fetch_resumed", "local_media_ready", "local_media_evicted", "local_media_quota_pressure", "local_media_fallback"]),
  cacheKey: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/),
  variant: z.enum(["thumbnail", "preview", "original"]),
  mediaType: z.enum(["image", "video", "audio"]),
  bytes: z.number().int().nonnegative().max(16 * 1024 ** 4).optional(),
  elapsedMs: z.number().int().nonnegative().max(24 * 3600 * 1000).optional(),
  errorCode: z.string().max(64).regex(/^[A-Za-z0-9_.:-]+$/).optional(),
});
app.get("/api/local-media/config", requireAuth, (_req, res) => {
  res.json({
    enabled: config.localMediaCacheEnabled,
    studio: config.localMediaCacheStudio,
    canvas: config.localMediaCacheCanvas,
    atlas: config.localMediaCacheAtlas,
    uploadResume: config.localMediaUploadResume,
  });
});
app.post("/api/local-media-events", requireAuth, async (req, res) => {
  try {
    const event = localMediaEventSchema.parse(req.body);
    const user = res.locals.user as SessionUser;
    const rateKey = `local-media-events:${user.id}:${Math.floor(Date.now() / 60_000)}`;
    const count = await redis.incr(rateKey);
    if (count === 1) await redis.expire(rateKey, 120);
    if (count <= 180) console.info(JSON.stringify({ ...event, type: event.type, at: new Date().toISOString(), userId: user.id, requestId: res.locals.requestId }));
    res.status(204).end();
  } catch (error) { respondError(res, error); }
});

const clientEventSchema = z.object({
  journey: z.enum(journeyNames),
  outcome: z.enum(["success", "failure"]),
  elapsedMs: z.number().int().nonnegative().max(10 * 60_000).optional(),
  taskId: z.string().uuid().optional(),
  route: z.string().max(160).regex(/^\/(?:studio(?:\/.*)?|)$/).optional(),
  component: z.string().max(80).regex(/^[\w .:/-]+$/).optional(),
  errorCode: z.string().max(64).regex(/^[A-Za-z0-9_.:-]+$/).optional(),
  fingerprint: z.string().max(160).optional(),
});
app.post("/api/client-events", requireAuth, async (req, res) => {
  try {
    const event = clientEventSchema.parse(req.body);
    const user = res.locals.user as SessionUser;
    if (event.taskId) {
      const task = await readTask(event.taskId);
      if (!task || !canAccessTask(task, user.id)) return res.status(404).json({ error: "任务不存在或已过期" });
    }
    const rateKey = `client-events:${user.id}:${Math.floor(Date.now() / 60_000)}`;
    const count = await redis.incr(rateKey);
    if (count === 1) await redis.expire(rateKey, 120);
    if (count <= 120) await recordJourneyEvent(redis, { ...event, userId: user.id, requestId: res.locals.requestId });
    res.status(204).end();
  } catch (error) { respondError(res, error); }
});

type ProviderAssetRecord = { Id: string; Name?: string; AssetType?: UserAsset["assetType"]; Status?: UserAsset["status"]; URL?: string; GroupId?: string };
const assetCategories = ["character", "scene", "prop", "material"] as const satisfies readonly AssetCategory[];
const assetCategorySchema = z.enum(assetCategories);
const ownedUserAsset = (assetId: string, ownerId: string) => { const asset = users.readUserAsset(assetId); return asset?.ownerId === ownerId ? asset : null; };
const publicAssetGroupId = "group-firefly-auto-references";
const enqueueProviderAssetDelete = (assetId: string) => {
  const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
  void assetQueue.add("delete-provider", { assetId }, {
    jobId: `delete-${assetId}-${bucket}`,
    attempts: 6,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: true,
    removeOnFail: { age: 7 * 24 * 3600 }
  }).catch((error) => console.warn(JSON.stringify({ type: "asset_provider_delete_enqueue_failed", at: new Date().toISOString(), assetId, code: (error as { code?: string }).code ?? "unknown" })));
};

app.get("/api/assets/groups", requireAuth, (_req, res) => {
  res.json({ Items: [{ Id: publicAssetGroupId, Name: "我的素材", Description: "仅当前用户可见" }] });
});
app.post("/api/assets/groups", requireAuth, (req, res) => {
  try { z.object({ name: z.string().min(1).max(80), description: z.string().max(200).default("") }).parse(req.body); res.status(201).json({ Id: publicAssetGroupId, Name: "我的素材" }); } catch (error) { respondError(res, error); }
});
app.get("/api/assets", requireAuth, async (req, res) => {
  try {
    const query = z.object({ q: z.string().max(80).optional(), type: z.enum(["Image", "Video", "Audio"]).optional(), category: assetCategorySchema.optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(100) }).parse(req.query);
    const user = res.locals.user as SessionUser;
    const assets = users.listUserAssets(user.id, query.q ?? "", query.pageSize + 1, query.type, (query.page - 1) * query.pageSize, query.category);
    const hasMore = assets.length > query.pageSize;
    res.json({ Items: assets.slice(0, query.pageSize).map(publicUserAssetResponse), PageNumber: query.page, PageSize: query.pageSize, HasMore: hasMore });
  } catch (error) { respondError(res, error, 502); }
});
app.post("/api/assets", requireAuth, async (req, res) => {
  let auditUserId: string | null = null;
  let auditUploadId: string | null = null;
  try {
    const body = z.object({ groupId: z.string().startsWith("group-").optional(), url: z.string().url().optional(), uploadId: z.string().min(20).optional(), type: z.enum(["Image", "Video", "Audio"]), name: z.string().min(1).max(180), category: assetCategorySchema.default("material") }).refine((value) => Boolean(value.url || value.uploadId), "素材缺少可用地址").parse(req.body);
    const user = res.locals.user as SessionUser;
    auditUserId = user.id;
    auditUploadId = body.uploadId ?? null;
    // Browser-visible group ids are logical product concepts. Only the worker resolves
    // the actual shared provider group, keeping BytePlus off the interactive path.
    let groupId = body.groupId === publicAssetGroupId ? "" : body.groupId ?? "";
    let url = body.url;
    let assetType = body.type;
    let providerName = providerAssetName(body.name);
    if (body.uploadId) {
      const existing = users.readUserAssetByUpload(user.id, body.uploadId);
      if (existing) return res.status(202).json(publicUserAssetResponse(existing));
      const media = users.readUploadState(body.uploadId);
      if (!canCreatePendingAsset(media, user.id, config.tosInputRetentionDays)) return res.status(404).json({ error: "引用素材不存在或尚未上传完成" });
      assetType = media.contentType.startsWith("video/") ? "Video" : media.contentType.startsWith("audio/") ? "Audio" : "Image";
      providerName = providerAssetName(body.name);
      const now = Date.now();
      const asset: UserAsset = { id: `asset-local-${crypto.randomUUID()}`, ownerId: user.id, groupId, uploadId: body.uploadId, name: body.name, assetType, status: "Processing", category: body.category, createdAt: now, updatedAt: now };
      users.upsertUserAsset(asset);
      const stored = users.readUserAssetByUpload(user.id, body.uploadId);
      if (!stored) throw new Error("素材上传记录未能持久化");
      if (stored.id !== asset.id) return res.status(202).json(publicUserAssetResponse(stored));
      if (users.readUpload(body.uploadId)) {
        void assetQueue.add("register", { assetId: asset.id }, { jobId: asset.id, attempts: 3, backoff: { type: "exponential", delay: 15_000 }, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } }).catch((error) => {
          users.upsertUserAsset({ ...asset, lastError: "素材已上传，生成引用将在后台继续准备", updatedAt: Date.now() });
          console.warn(JSON.stringify({ type: "asset_ingest_enqueue_failed", at: new Date().toISOString(), assetId: asset.id, userId: user.id, code: (error as { code?: string }).code ?? "unknown" }));
        });
      }
      console.info(JSON.stringify({ type: "user_asset_mutation", action: "queue_asset", userId: user.id, assetId: asset.id, at: new Date().toISOString() }));
      return res.status(202).json(publicUserAssetResponse(users.readUserAsset(asset.id)!));
    }
    groupId ||= await ensureAutoReferenceGroup();
    const created = await callAssetApi<ProviderAssetRecord>("CreateAsset", { GroupId: groupId, URL: url, AssetType: assetType, Name: providerName });
    if (!created.Id?.startsWith("asset-")) throw new Error("素材服务未返回有效资产 ID");
    const now = Date.now();
    const asset: UserAsset = { id: created.Id, providerAssetId: created.Id, ownerId: user.id, groupId, name: created.Name ?? providerName, assetType: created.AssetType ?? assetType, status: created.Status ?? "Processing", category: body.category, url: created.URL, createdAt: now, updatedAt: now };
    users.upsertUserAsset(asset);
    console.info(JSON.stringify({ type: "user_asset_mutation", action: "create_asset", userId: user.id, assetId: asset.id, at: new Date().toISOString() }));
    res.status(201).json(publicUserAssetResponse(asset));
  } catch (error) {
    // 素材服务对尺寸不合规素材返回英文错误，翻译为清晰中文提示（兜底，正常在 complete 阶段已被拦截）
    const message = error instanceof Error ? error.message : "";
    if (/between 300px and 6000px|out of range|height.{0,40}(?:300|6000)|width.{0,40}(?:300|6000)/i.test(message)) {
      return res.status(400).json({ error: "图片尺寸不符合官方要求（300–6000px，宽高比 0.4–2.5），请上传符合要求的图片", requestId: res.locals.requestId });
    }
    console.warn(JSON.stringify({ type: "asset_create_failed", at: new Date().toISOString(), userId: auditUserId, uploadId: auditUploadId, message: message.slice(0, 300) }));
    respondError(res, error, 502);
  }
});
app.post("/api/assets/bulk-delete", requireAuth, async (req, res) => {
  try {
    const { ids } = z.object({ ids: z.array(z.string().startsWith("asset-")).min(1).max(50) }).parse(req.body);
    const user = res.locals.user as SessionUser;
    const owned = ids.map((id) => ownedUserAsset(id, user.id));
    if (owned.some((asset) => !asset)) return res.status(404).json({ error: "素材不存在", requestId: res.locals.requestId });
    const blocked = new Set(ids.filter((id) => users.isUserAssetInActiveTask(id, user.id)));
    const deleted: string[] = []; const failed: string[] = [...blocked]; const deletable = ids.filter((id) => !blocked.has(id));
    for (const id of deletable) {
      const asset = ownedUserAsset(id, user.id);
      if (!asset || !users.deleteUserAsset(id, user.id)) { failed.push(id); continue; }
      deleted.push(id);
      if (asset.providerAssetId) enqueueProviderAssetDelete(id);
      else void assetQueue.getJob(id).then((job) => job?.remove()).catch(() => undefined);
    }
    console.info(JSON.stringify({ type: "user_asset_mutation", action: "bulk_delete", userId: user.id, deleted: deleted.length, failed: failed.length, at: new Date().toISOString() }));
    res.json({ deleted, failed });
  } catch (error) { respondError(res, error, 502); }
});
app.get("/api/assets/:id/source", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const asset = ownedUserAsset(param(req.params.id), user.id);
    if (!asset?.uploadId) return res.status(404).json({ error: "素材源文件不存在" });
    const media = users.readUpload(asset.uploadId);
    if (!media || media.ownerId !== user.id || media.status !== "ready") return res.status(404).json({ error: "素材源文件不存在" });
    res.setHeader("Cache-Control", previewRedirectCacheHeader);
    res.setHeader("Vary", "Cookie");
    const process = req.query.variant === "thumbnail" && media.contentType.startsWith("image/")
      ? "image/resize,w_640/format,webp"
      : undefined;
    const target = await stablePreviewUrl({ objectKey: media.objectKey, fileName: media.fileName, process });
    console.info(JSON.stringify({ type: "tos_asset_redirect", at: new Date().toISOString(), assetId: asset.id, userId: user.id }));
    res.redirect(302, target);
  } catch (error) { respondError(res, error, 502); }
});
app.get("/api/assets/:id", requireAuth, async (req, res) => {
  try { const user = res.locals.user as SessionUser; const asset = ownedUserAsset(param(req.params.id), user.id); if (!asset) return res.status(404).json({ error: "素材不存在" }); res.json(publicUserAssetResponse(asset)); } catch (error) { respondError(res, error, 502); }
});
app.patch("/api/assets/:id", requireAuth, async (req, res) => {
  try {
    const body = z.object({ name: z.string().trim().min(1).max(80).optional(), category: assetCategorySchema.optional() }).refine((value) => value.name !== undefined || value.category !== undefined, "没有需要更新的字段").parse(req.body);
    const user = res.locals.user as SessionUser; const id = param(req.params.id);
    const asset = ownedUserAsset(id, user.id);
    if (!asset) return res.status(404).json({ error: "素材不存在" });
    // Firefly metadata is canonical. Provider names are operational only and must not
    // make a local rename wait on, or fail with, an external control-plane request.
    if (body.name !== undefined) users.renameUserAsset(id, user.id, body.name);
    if (body.category !== undefined) users.updateUserAssetCategory(id, user.id, body.category);
    console.info(JSON.stringify({ type: "user_asset_mutation", action: body.name !== undefined ? body.category !== undefined ? "update_asset" : "rename_asset" : "categorize_asset", userId: user.id, assetId: id, at: new Date().toISOString() }));
    res.json(publicUserAssetResponse(users.readUserAsset(id)!));
  } catch (error) { respondError(res, error, 502); }
});
app.delete("/api/assets/:id", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser; const id = param(req.params.id); const asset = ownedUserAsset(id, user.id);
    if (!asset) return res.status(404).json({ error: "素材不存在" });
    if (users.isUserAssetInActiveTask(id, user.id)) return res.status(409).json({ error: "素材正被运行中的任务引用，任务结束后即可删除" });
    if (!users.deleteUserAsset(id, user.id)) return res.status(404).json({ error: "素材不存在" });
    if (asset.providerAssetId) enqueueProviderAssetDelete(id);
    else void assetQueue.getJob(id).then((job) => job?.remove()).catch(() => undefined);
    console.info(JSON.stringify({ type: "user_asset_mutation", action: "delete_asset", userId: user.id, assetId: id, at: new Date().toISOString() }));
    res.status(204).end();
  } catch (error) { respondError(res, error, 500); }
});



// ---- OpenRouter 图片生成 ----
const publicImageGenerationTask = (task: ImageGenerationTask) => publicImageGeneration(task, (mediaId) => {
  const media = users.readMedia(mediaId);
  if (!media || media.ownerId !== task.ownerId || media.kind !== "generated" || media.status !== "ready") return undefined;
  return {
    thumbnail: publicLocalMedia(media, { variant: "thumbnail", url: `/api/image-media/${encodeURIComponent(mediaId)}?variant=thumbnail`, cachePolicy: "warm", transform: "image/resize,w_960/format,webp" }),
    original: publicLocalMedia(media, { variant: "original", url: `/api/image-media/${encodeURIComponent(mediaId)}`, cachePolicy: "warm" }),
  };
});
const imageReferenceSchema = z.union([
  z.string().min(20).max(200),
  z.object({
    id: z.string().min(1).max(200).optional(),
    bindingId: z.string().min(1).max(200),
    uploadId: z.string().min(20).max(200).optional(),
    assetId: z.string().min(1).max(200).optional(),
    snapshotReferenceId: z.string().min(32).max(128).optional(),
    atlasProjectAssetId: z.string().min(1).max(180).optional(),
    name: z.string().min(1).max(180),
    type: z.literal("image").default("image"),
    role: z.literal("reference_image").default("reference_image"),
  }).refine((reference) => Boolean(reference.uploadId || reference.assetId || reference.snapshotReferenceId || reference.atlasProjectAssetId), "参考图缺少可用来源"),
]);
const imageGenerationSchema = z.object({
  requestId: z.string().uuid().optional(),
  sessionId: z.string().min(1).max(200).optional(),
  model: z.string().min(1).max(120),
  ratio: z.enum(IMAGE_RATIOS),
  resolution: z.string().min(1).max(20),
  count: z.number().int().min(1).max(4),
  prompt: z.string().trim().min(1),
  editorPrompt: z.string().optional(),
  references: z.array(imageReferenceSchema).max(4).default([]),
  destination: atlasDestinationSchema.optional(),
});

app.get("/api/image-models", requireAuth, async (_req, res) => {
  res.json({ Items: IMAGE_MODELS, Ratios: IMAGE_RATIOS, DefaultModel: DEFAULT_IMAGE_MODEL });
});

app.get("/api/image-generations", requireAuth, (req, res) => {
  const user = res.locals.user as SessionUser;
  users.failStaleImageGenerations(Date.now() - 6 * 60 * 60_000);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : "";
  if (sessionId) {
    const session = users.readCreationSession(sessionId);
    if (!session || session.ownerId !== user.id) return res.status(404).json({ error: "创作会话不存在" });
    return res.json(users.listImageGenerationsForSession(user.id, sessionId, limit).map(publicImageGenerationTask));
  }
  res.json(users.listImageGenerations(user.id, limit).map(publicImageGenerationTask));
});

app.get("/api/image-generations/:id", requireAuth, (req, res) => {
  const user = res.locals.user as SessionUser;
  const task = users.readImageGeneration(param(req.params.id));
  task && task.ownerId === user.id ? res.json(publicImageGenerationTask(task)) : res.status(404).json({ error: "图片任务不存在" });
});

app.get("/api/image-generations/:id/reedit", requireAuth, (req, res) => {
  const user = res.locals.user as SessionUser;
  const task = users.readImageGeneration(param(req.params.id));
  if (!task || task.ownerId !== user.id) return res.status(404).json({ error: "图片任务不存在或无权访问" });
  if (task.status === "running") return res.status(409).json({ error: "任务仍在生成，请完成后再重新编辑" });
  const startedAt = Date.now();
  trackReeditMetric("started");
  console.info(JSON.stringify({ type: "reedit_started", at: new Date().toISOString(), requestId: res.locals.requestId, taskId: task.id, sourceType: "image", userId: user.id }));
  try {
    ensureImageSnapshot(task);
    const payload = buildImageReeditPayload(task, user.id, MODELS[0]?.id ?? "", config.reeditV2Enabled ? reeditDependencies : legacyReeditDependencies);
    logReeditDiagnostics(payload, res.locals.requestId, user.id);
    console.info(JSON.stringify({ type: payload.recoveryQuality === "exact" ? "reedit_snapshot_loaded" : "reedit_snapshot_partial", at: new Date().toISOString(), requestId: res.locals.requestId, taskId: task.id, sourceType: "image", userId: user.id, bindings: payload.state.assets.length, omitted: payload.omittedAssets, recoveryQuality: payload.recoveryQuality, elapsedMs: Date.now() - startedAt }));
    res.json(payload);
  } catch (error) {
    trackReeditMetric("failed");
    console.error(JSON.stringify({ type: "reedit_failed", at: new Date().toISOString(), requestId: res.locals.requestId, taskId: task.id, sourceType: "image", userId: user.id, code: (error as { code?: string }).code ?? "internal", elapsedMs: Date.now() - startedAt }));
    respondError(res, error, 500);
  }
});

const reeditClientEventSchema = z.object({
  type: z.enum(["reedit_draft_conflict", "reedit_completed", "reedit_failed"]),
  sourceType: z.enum(["video", "image"]), sourceId: z.string().min(1).max(200),
  restoreIntentId: z.string().uuid().optional(), code: z.string().min(1).max(80).optional(),
});
app.post("/api/reedit-events", requireAuth, (req, res) => {
  try {
    const body = reeditClientEventSchema.parse(req.body);
    const user = res.locals.user as SessionUser;
    const source = body.sourceType === "video" ? users.readTask(body.sourceId) : users.readImageGeneration(body.sourceId);
    if (!source || source.ownerId !== user.id) return res.status(404).json({ error: "创作记录不存在或无权访问" });
    console.info(JSON.stringify({ type: body.type, at: new Date().toISOString(), requestId: res.locals.requestId, taskId: body.sourceId, sourceType: body.sourceType, userId: user.id, restoreIntentId: body.restoreIntentId, code: body.code }));
    res.status(204).end();
  } catch (error) { respondError(res, error); }
});

app.delete("/api/image-generations/:id", requireAuth, (req, res) => {
  const user = res.locals.user as SessionUser;
  const taskId = param(req.params.id);
  if (!users.softDeleteImageGeneration(taskId, user.id)) return res.status(404).json({ error: "图片记录不存在" });
  scheduleBestEffort(
    () => mediaQueue.add("reconcile-deletes", {}, { jobId: `image-cleanup-${taskId}`, removeOnComplete: true, removeOnFail: true }),
    (error) => console.warn(JSON.stringify({ type: "image_cleanup_handoff_failed", at: new Date().toISOString(), taskId, code: (error as { code?: string }).code ?? "unknown" })),
  );
  res.status(204).end();
});

app.post("/api/image-generation", requireAuth, async (req, res) => {
  try {
    const body = imageGenerationSchema.parse(req.body);
    if (body.destination && !config.atlasGenerateEnabled) return res.status(404).json({ error: "Atlas生成能力尚未开放", code: "ATLAS_GENERATE_DISABLED" });
    assertPromptLength(body.prompt, "prompt", IMAGE_PROVIDER_PROMPT_MAX_CHARS);
    if (body.editorPrompt !== undefined) assertPromptLength(body.editorPrompt, "editorPrompt", EDITOR_PROMPT_STORAGE_MAX_CHARS);
    const user = res.locals.user as SessionUser;
    const atlasSession = body.destination ? atlasRuntime.projectStore.readGenerationSession(body.destination.projectId, user.id) : undefined;
    if (body.destination && !atlasRuntime.projectStore.readProject(body.destination.projectId, user.id)) return res.status(404).json({ error: "Atlas项目不存在", code: "ATLAS_PROJECT_NOT_FOUND" });
    if (body.destination && !atlasSession) return res.status(409).json({ error: "请重新打开Atlas生成面板", code: "ATLAS_GENERATION_SESSION_REQUIRED" });
    if (body.destination && body.sessionId && body.sessionId !== atlasSession?.sessionId) return res.status(409).json({ error: "Atlas生成会话已变化，请刷新后重试", code: "ATLAS_SESSION_MISMATCH" });
    const requestId = body.requestId ?? crypto.randomUUID();
    const existing = users.readImageGeneration(requestId);
    if (existing) {
      if (existing.ownerId !== user.id) return res.status(409).json({ error: "请求标识已被使用" });
      if (body.destination) {
        if (existing.sessionId !== atlasSession!.sessionId) return res.status(409).json({ error: "Atlas生成会话已变化，请刷新后重试", code: "ATLAS_SESSION_MISMATCH" });
        atlasRuntime.projectStore.createGenerationDestinations({
          ownerId: user.id, projectId: body.destination.projectId, sessionId: atlasSession!.sessionId,
          sourceType: "image", sourceId: existing.id,
          outputs: Array.from({ length: existing.requestedCount }, (_, index) => ({ id: crypto.randomUUID(), outputKey: `image:${index}` })),
          now: Date.now(),
        });
      }
      if (existing.status === "succeeded") return res.json({ Id: existing.id, Items: existing.items, Model: existing.model, Ratio: existing.ratio, Resolution: existing.resolution, Failed: existing.failures });
      if (existing.status === "running") return res.status(202).json({ Id: existing.id, Items: existing.items, Model: existing.model, Ratio: existing.ratio, Resolution: existing.resolution, Failed: existing.failures, Status: "generating" });
      return res.status(409).json({ error: existing.error ?? "该请求未生成成功" });
    }
    const spec = imageModelById(body.model);
    if (!spec) return res.status(400).json({ error: "未知的图片模型" });
    if (body.count > spec.maxCount) return res.status(400).json({ error: "该模型单次最多生成 " + spec.maxCount + " 张" });
    if (body.references.length > spec.maxReferences) return res.status(400).json({ error: "该模型单次最多引用 " + spec.maxReferences + " 张图片" });
    if (!spec.resolutions.includes(body.resolution)) return res.status(400).json({ error: "该模型不支持此分辨率档位" });
    const effectiveSessionId = atlasSession?.sessionId ?? body.sessionId;
    const session = effectiveSessionId ? users.readCreationSession(effectiveSessionId) : null;
    if (effectiveSessionId && (!session || session.ownerId !== user.id)) return res.status(404).json({ error: "创作会话不存在" });
    const activeSession = session ?? createCreationSession(user.id);
    const references: CreationReferenceInput[] = body.references.map((reference, index) => typeof reference === "string"
      ? { id: reference, bindingId: reference, uploadId: reference, name: `参考图 ${index + 1}`, type: "image", role: "reference_image" }
      : reference);
    const queueReferences: { uploadId?: string; snapshotReferenceId?: string; atlasProjectAssetId?: string }[] = [];
    for (const reference of references) {
      if (reference.atlasProjectAssetId) {
        const media = atlasRuntime.projectStore.readAsset(reference.atlasProjectAssetId, user.id);
        if (!media || media.projectId !== body.destination?.projectId || media.status !== "ready" || media.kind !== "image") return res.status(404).json({ error: "Atlas项目图片不存在或尚未就绪" });
        queueReferences.push({ atlasProjectAssetId: media.id });
        continue;
      }
      if (reference.snapshotReferenceId) {
        const stored = users.readCreationSnapshotReference(reference.snapshotReferenceId);
        if (!stored || stored.ownerId !== user.id || stored.status !== "ready" || stored.mediaType !== "image") return res.status(404).json({ error: "参考素材不存在或尚未归档完成" });
        queueReferences.push({ snapshotReferenceId: stored.id });
        continue;
      }
      let uploadId = reference.uploadId;
      if (reference.assetId) {
        const asset = users.readUserAsset(reference.assetId);
        if (!asset || asset.ownerId !== user.id || asset.status !== "Active" || !asset.uploadId) return res.status(404).json({ error: "参考素材不存在或无权访问" });
        uploadId = asset.uploadId;
      }
      const media = uploadId ? users.readUploadState(uploadId) : null;
      if (!uploadId || !canCreatePendingAsset(media, user.id, config.tosInputRetentionDays)) return res.status(404).json({ error: "参考素材不存在或已过期" });
      queueReferences.push({ uploadId });
    }
    if (!openRouterPool().size) return res.status(503).json({ error: "服务端尚未配置 OpenRouter API Key" });
    const startedAt = Date.now();
    const editorPrompt = body.editorPrompt ?? body.prompt;
    const snapshot = buildCreationSnapshot({
      sourceType: "image", sourceId: requestId, ownerId: user.id, sessionId: activeSession.id,
      editorPrompt, parameters: { model: body.model, ratio: body.ratio, resolution: body.resolution, count: body.count },
      references, createdAt: startedAt,
    }, creationSnapshotDependencies);
    // Reference chips expand into provider-visible text. Validate the materialized
    // prompt as the final server-side contract, not only the editor source.
    assertPromptLength(snapshot.snapshot.providerPrompt, "prompt", IMAGE_PROVIDER_PROMPT_MAX_CHARS);
    if (snapshot.references.some((reference) => reference.status === "unavailable")) return res.status(409).json({ error: "有参考素材刚刚失效，请重新选择后提交" });
    const activeTask: ImageGenerationTask = {
      id: requestId, sessionId: activeSession.id, ownerId: user.id, model: body.model, modelName: spec.name, ratio: body.ratio,
      resolution: body.resolution, prompt: snapshot.snapshot.providerPrompt,
      referenceUploadIds: queueReferences.flatMap((reference) => reference.uploadId ? [reference.uploadId] : []), requestedCount: body.count, status: "running",
      items: [], failures: [], createdAt: startedAt, updatedAt: startedAt,
    };
    const payload = {
      ownerId: user.id, model: body.model, prompt: snapshot.snapshot.providerPrompt, ratio: body.ratio,
      resolution: body.resolution, count: body.count, references: queueReferences,
    };
    const intent = { queueName: "image-generation" as const, jobId: requestId, jobName: "generate-image", payload };
    const destinationAdmission = body.destination ? {
      ownerId: user.id, projectId: body.destination.projectId, sessionId: activeSession.id,
      sourceType: "image" as const, sourceId: requestId,
      outputs: Array.from({ length: body.count }, (_, index) => ({ id: crypto.randomUUID(), outputKey: `image:${index}` })),
      now: startedAt,
    } : undefined;
    const admission = users.admitImageGenerationWithinLimit(activeTask, 2, intent, snapshot, destinationAdmission);
    if (admission.status === "limit") return res.status(429).json({ error: "图片生成繁忙，请等当前生成完成后再试（每用户同时最多 2 组）" });
    if (admission.status === "existing") {
      const admitted = admission.task;
      if (admitted.ownerId !== user.id || admitted.deletedAt) return res.status(409).json({ error: "请求标识已被使用" });
      if (body.destination) atlasRuntime.projectStore.createGenerationDestinations({
        ownerId: user.id, projectId: body.destination.projectId, sessionId: activeSession.id,
        sourceType: "image", sourceId: admitted.id,
        outputs: Array.from({ length: admitted.requestedCount }, (_, index) => ({ id: crypto.randomUUID(), outputKey: `image:${index}` })),
        now: Date.now(),
      });
      if (admitted.status === "succeeded") return res.json({ Id: admitted.id, Items: admitted.items, Model: admitted.model, Ratio: admitted.ratio, Resolution: admitted.resolution, Failed: admitted.failures });
      if (admitted.status === "running") return res.status(202).json({ Id: admitted.id, Items: admitted.items, Model: admitted.model, Ratio: admitted.ratio, Resolution: admitted.resolution, Failed: admitted.failures, Status: "generating" });
      return res.status(409).json({ error: admitted.error ?? "该请求未生成成功" });
    }
    enqueueSnapshotPromotions(snapshot);
    users.touchCreationSession(activeSession.id, user.id, snapshot.snapshot.providerPrompt);
    console.info(JSON.stringify({ type: "image_generation_admitted", at: new Date().toISOString(), taskId: activeTask.id, userId: user.id, model: body.model, ratio: body.ratio, resolution: body.resolution, count: body.count, references: references.length, healthyKeys: openRouterPool().healthyCount() }));
    res.status(202).json({ Id: activeTask.id, Items: [], Model: body.model, Ratio: body.ratio, Resolution: body.resolution, Failed: [], Status: "generating" });
  } catch (error) {
    respondError(res, error, 400);
  }
});

app.get("/api/image-media/:id", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const media = users.readMedia(param(req.params.id));
    if (!media || media.ownerId !== user.id || media.kind !== "generated" || media.status !== "ready") return res.status(404).json({ error: "图片不存在" });
    const download = req.query.download === "1";
    res.setHeader("Cache-Control", previewRedirectCacheHeader);
    res.setHeader("Vary", "Cookie");
    const process = !download && req.query.variant === "thumbnail" ? "image/resize,w_960/format,webp" : undefined;
    const target = download
      ? signedObjectUrl(media.objectKey, { download: true, fileName: media.fileName })
      : await stablePreviewUrl({ objectKey: media.objectKey, fileName: media.fileName, process });
    res.redirect(302, target);
  } catch (error) { respondError(res, error, 502); }
});

// ---- Canvas projects ----
const canvasV2EnabledFor = (user: SessionUser) => config.canvasV2Enabled || config.canvasV2Allowlist.includes(user.email.trim().toLowerCase());
app.get("/api/canvas/config", requireAuth, (_req, res) => {
  const user = res.locals.user as SessionUser;
  res.json({ enabled: canvasV2EnabledFor(user) });
});
const canvasListQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) });
const canvasTitleBodySchema = z.object({ title: z.string().trim().min(1, "画布名称不能为空").max(80, "画布名称不能超过 80 个字符") });
const canvasSaveBodySchema = z.object({ revision: z.number().int().min(0), document: canvasDocumentSchema });
const canvasMediaImportSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("generation"), taskId: z.string().min(1).max(120) }),
  z.object({ kind: z.literal("upload"), uploadId: z.string().min(20).max(200) }),
  z.object({ kind: z.literal("generated"), mediaId: z.string().min(1).max(120) }),
  z.object({ kind: z.literal("user_asset"), assetId: z.string().min(1).max(200) }),
]);
const accessibleCanvas = (id: string, userId: string) => {
  const project = users.readCanvasProject(id);
  return project && project.ownerId === userId ? project : null;
};

const canvasAssetKind = (contentType: string): CanvasProjectAsset["kind"] => contentType.startsWith("video/") ? "video" : contentType.startsWith("audio/") ? "audio" : "image";

const recordCanvasProjectAsset = (input: Omit<CanvasProjectAsset, "id" | "createdAt" | "updatedAt">) => {
  const now = Date.now();
  return users.upsertCanvasProjectAsset({ id: `canvas-project-asset-${crypto.randomUUID()}`, ...input, createdAt: now, updatedAt: now });
};

const publicCanvasJob = (job: CanvasJob) => ({
  id: job.id,
  canvasId: job.canvasId,
  nodeId: job.nodeId,
  kind: job.kind,
  status: job.status,
  resultAssetId: job.resultAssetId,
  providerTaskId: job.providerTaskId,
  partialText: job.partialText,
  error: job.error,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

const canvasLeaseBodySchema = z.object({
  clientId: z.string().min(16).max(160),
  takeover: z.boolean().optional(),
  token: z.string().min(32).max(160).optional(),
});

app.post("/api/canvases/:id/lease", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const canvasId = param(req.params.id);
    if (!accessibleCanvas(canvasId, user.id)) return res.status(404).json({ error: "画布不存在" });
    const body = canvasLeaseBodySchema.parse(req.body);
    const result = await acquireCanvasLease({ canvasId, userId: user.id, clientId: body.clientId, takeover: body.takeover });
    res.status(result.acquired ? 200 : 409).json(result);
  } catch (error) { respondError(res, error, 503); }
});

app.put("/api/canvases/:id/lease", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const canvasId = param(req.params.id);
    if (!accessibleCanvas(canvasId, user.id)) return res.status(404).json({ error: "画布不存在" });
    const body = canvasLeaseBodySchema.required({ token: true }).parse(req.body);
    if (!await renewCanvasLease(canvasId, user.id, body.token)) return res.status(409).json({ error: "编辑权已失效" });
    res.status(204).end();
  } catch (error) { respondError(res, error, 503); }
});

app.delete("/api/canvases/:id/lease", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const canvasId = param(req.params.id);
    if (!accessibleCanvas(canvasId, user.id)) return res.status(404).json({ error: "画布不存在" });
    const body = canvasLeaseBodySchema.required({ token: true }).parse(req.body);
    await releaseCanvasLease(canvasId, user.id, body.token);
    res.status(204).end();
  } catch (error) { respondError(res, error, 503); }
});

app.get("/api/canvases", requireAuth, async (req, res) => {
  try {
    const query = canvasListQuerySchema.parse(req.query);
    const user = res.locals.user as SessionUser;
    const projects = users.listCanvasProjects(user.id, query.pageSize + 1, (query.page - 1) * query.pageSize);
    const hasMore = projects.length > query.pageSize;
    res.json({ Items: projects.slice(0, query.pageSize).map(publicCanvasProject), PageNumber: query.page, PageSize: query.pageSize, HasMore: hasMore });
  } catch (error) { respondError(res, error, 502); }
});

app.post("/api/canvases", requireAuth, async (req, res) => {
  try {
    const { title } = z.object({ title: z.string().trim().min(1).max(80).optional() }).parse(req.body);
    const user = res.locals.user as SessionUser;
    const now = Date.now();
    const project: CanvasProject = {
      id: `canvas-${crypto.randomUUID()}`, ownerId: user.id, title: title ?? "未命名画布",
      documentJson: JSON.stringify(canvasV2EnabledFor(user) ? DEFAULT_CANVAS_DOCUMENT : DEFAULT_CANVAS_DOCUMENT_V1), revision: 0, createdAt: now, updatedAt: now
    };
    users.createCanvasProject(project);
    console.info(JSON.stringify({ type: "canvas_mutation", action: "create", userId: user.id, canvasId: project.id, at: new Date().toISOString() }));
    res.status(201).json({ id: project.id, title: project.title });
  } catch (error) { respondError(res, error, 502); }
});

app.get("/api/canvases/:id", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const project = accessibleCanvas(param(req.params.id), user.id);
    if (!project) return res.status(404).json({ error: "画布不存在" });
    res.json(publicCanvasProjectDetail(project));
  } catch (error) { respondError(res, error, 502); }
});

app.put("/api/canvases/:id", requireAuth, async (req, res) => {
  try {
    const { revision, document } = canvasSaveBodySchema.parse(req.body);
    const user = res.locals.user as SessionUser;
    const id = param(req.params.id);
    if (canvasV2EnabledFor(user) && document.version === 2 && !await validateCanvasLease(id, user.id, req.header("x-canvas-lease"))) {
      return res.status(409).json({ error: "画布编辑权已失效，本地草稿已保留", code: "CANVAS_LEASE_LOST" });
    }
    const result = users.updateCanvasProjectDocument(id, user.id, JSON.stringify(document), revision);
    if (result === null) return res.status(404).json({ error: "画布不存在" });
    if (result.status === "conflict") return res.status(409).json({ error: "画布已在其他窗口被修改，已保留最新版本", currentRevision: result.currentRevision });
    const project = users.readCanvasProject(id)!;
    console.info(JSON.stringify({ type: "canvas_mutation", action: "save", userId: user.id, canvasId: id, revision: result.revision, at: new Date().toISOString() }));
    res.json(publicCanvasProjectDetail(project));
  } catch (error) { respondError(res, error, 502); }
});

app.patch("/api/canvases/:id", requireAuth, async (req, res) => {
  try {
    const { title } = canvasTitleBodySchema.parse(req.body);
    const user = res.locals.user as SessionUser;
    const id = param(req.params.id);
    if (!users.renameCanvasProject(id, user.id, title)) return res.status(404).json({ error: "画布不存在" });
    const project = users.readCanvasProject(id)!;
    console.info(JSON.stringify({ type: "canvas_mutation", action: "rename", userId: user.id, canvasId: id, at: new Date().toISOString() }));
    res.json({ id: project.id, title: project.title });
  } catch (error) { respondError(res, error, 502); }
});

app.delete("/api/canvases/:id", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const id = param(req.params.id);
    if (!users.softDeleteCanvasProject(id, user.id)) return res.status(404).json({ error: "画布不存在" });
    mediaQueue.add("delete-canvas-assets", { canvasId: id }, { attempts: 5, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: { age: 24 * 3600 }, removeOnFail: { age: 24 * 3600 } }).catch((error) => console.warn(JSON.stringify({ type: "canvas_asset_cleanup_queue_failed", at: new Date().toISOString(), canvasId: id, code: (error as { code?: string }).code ?? "unknown" })));
    console.info(JSON.stringify({ type: "canvas_mutation", action: "delete", userId: user.id, canvasId: id, at: new Date().toISOString() }));
    res.status(204).end();
  } catch (error) { respondError(res, error, 502); }
});


app.post("/api/canvases/:id/media", requireAuth, async (req, res) => {
  try {
    const body = canvasMediaImportSchema.parse(req.body);
    const user = res.locals.user as SessionUser;
    const canvasId = param(req.params.id);
    if (!accessibleCanvas(canvasId, user.id)) return res.status(404).json({ error: "画布不存在" });
    if (body.kind === "generation") {
      const task = await readTask(body.taskId);
      if (!task || !canAccessTask(task, user.id) || task.status !== "succeeded" || task.mediaStatus !== "ready") return res.status(404).json({ error: "视频副本仍在准备中，请稍后再加入画布", code: "MEDIA_NOT_READY" });
      const media = config.tosPreviewTranscodeEnabled
        ? users.readTaskMedia(task.id, "preview")
        : users.readTaskMedia(task.id, "output") ?? users.readTaskMedia(task.id, "preview");
      if (!media) return res.status(425).json({ error: "成片正在归档，请稍后重试" });
      let width: number | undefined;
      let height: number | undefined;
      let durationMs: number | undefined;
      try {
        const info = await inspectMediaObject(media.objectKey, "video") as { Streams?: { Width?: number; Height?: number; Duration?: number }[]; Format?: { Duration?: number } } | null;
        const stream = info?.Streams?.[0];
        width = stream?.Width ? Number(stream.Width) : undefined;
        height = stream?.Height ? Number(stream.Height) : undefined;
        const seconds = stream?.Duration ?? info?.Format?.Duration;
        durationMs = typeof seconds === "number" && Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
      } catch { /* 元信息读取失败时节点使用默认尺寸 */ }
      const projectAsset = recordCanvasProjectAsset({
        ownerId: user.id,
        canvasId,
        kind: "video",
        sourceType: "generation",
        sourceId: task.id,
        title: task.prompt.slice(0, 80) || "生成视频",
        contentType: media.contentType,
        size: media.size,
        width,
        height,
        durationMs,
        status: "ready",
      });
      console.info(JSON.stringify({ type: "canvas_media_import", kind: "generation", userId: user.id, canvasId, taskId: task.id, width, height, durationMs, at: new Date().toISOString() }));
      res.json({ mediaRef: { source: "project-asset", projectAssetId: projectAsset.id }, projectAsset: publicCanvasProjectAsset(projectAsset), title: task.prompt || "参考素材生成", fileName: media.fileName, width, height, durationMs });
      return;
    }
    if (body.kind === "upload") {
      if (!isAdmissibleCanvasUpload(users.readUploadState(body.uploadId), user.id)) return res.status(404).json({ error: "上传素材不存在或已失效" });
      const v2 = canvasV2EnabledFor(user);
      const asset = v2
        ? prepareCanvasAssetFromUpload({ uploadId: body.uploadId, ownerId: user.id, canvasId })
        : await createCanvasAssetFromUpload({ source: { kind: "upload", uploadId: body.uploadId }, ownerId: user.id, canvasId });
      const projectAsset = recordCanvasProjectAsset({
        ownerId: user.id, canvasId, canvasAssetId: asset.id, kind: canvasAssetKind(asset.contentType), sourceType: "canvas_asset", sourceId: asset.id,
        title: asset.fileName, contentType: asset.contentType, size: asset.size, status: asset.status,
      });
      if (v2) void mediaQueue.add("copy-canvas-asset", { assetId: asset.id }, { jobId: `copy-${asset.id}`, attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } })
        .catch((error) => console.warn(JSON.stringify({ type: "canvas_copy_queue_failed", at: new Date().toISOString(), userId: user.id, canvasId, assetId: asset.id, code: (error as { code?: string }).code ?? "unknown" })));
      console.info(JSON.stringify({ type: "canvas_media_import", kind: "upload", userId: user.id, canvasId, assetId: asset.id, at: new Date().toISOString() }));
      res.status(201).json({ mediaRef: { source: "project-asset", projectAssetId: projectAsset.id }, projectAsset: publicCanvasProjectAsset(projectAsset), title: asset.fileName, fileName: asset.fileName, status: asset.status });
      return;
    }
    if (body.kind === "generated") {
      const media = users.readMedia(body.mediaId);
      if (!media || media.ownerId !== user.id || media.kind !== "generated" || media.status !== "ready") return res.status(404).json({ error: "生成图片不存在或尚未就绪" });
      if (canvasV2EnabledFor(user)) {
        const projectAsset = recordCanvasProjectAsset({ ownerId: user.id, canvasId, kind: "image", sourceType: "generated", sourceId: media.id, title: media.fileName, contentType: media.contentType, size: media.size, status: "ready" });
        res.status(201).json({ mediaRef: { source: "project-asset", projectAssetId: projectAsset.id }, projectAsset: publicCanvasProjectAsset(projectAsset), title: media.fileName, fileName: media.fileName, status: projectAsset.status });
        return;
      }
      const asset = await createCanvasAssetFromUpload({ source: { kind: "object", objectKey: media.objectKey, fileName: media.fileName, contentType: media.contentType, ownerId: media.ownerId }, ownerId: user.id, canvasId });
      const projectAsset = recordCanvasProjectAsset({
        ownerId: user.id, canvasId, canvasAssetId: asset.id, kind: "image", sourceType: "canvas_asset", sourceId: asset.id,
        title: asset.fileName, contentType: asset.contentType, size: asset.size, status: asset.status,
      });
      console.info(JSON.stringify({ type: "canvas_media_import", kind: "generated", userId: user.id, canvasId, mediaId: media.id, assetId: asset.id, at: new Date().toISOString() }));
      res.status(201).json({ mediaRef: { source: "project-asset", projectAssetId: projectAsset.id }, projectAsset: publicCanvasProjectAsset(projectAsset), title: asset.fileName, fileName: asset.fileName, status: asset.status });
      return;
    }
    if (body.kind === "user_asset") {
      const asset = users.readUserAsset(body.assetId);
      if (!asset || asset.ownerId !== user.id || asset.status !== "Active") return res.status(404).json({ error: "素材不存在或尚未就绪" });
      const source = asset.uploadId ? users.readUpload(asset.uploadId) : null;
      if (!source || source.ownerId !== user.id || source.status !== "ready") return res.status(409).json({ error: "该素材缺少可供画布使用的原始文件" });
      const projectAsset = recordCanvasProjectAsset({
        ownerId: user.id, canvasId, kind: canvasAssetKind(source.contentType), sourceType: "user_asset", sourceId: asset.id,
        title: asset.name, contentType: source.contentType, size: source.size, status: "ready",
      });
      res.status(201).json({ mediaRef: { source: "project-asset", projectAssetId: projectAsset.id }, projectAsset: publicCanvasProjectAsset(projectAsset), title: projectAsset.title, fileName: source.fileName, status: projectAsset.status });
    }
  } catch (error) { respondError(res, error, 502); }
});

app.get("/api/canvases/:id/assets", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const canvasId = param(req.params.id);
    if (!accessibleCanvas(canvasId, user.id)) return res.status(404).json({ error: "画布不存在" });
    const query = z.object({ before: z.coerce.number().int().positive().optional(), beforeId: z.string().min(1).max(128).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    const items = users.listCanvasProjectAssets(canvasId, user.id, query.limit + 1, query.before ?? Number.MAX_SAFE_INTEGER, query.beforeId ?? "\uffff");
    const page = items.slice(0, query.limit);
    const pageEnd = page.at(-1);
    res.json({ Items: page.map(publicCanvasProjectAsset), HasMore: items.length > query.limit, NextBefore: pageEnd?.createdAt, NextBeforeId: pageEnd?.id });
  } catch (error) { respondError(res, error, 502); }
});

app.post("/api/canvases/:id/assets/import", requireAuth, (req, res) => {
  res.redirect(307, `/api/canvases/${encodeURIComponent(param(req.params.id))}/media`);
});

app.get("/api/canvas-project-assets/:id/media", requireAuth, createCanvasProjectMediaHandler({
  readAsset: (id) => users.readCanvasProjectAsset(id),
  canAccessCanvas: (canvasId, userId) => Boolean(accessibleCanvas(canvasId, userId)),
  signedUrl: canvasProjectAssetSignedUrl,
  cacheControl: previewRedirectCacheHeader,
}));

const canvasJobBaseSchema = z.object({ nodeId: z.string().min(1).max(120), revision: z.number().int().min(0) });
const canvasJobCreateSchema = z.discriminatedUnion("kind", [
  canvasJobBaseSchema.extend({ kind: z.literal("text"), payload: z.object({ instruction: z.string().trim().min(1).max(20_000) }) }),
  canvasJobBaseSchema.extend({ kind: z.literal("image"), payload: z.object({ prompt: z.string().trim().min(1).max(IMAGE_PROVIDER_PROMPT_MAX_CHARS), model: z.string().min(1).max(120), ratio: z.string().min(1).max(20), resolution: z.string().min(1).max(20), referenceAssetIds: z.array(z.string().min(1).max(180)).max(30).default([]) }) }),
  canvasJobBaseSchema.extend({ kind: z.literal("character_tool"), payload: z.object({ tool: z.enum(["turnaround", "closeup", "expressions", "portrait"]), prompt: z.string().trim().min(1).max(IMAGE_PROVIDER_PROMPT_MAX_CHARS), model: z.string().min(1).max(120), ratio: z.string().min(1).max(20), resolution: z.string().min(1).max(20), referenceAssetIds: z.array(z.string().min(1).max(180)).max(30).default([]) }) }),
  canvasJobBaseSchema.extend({ kind: z.literal("video"), payload: z.object({ generation: z.record(z.unknown()), references: z.array(z.object({ assetId: z.string().min(1).max(180), role: z.enum(["reference_image", "reference_video", "reference_audio", "first_frame", "last_frame"]) })).max(50).default([]) }) }),
]);

const canvasContextForNode = (canvasId: string, ownerId: string, nodeId: string) => {
  const project = accessibleCanvas(canvasId, ownerId);
  if (!project) return null;
  const parsed = parseCanvasDocumentSafe(project.documentJson);
  const document = parsed ? toCanvasDocumentV2(parsed) : null;
  if (!document) return null;
  const context = resolveCanvasContext(document, nodeId);
  return context ? { project, document, ...context } : null;
};

const ownedCanvasProjectAssets = (canvasId: string, ownerId: string, ids: string[]) => [...new Set(ids)].map((id) => {
  const asset = users.readCanvasProjectAsset(id);
  if (!asset || asset.canvasId !== canvasId || asset.ownerId !== ownerId || asset.status !== "ready") throw new Error("参考素材不存在或尚未就绪");
  return asset;
});

const characterToolPrompts = {
  turnaround: "保持同一角色身份、服装、发型与身体比例，生成正面、侧面、背面三视图；使用中性站姿、统一尺度和简洁背景，禁止重复人物与身份漂移。",
  closeup: "保持同一角色身份与关键五官，生成具有清晰眼神、皮肤质感和可控景深的面部特写；不得改变年龄、发型或服装设定。",
  expressions: "保持同一角色身份与构图尺度，生成 3×3 表情九宫格，覆盖喜悦、悲伤、愤怒、惊讶、恐惧、厌恶、平静、疑惑与坚定；每格只改变表情。",
  portrait: "保持同一角色身份和关键造型，生成可用于后续镜头引用的高一致性人物肖像，轮廓清楚、面部无遮挡、光线自然。",
} as const;

app.post("/api/canvases/:id/jobs", requireAuth, async (req, res) => {
  try {
    const body = canvasJobCreateSchema.parse(req.body);
    const user = res.locals.user as SessionUser;
    if (!canvasV2EnabledFor(user)) return res.status(404).json({ error: "Canvas V2 尚未启用" });
    const canvasId = param(req.params.id);
    const context = canvasContextForNode(canvasId, user.id, body.nodeId);
    if (!context) return res.status(404).json({ error: "画布或目标节点不存在" });
    if (context.project.revision !== body.revision) return res.status(409).json({ error: "请先保存画布的最新改动", currentRevision: context.project.revision });
    const now = Date.now();
    const canvasJob: CanvasJob = {
      id: `canvas-job-${crypto.randomUUID()}`, ownerId: user.id, canvasId, nodeId: body.nodeId, kind: body.kind,
      status: "queued", payload: body.payload, partialText: "", createdAt: now, updatedAt: now,
    };

    if (body.kind === "text") {
      const payload = { canvasJobId: canvasJob.id, kind: "text" as const, payload: { instruction: body.payload.instruction, currentText: context.target.data.markdown ?? "", context: context.text } };
      users.createCanvasJobWithOutbox(canvasJob, { queueName: "canvas-jobs", jobId: canvasJob.id, jobName: "text", payload });
      return res.status(202).json(publicCanvasJob(canvasJob));
    }

    if (body.kind === "image" || body.kind === "character_tool") {
      const references = ownedCanvasProjectAssets(canvasId, user.id, [...context.assetIds, ...body.payload.referenceAssetIds]);
      const prompt = [context.text, body.kind === "character_tool" ? characterToolPrompts[body.payload.tool] : "", body.payload.prompt].filter(Boolean).join("\n\n");
      assertPromptLength(prompt, "prompt", IMAGE_PROVIDER_PROMPT_MAX_CHARS);
      const payload = { canvasJobId: canvasJob.id, kind: body.kind, payload: { prompt, model: body.payload.model, ratio: body.payload.ratio, resolution: body.payload.resolution, referenceAssetIds: references.map((asset) => asset.id) } };
      const intent = { queueName: "canvas-jobs" as const, jobId: canvasJob.id, jobName: body.kind, payload };
      if (!users.createCanvasImageJobWithinLimit(canvasJob, 2, intent)) return res.status(429).json({ error: "你已有 2 个图片任务正在处理，请等待其中一个完成" });
      return res.status(202).json(publicCanvasJob(canvasJob));
    }

    const references = body.payload.references.length ? body.payload.references : ownedCanvasProjectAssets(canvasId, user.id, context.assetIds).map((asset) => ({ assetId: asset.id, role: asset.kind === "video" ? "reference_video" as const : asset.kind === "audio" ? "reference_audio" as const : "reference_image" as const }));
    const referenceAssets = ownedCanvasProjectAssets(canvasId, user.id, references.map((item) => item.assetId));
    const byId = new Map(referenceAssets.map((asset) => [asset.id, asset]));
    const generationAssets = references.map((reference) => {
      const asset = byId.get(reference.assetId)!;
      const type = asset.kind;
      if ((reference.role === "first_frame" || reference.role === "last_frame") && type !== "image") throw new Error("首帧和尾帧只能引用图片素材");
      return { id: asset.id, type, role: reference.role, canvasProjectAssetId: asset.id, name: asset.title };
    });
    const input = validateGeneration({ ...body.payload.generation, prompt: [context.text, String(body.payload.generation.prompt ?? "")].filter(Boolean).join("\n\n"), assets: generationAssets });
    const taskId = crypto.randomUUID();
    const task: StoredTask = { id: taskId, ownerId: user.id, visibility: "private", status: "queued", mediaStatus: "none", mediaRevision: 0, prompt: input.prompt, model: input.model, mode: input.mode, ratio: input.ratio, resolution: input.resolution, duration: input.duration, request: input, createdAt: now, updatedAt: now };
    const linkedCanvasJob = { ...canvasJob, providerTaskId: taskId };
    const intent = { queueName: "generation" as const, jobId: taskId, jobName: "generate", payload: { input } };
    if (!users.createCanvasVideoJobWithinLimit(task, linkedCanvasJob, config.maxActiveGenerationsPerUser, intent)) return res.status(429).json({ error: `你已有 ${config.maxActiveGenerationsPerUser} 个任务正在生成，请稍后再试` });
    res.status(202).json(publicCanvasJob(users.readCanvasJob(canvasJob.id)!));
  } catch (error) { respondError(res, error, 502); }
});

app.get("/api/canvases/:id/jobs", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const canvasId = param(req.params.id);
    if (!accessibleCanvas(canvasId, user.id)) return res.status(404).json({ error: "画布不存在" });
    const query = z.object({ updatedAfter: z.coerce.number().int().nonnegative().default(0) }).parse(req.query);
    res.json({ Items: users.listCanvasJobs(canvasId, user.id, query.updatedAfter).map(publicCanvasJob) });
  } catch (error) { respondError(res, error, 502); }
});

app.get("/api/canvases/:id/jobs/:jobId", requireAuth, async (req, res) => {
  const user = res.locals.user as SessionUser;
  const canvasId = param(req.params.id);
  const job = users.readCanvasJob(param(req.params.jobId));
  if (!job || job.canvasId !== canvasId || job.ownerId !== user.id || !accessibleCanvas(canvasId, user.id)) return res.status(404).json({ error: "画布任务不存在" });
  res.json(publicCanvasJob(job));
});

app.get("/api/canvases/:id/events", requireAuth, async (req, res) => {
  const user = res.locals.user as SessionUser;
  const canvasId = param(req.params.id);
  if (!accessibleCanvas(canvasId, user.id)) return res.status(404).json({ error: "画布不存在" });
  const updatedAfter = Number(req.header("last-event-id") ?? req.query.updatedAfter ?? 0) || 0;
  const subscriber = redis.duplicate({ maxRetriesPerRequest: 1, connectTimeout: 3_000, commandTimeout: 3_000 });
  const channel = `canvas:events:${canvasId}`;
  let heartbeat: NodeJS.Timeout | undefined;
  let closed = false;
  const closeSubscriber = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    subscriber.disconnect(false);
  };
  res.once("close", closeSubscriber);
  subscriber.on("error", () => undefined);
  subscriber.on("message", (_channel, message) => {
    try {
      const event = JSON.parse(message) as { type?: string; job?: CanvasJob };
      if (event.job?.ownerId === user.id) res.write(`id: ${event.job.updatedAt}\nevent: ${event.type ?? "message"}\ndata: ${JSON.stringify(publicCanvasJob(event.job))}\n\n`);
    } catch { /* 丢弃无法解析的内部事件 */ }
  });
  try {
    await withinDeadline(subscriber.subscribe(channel), 4_000);
  } catch {
    subscriber.disconnect(false);
    if (closed) return;
    if (!res.headersSent) return res.status(503).json({ error: "实时更新暂时不可用，请稍后重试", requestId: res.locals.requestId });
    if (!res.writableEnded) res.end();
    return;
  }
  if (closed) return;
  subscriber.once("close", () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  });
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15_000);
  // Subscribe before replaying durable rows so an event cannot fall into the
  // gap between the SQLite snapshot and Redis subscription. Replaying the
  // previous millisecond may duplicate an event but can never lose one.
  for (const job of users.listCanvasJobs(canvasId, user.id, Math.max(0, updatedAfter - 1))) res.write(`id: ${job.updatedAt}\nevent: canvas_job\ndata: ${JSON.stringify(publicCanvasJob(job))}\n\n`);
});

app.post("/api/canvases/:id/jobs/:jobId/cancel", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const canvasId = param(req.params.id);
    const job = users.readCanvasJob(param(req.params.jobId));
    if (!job || job.canvasId !== canvasId || job.ownerId !== user.id || !accessibleCanvas(canvasId, user.id)) return res.status(404).json({ error: "画布任务不存在" });
    if (["succeeded", "failed", "cancelled"].includes(job.status)) return res.json(publicCanvasJob(job));
    const cancellation = users.cancelCanvasJob(job.id);
    const cancelled = cancellation.job;
    if (!cancelled) return res.status(404).json({ error: "画布任务不存在" });
    if (cancellation.changed) {
      scheduleBestEffort(() => canvasQueue.getJob(job.id).then((queued) => queued?.remove()), () => undefined);
      if (job.kind === "image" || job.kind === "character_tool") {
        const mediaId = canvasGeneratedMediaId(job.id);
        if (users.markUnreferencedGeneratedMediaForDeletion(mediaId, user.id)) {
          scheduleBestEffort(() => mediaQueue.add("reconcile-deletes", {}, { jobId: `canvas-generated-cleanup-${mediaId}`, removeOnComplete: true, removeOnFail: true }), () => undefined);
        }
      }
      if (job.providerTaskId) {
        const task = await readTask(job.providerTaskId, true);
        if (task && task.ownerId === user.id) {
          users.softDeleteCanvasProjectAssetBySource(canvasId, user.id, "generation", task.id);
          users.softDeleteTask(task.id, user.id);
          scheduleTaskCleanup(task.id, {
            findGenerationJob: (id) => generationQueue.getJob(id),
            enqueueMediaDeletion: (id) => mediaQueue.add("delete-task-media", { taskId: id }, { jobId: `delete-${id}`, attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true }),
            reportFailure: () => undefined,
          });
        }
      }
    }
    scheduleBestEffort(() => redis.publish(`canvas:events:${canvasId}`, JSON.stringify({ type: "canvas_job", job: cancelled })), () => undefined);
    res.json(publicCanvasJob(cancelled));
  } catch (error) { respondError(res, error, 502); }
});

const montageClipSchema = z.object({
  id: z.string().min(1).max(160),
  projectAssetId: z.string().min(1).max(180),
  startMs: z.number().int().nonnegative().max(600_000),
  durationMs: z.number().int().positive().max(600_000),
  trimStartMs: z.number().int().nonnegative().default(0),
  trimEndMs: z.number().int().nonnegative().default(0),
  muted: z.boolean().default(false),
});
const montageTimelineSchema = z.object({
  video: z.array(montageClipSchema).max(500),
  audio: z.array(montageClipSchema.omit({ muted: true })).max(100).default([]),
  settings: z.object({ width: z.number().int().min(320).max(1920), height: z.number().int().min(240).max(1080), fps: z.number().int().min(1).max(30) }),
}).superRefine((timeline, context) => {
  const effectiveDuration = (clip: { durationMs: number; trimStartMs: number; trimEndMs: number }) => clip.durationMs - clip.trimStartMs - clip.trimEndMs;
  const end = Math.max(0, ...timeline.video.map((clip) => clip.startMs + effectiveDuration(clip)), ...timeline.audio.map((clip) => clip.startMs + effectiveDuration(clip)));
  if (end > 600_000) context.addIssue({ code: z.ZodIssueCode.custom, message: "Montage 最长支持 10 分钟" });
  if ([...timeline.video, ...timeline.audio].some((clip) => clip.trimStartMs + clip.trimEndMs >= clip.durationMs)) context.addIssue({ code: z.ZodIssueCode.custom, message: "素材裁剪范围无效" });
});

const validateMontageAssets = (canvasId: string, ownerId: string, timeline: z.infer<typeof montageTimelineSchema>) => {
  const video = ownedCanvasProjectAssets(canvasId, ownerId, timeline.video.map((clip) => clip.projectAssetId));
  if (video.some((asset) => asset.kind !== "video")) throw new Error("视频轨只能使用视频素材");
  const audio = ownedCanvasProjectAssets(canvasId, ownerId, timeline.audio.map((clip) => clip.projectAssetId));
  if (audio.some((asset) => asset.kind !== "audio")) throw new Error("音频轨只能使用音频素材");
};

app.post("/api/canvases/:id/montages", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const canvasId = param(req.params.id);
    if (!accessibleCanvas(canvasId, user.id)) return res.status(404).json({ error: "画布不存在" });
    const timeline = montageTimelineSchema.parse(req.body.timeline);
    validateMontageAssets(canvasId, user.id, timeline);
    const now = Date.now();
    const montage = { id: `canvas-montage-${crypto.randomUUID()}`, ownerId: user.id, canvasId, revision: 0, timeline, createdAt: now, updatedAt: now };
    users.createCanvasMontage(montage);
    res.status(201).json(montage);
  } catch (error) { respondError(res, error, 502); }
});

app.get("/api/canvases/:id/montages", requireAuth, async (req, res) => {
  const user = res.locals.user as SessionUser;
  const canvasId = param(req.params.id);
  if (!accessibleCanvas(canvasId, user.id)) return res.status(404).json({ error: "画布不存在" });
  res.json({ Items: users.listCanvasMontages(canvasId, user.id) });
});

app.put("/api/canvases/:id/montages/:montageId", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const canvasId = param(req.params.id);
    const montage = users.readCanvasMontage(param(req.params.montageId));
    if (!montage || montage.canvasId !== canvasId || montage.ownerId !== user.id || !accessibleCanvas(canvasId, user.id)) return res.status(404).json({ error: "Montage 不存在" });
    const body = z.object({ revision: z.number().int().nonnegative(), timeline: montageTimelineSchema }).parse(req.body);
    validateMontageAssets(canvasId, user.id, body.timeline);
    const updated = users.updateCanvasMontage(montage.id, user.id, body.revision, body.timeline);
    if (!updated) return res.status(409).json({ error: "Montage 已在其他窗口被修改", currentRevision: users.readCanvasMontage(montage.id)?.revision });
    res.json(updated);
  } catch (error) { respondError(res, error, 502); }
});

const canvasExportPartSize = 16 * 1024 * 1024;
app.post("/api/canvases/:id/montages/:montageId/exports", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const canvasId = param(req.params.id);
    const montage = users.readCanvasMontage(param(req.params.montageId));
    if (!montage || montage.canvasId !== canvasId || montage.ownerId !== user.id || !accessibleCanvas(canvasId, user.id)) return res.status(404).json({ error: "Montage 不存在" });
    const { fileSize } = z.object({ fileSize: z.number().int().positive().max(8 * 1024 * 1024 * 1024) }).parse(req.body);
    const exportId = `canvas-export-${crypto.randomUUID()}`;
    const objectKey = canvasExportObjectKey(user.id, canvasId, exportId);
    const tosUploadId = await createMultipartUpload(objectKey, "video/mp4", "montage.mp4");
    const now = Date.now();
    const record = users.createCanvasExport({ id: exportId, ownerId: user.id, canvasId, montageId: montage.id, status: "uploading" as const, objectKey, tosUploadId, parts: [], createdAt: now, updatedAt: now });
    const partCount = Math.ceil(fileSize / canvasExportPartSize);
    const firstParts = Array.from({ length: Math.min(partCount, 20) }, (_, index) => ({ partNumber: index + 1, url: signUploadPart(objectKey, tosUploadId, index + 1) }));
    res.status(201).json({ id: record.id, status: record.status, partSize: canvasExportPartSize, partCount, parts: firstParts });
  } catch (error) { respondError(res, error, 502); }
});

app.post("/api/canvases/:id/exports/:exportId/parts/sign", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const canvasId = param(req.params.id);
    const record = users.readCanvasExport(param(req.params.exportId));
    if (!record || record.canvasId !== canvasId || record.ownerId !== user.id || record.status !== "uploading" || !record.tosUploadId || !accessibleCanvas(canvasId, user.id)) return res.status(404).json({ error: "导出任务不存在" });
    const { partNumbers } = z.object({ partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(50) }).parse(req.body);
    res.json({ parts: [...new Set(partNumbers)].map((partNumber) => ({ partNumber, url: signUploadPart(record.objectKey, record.tosUploadId!, partNumber) })) });
  } catch (error) { respondError(res, error, 502); }
});

app.post("/api/canvases/:id/exports/:exportId/complete", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const canvasId = param(req.params.id);
    const record = users.readCanvasExport(param(req.params.exportId));
    if (!record || record.canvasId !== canvasId || record.ownerId !== user.id || record.status !== "uploading" || !record.tosUploadId || !accessibleCanvas(canvasId, user.id)) return res.status(404).json({ error: "导出任务不存在" });
    const body = z.object({ parts: z.array(z.object({ partNumber: z.number().int().min(1).max(10_000), etag: z.string().trim().min(1).max(200) })).min(1).max(10_000) }).parse(req.body);
    const numbers = body.parts.map((part) => part.partNumber);
    if (new Set(numbers).size !== numbers.length || numbers.some((number, index) => number !== index + 1)) throw new Error("导出分片必须从 1 开始连续且不可重复");
    users.updateCanvasExport(record.id, { status: "verifying", parts: body.parts, error: null });
    try {
      await completeMultipartUpload(record.objectKey, record.tosUploadId, body.parts.map((part) => ({ partNumber: part.partNumber, eTag: part.etag.replace(/^\"|\"$/g, "") })));
      const head = await verifyStoredObject(record.objectKey, "video/mp4");
      const headData = head.data as unknown as { contentLength?: number };
      const headers = head.headers as Record<string, string | undefined>;
      const size = Number(headData.contentLength ?? headers["content-length"] ?? 0);
      const now = Date.now();
      const montage = users.readCanvasMontage(record.montageId);
      const timeline = montageTimelineSchema.parse(montage?.timeline);
      const durationMs = Math.max(0, ...timeline.video.map((clip) => clip.startMs + clip.durationMs - clip.trimStartMs - clip.trimEndMs));
      const projectAsset = recordCanvasProjectAsset({ ownerId: user.id, canvasId, kind: "video", sourceType: "montage", sourceId: record.id, title: "Montage 导出", contentType: "video/mp4", size, width: timeline.settings.width, height: timeline.settings.height, durationMs, status: "ready" });
      const completed = users.updateCanvasExport(record.id, { status: "ready", parts: body.parts, resultAssetId: projectAsset.id, error: null })!;
      res.json({ id: completed.id, status: completed.status, projectAsset: publicCanvasProjectAsset(projectAsset) });
    } catch (error) {
      users.updateCanvasExport(record.id, { status: "failed", error: error instanceof Error ? error.message.slice(0, 500) : "导出校验失败" });
      throw error;
    }
  } catch (error) { respondError(res, error, 502); }
});

app.delete("/api/canvases/:id/exports/:exportId", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const canvasId = param(req.params.id);
    const record = users.readCanvasExport(param(req.params.exportId));
    if (!record || record.canvasId !== canvasId || record.ownerId !== user.id || !accessibleCanvas(canvasId, user.id)) return res.status(404).json({ error: "导出任务不存在" });
    if (record.status === "ready") return res.status(409).json({ error: "已完成的导出请从项目资产中管理" });
    if (record.tosUploadId) await abortMultipartUpload(record.objectKey, record.tosUploadId).catch(() => undefined);
    users.updateCanvasExport(record.id, { status: "cancelled", error: null });
    res.status(204).end();
  } catch (error) { respondError(res, error, 502); }
});

app.get("/api/canvas-media/:assetId", requireAuth, createCanvasMediaHandler({
  readCanvasAsset: (assetId) => users.readCanvasAsset(assetId),
  signedObjectUrl: (objectKey, options) => stablePreviewUrl({ objectKey, fileName: options.fileName }),
  cacheControl: previewRedirectCacheHeader
}));

atlasRuntime = createAtlasRuntime({
  requireAuth,
  agentQueue: atlasAgentQueue,
  enqueueMediaDelete: async (objectKey, jobId) => {
    await mediaQueue.add("delete-atlas-object", { objectKey }, {
      jobId, attempts: 8, backoff: { type: "exponential", delay: 5_000, jitter: 0.5 },
      removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 },
    });
  },
});
// Agent middleware is path-scoped, so unmatched core routes fall through
// without a second authentication pass or an optional-feature gate.
app.use("/api/atlas", atlasRuntime.agentRouter);
app.use("/api/atlas", atlasRuntime.projectRouter);

const tosHealthGate = new DependencyHealthGate({ configured: tosConfigured(), failureThreshold: 3, successGraceMs: 5 * 60_000 });
let tosProbeInFlight: Promise<void> | undefined;
const probeTos = () => {
  if (tosProbeInFlight) return tosProbeInFlight;
  const run = tosHealth()
    .then((result) => tosHealthGate.record(result))
    .catch(() => tosHealthGate.record({ configured: tosConfigured(), reachable: false }))
    .finally(() => { if (tosProbeInFlight === run) tosProbeInFlight = undefined; });
  tosProbeInFlight = run;
  return run;
};

const runtimeIdentity = { revision: config.revision, imageDigest: config.imageDigest };
const workerReadinessRequiredAt = Date.now() + config.workerReadinessGraceMs;

app.get("/api/health/live", (_req, res) => res.json({ status: "ok", ...runtimeIdentity }));

app.get("/api/health/workers", async (_req, res) => {
  try {
    const health = await readWorkerHealth(redis);
    res.status(health.ready ? 200 : 503).json({ status: health.ready ? "ready" : "not_ready", ...health, ...runtimeIdentity });
  } catch (error) {
    res.status(503).json({ status: "not_ready", dependency: "redis", code: (error as { code?: string }).code ?? "unknown", ...runtimeIdentity });
  }
});

app.get("/api/health/ready", async (_req, res) => {
  let dependency: "redis" | "database" | "reedit" | "queues" | "workers" | "tos" | "atlas_static" = "redis";
  let workerHealth: WorkerHealthSnapshot | undefined;
  try {
    await redis.ping();
    dependency = "database";
    if (!users.healthCheck()) throw new Error("database unavailable");
    dependency = "reedit";
    checkReeditIntegrity();
    dependency = "queues";
    await Promise.all([generationQueue.getJobCounts("wait", "active"), imageGenerationQueue.getJobCounts("wait", "active"), archiveQueue.getJobCounts("wait", "active"), mediaQueue.getJobCounts("wait", "active"), previewQueue.getJobCounts("wait", "active"), assetQueue.getJobCounts("wait", "active"), canvasQueue.getJobCounts("wait", "active"), uploadFinalizationQueue.getJobCounts("wait", "active"), atlasAgentQueue.getJobCounts("wait", "active")]);
    dependency = "workers";
    workerHealth = await readWorkerHealth(redis);
    if (!workerHealth.ready && Date.now() >= workerReadinessRequiredAt) throw new Error(`workers unavailable: ${workerHealth.missing.join(",")}`);
    if (config.atlasEnabled) {
      dependency = "atlas_static";
      await verifyAtlasStaticBundle();
    }
    if (tosEnabled()) {
      dependency = "tos";
      const health = tosHealthGate.snapshot();
      if (!health.configured || !health.effectiveReachable) throw new Error("TOS unavailable");
    }
    res.json({ status: "ready", redis: "ok", database: "ok", queues: "ok", workers: workerHealth.ready ? "ok" : "starting", tos: tosEnabled() ? "ok" : "disabled", atlasStatic: config.atlasEnabled ? "ok" : "disabled", asyncJobs: users.asyncJobOutboxStats(), previewTranscodeEnabled: config.tosPreviewTranscodeEnabled, schemaVersion: users.schemaVersion(), ...runtimeIdentity });
  } catch (error) {
    const tosHealthSnapshot = tosHealthGate.snapshot();
    console.warn(JSON.stringify({ type: "readiness_failed", at: new Date().toISOString(), dependency, code: (error as { code?: string }).code ?? "unknown", tosConsecutiveFailures: tosHealthSnapshot.consecutiveFailures, tosLastProbeReachable: tosHealthSnapshot.lastProbeReachable }));
    res.status(503).json({ status: "not_ready", dependency, missingWorkers: workerHealth?.missing, tosConsecutiveFailures: tosHealthSnapshot.consecutiveFailures, ...runtimeIdentity });
  }
});

app.get("/api/health", async (_req, res) => {
  const tosHealthSnapshot = tosHealthGate.snapshot();
  try {
    await redis.ping();
    if (!users.healthCheck()) throw new Error("database unavailable");
    res.json({ status: "ok", redis: "ok", database: "ok", schemaVersion: users.schemaVersion(), asyncJobs: users.asyncJobOutboxStats(), tosConfigured: tosHealthSnapshot.configured, tosReachable: tosHealthSnapshot.effectiveReachable, tosLastProbeReachable: tosHealthSnapshot.lastProbeReachable, tosCheckedAt: tosHealthSnapshot.checkedAt, tosLastSuccessfulAt: tosHealthSnapshot.lastSuccessfulAt, tosConsecutiveFailures: tosHealthSnapshot.consecutiveFailures, previewTranscodeEnabled: config.tosPreviewTranscodeEnabled, ...runtimeIdentity });
  } catch { res.status(503).json({ status: "degraded", redis: "unavailable", database: "unavailable", tosConfigured: tosHealthSnapshot.configured, tosReachable: tosHealthSnapshot.effectiveReachable, tosLastProbeReachable: tosHealthSnapshot.lastProbeReachable, tosCheckedAt: tosHealthSnapshot.checkedAt, tosLastSuccessfulAt: tosHealthSnapshot.lastSuccessfulAt, tosConsecutiveFailures: tosHealthSnapshot.consecutiveFailures, previewTranscodeEnabled: config.tosPreviewTranscodeEnabled, ...runtimeIdentity }); }
});

app.get("/api/firefly-media-sw.js", createServiceWorkerHandler(webDir));
app.get("/firefly-media-sw.js", createServiceWorkerHandler(webDir));

app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.path.startsWith("/api/") || res.headersSent) return next(error);
  console.error(JSON.stringify({ type: "api_unhandled_error", at: new Date().toISOString(), requestId: res.locals.requestId, path: req.path, method: req.method, code: (error as { code?: string }).code ?? "unknown" }));
  res.status(500).json({ error: "服务暂时不可用，请稍后重试", requestId: res.locals.requestId });
});

if (config.atlasEnabled) {
  app.get(["/studio/atlas", "/studio/atlas/", "/studio/atlas/index.html"], (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(atlasDir, "index.html"));
  });
  app.use("/studio/atlas", express.static(atlasDir, { maxAge: "1y", immutable: true, index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || (req.path !== "/studio/atlas" && !req.path.startsWith("/studio/atlas/"))) return next();
    // SPA fallback is only for document navigation. Missing hashed assets and
    // workers must be a real 404, never Firefly/Atlas HTML with a JavaScript
    // MIME mismatch that leaves an already-open editor silently broken.
    if (path.extname(req.path) || !req.accepts("html")) return res.status(404).send("Not found");
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(atlasDir, "index.html"));
  });
} else {
  app.get(["/studio/atlas", "/studio/atlas/*path"], (_req, res) => res.status(404).send("Not found"));
}
app.use(express.static(webDir, { maxAge: "1y", immutable: true, index: false }));
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api/") || req.path.startsWith("/media/")) return next();
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(webDir, "index.html"));
});

await fs.mkdir(config.uploadDir, { recursive: true });
const migratedTasks = await migrateLegacyTasks();
if (migratedTasks) console.info(JSON.stringify({ type: "legacy_task_migration", migratedTasks, at: new Date().toISOString() }));
const stopAsyncJobControlPlane = startAsyncJobControlPlane();
const cleanupUploads = async () => {
  users.deleteExpiredUploadSessions();
  if (tosEnabled()) return;
  const entries = await fs.readdir(config.uploadDir, { withFileTypes: true });
  await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const target = path.join(config.uploadDir, entry.name); const stat = await fs.stat(target);
    if (stat.mtimeMs < Date.now() - 25 * 3600 * 1000) await fs.rm(target, { recursive: true, force: true });
  }));
};
void cleanupUploads().catch(console.error);
const cleanupTimer = setInterval(() => void cleanupUploads().catch(console.error), 3600 * 1000);
void probeTos();
const tosProbeTimer = setInterval(() => void probeTos(), 60 * 1000);
const server = app.listen(config.port, "0.0.0.0", () => console.log(`Firefly listening on ${config.port}`));
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(cleanupTimer); clearInterval(tosProbeTimer);
  const outboxStopped = stopAsyncJobControlPlane();
  const httpClosed = new Promise<void>((resolve) => server.close(() => resolve()));
  // SSE connections are intentionally long-lived. Give ordinary requests time to finish,
  // then close remaining streams so a blue/green retirement cannot hang indefinitely.
  const forceClose = setTimeout(() => server.closeAllConnections(), Math.min(config.shutdownGraceMs, 10_000));
  await Promise.all([httpClosed, outboxStopped]); clearTimeout(forceClose);
  await Promise.all([generationQueue.close(), imageGenerationQueue.close(), archiveQueue.close(), mediaQueue.close(), previewQueue.close(), assetQueue.close(), canvasQueue.close(), uploadFinalizationQueue.close(), atlasAgentQueue.close()]);
  atlasRuntime.close();
  await Promise.allSettled([redis.quit(), queueConnection.quit()]); users.close(); process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
