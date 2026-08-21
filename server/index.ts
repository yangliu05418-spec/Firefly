import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import { z } from "zod";
import { config } from "./config.js";
import { MODELS } from "./capabilities.js";
import { clearSession, createSession, getSessionUser, publicUser, requireAuth, type SessionUser } from "./auth.js";
import type { AssetCategory, CanvasJob, CanvasProject, CanvasProjectAsset, CreationSession, ImageGenerationTask, UserAsset } from "./db.js";
import { users } from "./store.js";
import { canvasDocumentSchema, DEFAULT_CANVAS_DOCUMENT, DEFAULT_CANVAS_DOCUMENT_V1, parseCanvasDocumentSafe, toCanvasDocumentV2 } from "./canvas-document.js";
import { resolveCanvasContext } from "./canvas-context.js";
import { publicCanvasProject, publicCanvasProjectDetail } from "./canvas-public.js";
import { consumeFeishuAuthorization, createFeishuAuthorization, exchangeFeishuCode } from "./feishu.js";
import { assetQueue, canvasQueue, generationQueue, imageGenerationQueue, listTasksForUser, mediaQueue, migrateLegacyTasks, previewQueue, readTask, redis, saveTask, type StoredTask } from "./redis.js";
import { canAccessTask } from "./task-access.js";
import { publicTask } from "./task-public.js";
import { validateGeneration } from "./provider.js";
import { callAssetApi } from "./asset-api.js";
import { ensureAutoReferenceGroup } from "./asset-registration.js";
import { previewRedirectCacheControl } from "./media-cache.js";
import { stablePreviewUrl } from "./preview-url-cache.js";
import { abortMultipartUpload, canvasExportObjectKey, completeMultipartUpload, createMultipartUpload, deleteObject, headObject, inputObjectKey, inspectMediaObject, signUploadPart, signedObjectUrl, tosConfigured, tosEnabled, tosHealth, verifyStoredObject } from "./tos.js";
import { DependencyHealthGate } from "./dependency-health.js";
import { canonicalUploadContentType, tosMediaInfoViolation, uploadKindFromContentType } from "./upload-policy.js";
import { acquireUploadCompletionLock, claimUploadSlot, releaseUploadCompletionLock, releaseUploadSlot, renewUploadSlot, UPLOAD_SESSION_TTL_SECONDS } from "./upload-slots.js";
import { createCanvasAssetFromUpload, prepareCanvasAssetFromUpload } from "./canvas-assets.js";
import { createCanvasMediaHandler } from "./canvas-media-route.js";
import { resolveUploadMediaUrl } from "./media-url.js";
import { publicUserAsset } from "./user-asset-public.js";
import { IMAGE_MODELS, IMAGE_RATIOS, imageModelById, DEFAULT_IMAGE_MODEL } from "./image-models.js";
import { openRouterPool } from "./openrouter.js";
import { publicImageGeneration } from "./image-generation-public.js";
import { providerAssetName } from "./asset-name.js";
import { acquireCanvasLease, releaseCanvasLease, renewCanvasLease, validateCanvasLease } from "./canvas-lease.js";
import { canvasProjectAssetProviderUrl, canvasProjectAssetSignedUrl, createCanvasProjectMediaHandler, publicCanvasProjectAsset } from "./canvas-project-assets.js";
import { readWorkerHealth, type WorkerHealthSnapshot } from "./worker-heartbeat.js";
import { canvasGeneratedMediaId } from "./canvas-job-media.js";

const app = express();
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
  res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https://*.bytepluses.com.cn");
  if (config.origin.startsWith("https://")) res.setHeader("Strict-Transport-Security", "max-age=31536000");
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  if (req.path.startsWith("/api/") && ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) && req.header("origin") !== applicationOrigin) return res.status(403).json({ error: "请求来源无效" });
  next();
});

const respondError = (res: express.Response, error: unknown, status = 400) => {
  const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "请求失败";
  const code = (error as { code?: string }).code;
  res.status(error instanceof z.ZodError ? 400 : status).json({ error: message, ...(code ? { code } : {}), requestId: res.locals.requestId });
};
const param = (value: string | string[]) => Array.isArray(value) ? value[0] : value;
const execFileAsync = promisify(execFile);
const publicGenerationTask = (task: StoredTask) => {
  const stableMediaReady = task.status !== "succeeded" || task.mediaStatus !== "ready"
    ? true
    : !tosEnabled()
      ? true
      : config.tosPreviewTranscodeEnabled
        ? Boolean(users.readTaskMedia(task.id, "preview"))
        : Boolean(users.readTaskMedia(task.id, "output"));
  return publicTask(task, { stableMediaReady });
};
const publicCreationSession = ({ ownerId: _ownerId, deletedAt: _deletedAt, ...session }: CreationSession) => session;
const createCreationSession = (ownerId: string, title = "新创作") => {
  const now = Date.now();
  return users.createCreationSession({ id: crypto.randomUUID(), ownerId, title, createdAt: now, updatedAt: now });
};

/** 全局素材校验并发闸：批量上传时避免 N 个 ffprobe 同时拉取 TOS 对象压垮容器网络 */
class Semaphore {
  private readonly queue: (() => void)[] = [];
  private active = 0;
  constructor(private readonly limit: number) {}
  acquire(): Promise<void> {
    if (this.active < this.limit) { this.active += 1; return Promise.resolve(); }
    return new Promise((resolve) => this.queue.push(() => { this.active += 1; resolve(); }));
  }
  release() {
    const next = this.queue.shift();
    if (next) next();
    else this.active -= 1;
  }
}
const ffprobeGate = new Semaphore(3);

/** 执行 ffprobe：仅用于 TOS 当前没有 info API 的音频；60s 硬超时。 */
const runFfprobe = async (filePath: string) => {
  const startedAt = Date.now();
  let lastError: unknown;
  for (let attempt = 0; attempt < 1; attempt++) {
    try {
      const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate", "-show_entries", "format=duration", "-of", "json", filePath], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
      return { stdout, elapsedMs: Date.now() - startedAt };
    } catch (error) {
      lastError = error;
    }
  }
  const detail = lastError as { stderr?: string; killed?: boolean; signal?: string; message?: string } | undefined;
  const reason = detail?.stderr?.trim().slice(0, 300) || detail?.message || "ffprobe 无法读取素材";
  if (detail?.killed || /http error|server returned|connection|timed? ?out|input\/output error/i.test(reason)) throw new Error("素材校验暂时不可用：" + reason + "（耗时 " + (Date.now() - startedAt) + "ms）");
  throw new MediaValidationError("无法识别素材内容，请检查文件是否损坏或编码是否受支持");
};

/**
 * 确定性规格违规（尺寸/时长/FPS/编码不符合官方要求）。
 * 该结论来自成功解码后的明确数值，不随网络抖动变化，在 complete 阶段直接拒绝，
 * 避免不合规素材流入素材服务（BytePlus CreateAsset）后产生难以理解的 502。
 */
class MediaValidationError extends Error {
  readonly code = "MEDIA_VALIDATION_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "MediaValidationError";
  }
}
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
const validateMedia = async (filePath: string, type: "image" | "video" | "audio") => {
  await ffprobeGate.acquire();
  let probeResult: { stdout: string; elapsedMs: number };
  try {
    probeResult = await runFfprobe(filePath);
  } finally {
    ffprobeGate.release();
  }
  const { stdout } = probeResult;
  const probe = JSON.parse(stdout); const stream = probe.streams?.find((item: { codec_type: string }) => item.codec_type === (type === "image" ? "video" : type));
  if (!stream) throw new Error("无法识别素材内容，请检查文件是否损坏");
  if (type === "image" || type === "video") {
    const { width, height } = stream; const ratio = width / height;
    if (width < 300 || width > 6000 || height < 300 || height > 6000 || ratio <= .4 || ratio >= 2.5) throw new MediaValidationError("图片或视频尺寸不符合官方要求（300–6000px，宽高比 0.4–2.5）");
    if (type === "video") {
      const pixels = width * height; const duration = Number(probe.format?.duration ?? 0); const [a, b] = String(stream.r_frame_rate ?? "0/1").split("/").map(Number); const fps = b ? a / b : a;
      if (pixels < 407696 || pixels > 8295044 || duration < 2 || duration > 30 || fps < 24 || fps > 60) throw new MediaValidationError("视频需为 2–30 秒、24–60 FPS，且分辨率符合官方范围");
      if (!["h264", "hevc"].includes(stream.codec_name)) throw new MediaValidationError("视频编码仅支持 H.264 或 H.265");
    }
  }
  if (type === "audio") { const duration = Number(probe.format?.duration ?? 0); if (duration < 2 || duration > 30) throw new MediaValidationError("音频时长需为 2–30 秒"); }
};

app.get("/api/auth/session", async (req, res) => {
  try {
    const user = await getSessionUser(redis, req, res);
    res.json(user ? { authenticated: true, user: publicUser(user) } : { authenticated: false });
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

app.get("/api/models", requireAuth, (_req, res) => res.json(MODELS));

const uploadMetaSchema = z.object({ name: z.string().min(1).max(180), size: z.number().int().positive().max(200 * 1024 * 1024), type: z.enum(["image", "video", "audio"]), mime: z.string().max(100) });
const safeName = (name: string) => name.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120) || "asset";

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
        await redis.set(`upload:${id}`, JSON.stringify(stored), "EX", UPLOAD_SESSION_TTL_SECONDS);
        const parts = Array.from({ length: partCount }, (_, index) => ({ partNumber: index + 1, url: signUploadPart(objectKey, tosUploadId, index + 1) }));
        pendingMultipart = undefined;
        console.info(JSON.stringify({ type: "tos_upload_started", at: new Date().toISOString(), userId: owner.id, uploadId: id, size: meta.size, parts: partCount }));
        return res.status(201).json({ id, direct: true, chunkSize: partSize, concurrency: config.tosUploadConcurrency, parts });
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
    const raw = await redis.get(`upload:${uploadId}`);
    if (!raw) return res.status(404).json({ error: "上传不存在或已过期" });
    const meta = JSON.parse(raw);
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
    const raw = await redis.get(`upload:${uploadId}`);
    if (!raw) return users.readUpload(uploadId)?.ownerId === owner.id ? res.status(204).end() : res.status(404).json({ error: "上传不存在或已过期" });
    const meta = JSON.parse(raw);
    if (meta.ownerId !== owner.id) return res.status(404).json({ error: "上传不存在或已过期" });
    const active = await renewUploadSlot(redis, owner.id, uploadId) || await claimUploadSlot(redis, owner.id, uploadId, config.maxActiveUploadsPerUser);
    if (!active) return res.status(429).json({ error: "当前上传并发较高，素材传输仍可继续", code: "UPLOAD_HEARTBEAT_LIMIT" });
    return res.status(204).end();
  } catch (error) { respondError(res, error); }
});

app.post("/api/uploads/:id/chunks", requireAuth, express.raw({ type: "application/octet-stream", limit: "17mb" }), async (req, res) => {
  try {
    const uploadId = param(req.params.id);
    const raw = await redis.get(`upload:${uploadId}`);
    if (!raw) throw new Error("上传已过期，请重新选择文件");
    const meta = JSON.parse(raw);
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
    const completed = users.readUpload(uploadId);
    if (completed) {
      if (completed.ownerId !== owner.id) return res.status(404).json({ error: "上传不存在或已过期" });
      return res.json({ id: uploadId, uploadId, name: completed.fileName, type: uploadKindFromContentType(completed.contentType), size: completed.size });
    }
    const raw = await redis.get(`upload:${uploadId}`);
    if (!raw) return res.status(404).json({ error: "上传不存在或已过期", requestId: res.locals.requestId });
    const meta = JSON.parse(raw);
    if (meta.ownerId !== owner.id) return res.status(404).json({ error: "上传不存在或已过期" });
    const lock = await acquireUploadCompletionLock(redis, uploadId);
    if (!lock) return res.status(409).json({ error: "素材正在完成校验，请稍后重试", code: "UPLOAD_FINALIZING", requestId: res.locals.requestId });
    try {
      const reconciled = users.readUpload(uploadId);
      if (reconciled) return res.json({ id: uploadId, uploadId, name: reconciled.fileName, type: uploadKindFromContentType(reconciled.contentType), size: reconciled.size });
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
          const validationUrl = signedObjectUrl(meta.objectKey, { expires: 900, fileName: meta.name });
          const info = await inspectMediaObject(meta.objectKey, meta.type);
          if (meta.type !== "audio") {
            const violation = tosMediaInfoViolation(info, meta.type);
            if (violation) throw new MediaValidationError(violation);
          }
          stageLog("inspected");
          if (meta.type === "audio") try {
            await validateMedia(validationUrl, meta.type);
            stageLog("probed");
          } catch (probeError) {
            if (probeError instanceof MediaValidationError) {
              stageLog("probe_rejected");
              throw probeError;
            }
            console.warn(JSON.stringify({ type: "upload_probe_soft_failed", at: new Date().toISOString(), uploadId, userId: meta.ownerId, message: probeError instanceof Error ? probeError.message.slice(0, 300) : undefined }));
            stageLog("probe_soft_failed");
          }
          const now = Date.now();
          users.upsertMedia({ id: `input:${uploadId}`, ownerId: meta.ownerId, uploadId, kind: "input", objectKey: meta.objectKey, status: "ready", fileName: meta.name, contentType: meta.mime, size, etag: String(head.headers.etag ?? "").replace(/^"|"$/g, ""), createdAt: now, updatedAt: now });
          await redis.del(`upload:${uploadId}`);
          await releaseUploadSlot(redis, owner.id, uploadId);
          console.info(JSON.stringify({ type: "tos_upload_completed", at: new Date().toISOString(), userId: meta.ownerId, uploadId, size, requestId: head.requestId }));
          return res.json({ id: uploadId, uploadId, name: meta.name, type: meta.type, size });
        } catch (error) {
          const destructive = error instanceof MediaValidationError || error instanceof UploadIntegrityError;
          console.warn(JSON.stringify({ type: "tos_upload_failed", at: new Date().toISOString(), userId: meta.ownerId, uploadId, retryable: !destructive, errorCode: (error as { code?: string }).code ?? (destructive ? "validation_failed" : "transient_failure"), message: error instanceof Error ? error.message.slice(0, 400) : undefined }));
          if (destructive) {
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
    } finally {
      await releaseUploadCompletionLock(redis, uploadId, lock).catch(() => undefined);
    }
  } catch (error) { respondError(res, error, error instanceof RetryableUploadError ? 503 : 400); }
});

app.delete("/api/uploads/:id", requireAuth, async (req, res) => {
  try {
    const uploadId = param(req.params.id);
    const owner = res.locals.user as SessionUser;
    const completed = users.readUpload(uploadId);
    if (completed) return completed.ownerId === owner.id ? res.status(409).json({ error: "素材已完成上传，不能取消" }) : res.status(404).json({ error: "上传不存在或已过期" });
    const raw = await redis.get(`upload:${uploadId}`);
    if (!raw) return res.status(204).end();
    const meta = JSON.parse(raw);
    if (meta.ownerId !== owner.id) return res.status(404).json({ error: "上传不存在或已过期" });
    const lock = await acquireUploadCompletionLock(redis, uploadId, 60);
    if (!lock) return res.status(409).json({ error: "素材正在完成校验，暂时不能取消", code: "UPLOAD_FINALIZING", requestId: res.locals.requestId });
    try {
      const reconciled = users.readUpload(uploadId);
      if (reconciled) return res.status(409).json({ error: "素材已完成上传，不能取消" });
      if (meta.direct) {
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

app.get("/api/creation-sessions", requireAuth, (_req, res) => {
  const user = res.locals.user as SessionUser;
  res.json(users.listCreationSessions(user.id).map(publicCreationSession));
});

app.post("/api/creation-sessions", requireAuth, (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const title = req.body?.title === undefined ? "新创作" : creationSessionTitleSchema.parse(req.body).title;
    res.status(201).json(publicCreationSession(createCreationSession(user.id, title)));
  } catch (error) { respondError(res, error); }
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

app.post("/api/generations", requireAuth, async (req, res) => {
  try {
    const requestedSessionId = z.string().min(1).max(200).optional().parse(req.body?.sessionId);
    const requestedInput = validateGeneration(req.body);
    const owner = res.locals.user as SessionUser;
    const session = requestedSessionId ? users.readCreationSession(requestedSessionId) : null;
    if (requestedSessionId && (!session || session.ownerId !== owner.id)) return res.status(404).json({ error: "创作会话不存在" });
    const activeSession = session ?? createCreationSession(owner.id);
    const assets = [];
    for (const asset of requestedInput.assets) {
      if (asset.uploadId) {
        const media = users.readUpload(asset.uploadId);
        if (!media || media.ownerId !== owner.id) return res.status(404).json({ error: "引用素材不存在或已过期" });
        assets.push(asset);
        continue;
      }
      if (asset.assetId) {
        const owned = users.readUserAsset(asset.assetId);
        if (!owned || owned.ownerId !== owner.id) return res.status(404).json({ error: "引用素材不存在或无权访问" });
        if (owned.status !== "Active") return res.status(409).json({ error: `参考素材「${asset.name}」仍在处理中，请稍后再试` });
        assets.push(asset);
        continue;
      }
      if (!asset.url) continue;
      const url = new URL(asset.url);
      if (url.origin === applicationOrigin && url.pathname.startsWith("/media/")) {
        const uploadId = url.pathname.split("/")[2];
        const raw = uploadId ? await redis.get(`upload:${uploadId}`) : null;
        if (!raw || JSON.parse(raw).ownerId !== owner.id) return res.status(404).json({ error: "引用素材不存在或已过期" });
      }
      assets.push(asset);
    }
    const input = validateGeneration({ ...requestedInput, assets });
    const id = crypto.randomUUID();
    const now = Date.now();
    const task: StoredTask = { id, sessionId: activeSession.id, ownerId: owner.id, visibility: "private", status: "queued", mediaStatus: "none", mediaRevision: 0, prompt: input.prompt, model: input.model, mode: input.mode, ratio: input.ratio, resolution: input.resolution, duration: input.duration, request: requestedInput, createdAt: now, updatedAt: now };
    if (!users.createTaskWithinLimit(task, config.maxActiveGenerationsPerUser)) return res.status(429).json({ error: `你已有 ${config.maxActiveGenerationsPerUser} 个任务正在生成，请等待其中一个完成`, requestId: res.locals.requestId });
    await saveTask(task);
    try {
      await generationQueue.add("generate", { input }, { jobId: id, attempts: 4, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: { age: 7 * 24 * 3600 }, removeOnFail: { age: 7 * 24 * 3600 } });
    } catch (error) {
      const failed = { ...task, status: "failed" as const, error: "任务进入生成队列失败，请重新提交", updatedAt: Date.now() };
      await saveTask(failed);
      console.error(JSON.stringify({ type: "generation_enqueue_failed", at: new Date().toISOString(), taskId: id, userId: owner.id, code: (error as { code?: string }).code ?? "unknown" }));
      return res.status(503).json({ error: `${failed.error}（Case ID: ${id}）`, caseId: id });
    }
    users.touchCreationSession(activeSession.id, owner.id, input.prompt);
    console.info(JSON.stringify({ type: "generation_queued", at: new Date().toISOString(), requestId: res.locals.requestId, taskId: id, userId: owner.id, model: input.model, mode: input.mode, assetCount: input.assets.length }));
    res.status(202).json(publicGenerationTask(task));
  } catch (error) { respondError(res, error); }
});

app.get("/api/generations", requireAuth, async (req, res) => {
  const user = res.locals.user as SessionUser;
  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : "";
  if (sessionId) {
    const session = users.readCreationSession(sessionId);
    if (!session || session.ownerId !== user.id) return res.status(404).json({ error: "创作会话不存在" });
    return res.json(users.listTasksForSession(user.id, sessionId).map(publicGenerationTask));
  }
  res.json((await listTasksForUser(user.id)).map(publicGenerationTask));
});
app.get("/api/generations/:id", requireAuth, async (req, res) => {
  const task = await readTask(param(req.params.id));
  task && canAccessTask(task, (res.locals.user as SessionUser).id) ? res.json(publicGenerationTask(task)) : res.status(404).json({ error: "任务不存在或已过期" });
});

const accessibleTask = async (req: express.Request, res: express.Response) => {
  const task = await readTask(param(req.params.id));
  const user = res.locals.user as SessionUser;
  return task && canAccessTask(task, user.id) ? task : null;
};

app.get("/api/generations/:id/media", requireAuth, async (req, res) => {
  try {
    const task = await accessibleTask(req, res);
    if (!task || task.status !== "succeeded") return res.status(404).json({ error: "成片不存在或尚未就绪" });
    const media = task.mediaStatus === "ready"
      ? config.tosPreviewTranscodeEnabled
        ? users.readTaskMedia(task.id, "preview")
        : users.readTaskMedia(task.id, "preview") ?? users.readTaskMedia(task.id, "output")
      : null;
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
  try {
    const task = await accessibleTask(req, res);
    if (!task || task.status !== "succeeded") return res.status(404).json({ error: "成片不存在或尚未就绪" });
    const media = task.mediaStatus === "ready" ? users.readTaskMedia(task.id, "output") : null;
    if (!media) return res.status(425).json({ error: "成片正在归档到TOS，请稍后重试" });
    const target = signedObjectUrl(media.objectKey, { download: true, fileName: media.fileName }); const source = "tos" as const;
    res.setHeader("Cache-Control", "no-store");
    console.info(JSON.stringify({ type: "tos_media_redirect", at: new Date().toISOString(), taskId: task.id, userId: (res.locals.user as SessionUser).id, source, kind: "download" }));
    res.redirect(302, target);
  } catch (error) { respondError(res, error, 502); }
});

app.delete("/api/generations/:id", requireAuth, async (req, res) => {
  try {
    const taskId = param(req.params.id);
    const user = res.locals.user as SessionUser;
    if (!users.softDeleteTask(taskId, user.id)) return res.status(404).json({ error: "任务不存在" });
    const job = await generationQueue.getJob(taskId);
    if (job) await job.remove().catch(() => undefined);
    await mediaQueue.add("delete-task-media", { taskId }, { jobId: `delete-${taskId}`, attempts: 8, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true });
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
  bufferingMs: z.number().int().nonnegative().max(3600 * 1000).optional()
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

type ProviderAssetRecord = { Id: string; Name?: string; AssetType?: UserAsset["assetType"]; Status?: UserAsset["status"]; URL?: string; GroupId?: string };
const assetCategories = ["character", "scene", "prop", "material"] as const satisfies readonly AssetCategory[];
const assetCategorySchema = z.enum(assetCategories);
const ownedUserAsset = (assetId: string, ownerId: string) => { const asset = users.readUserAsset(assetId); return asset?.ownerId === ownerId ? asset : null; };

app.get("/api/assets/groups", requireAuth, async (_req, res) => {
  try { const groupId = await ensureAutoReferenceGroup(); res.json({ Items: [{ Id: groupId, Name: "我的素材", Description: "仅当前用户可见" }] }); } catch (error) { respondError(res, error, 502); }
});
app.post("/api/assets/groups", requireAuth, async (req, res) => {
  try { z.object({ name: z.string().min(1).max(80), description: z.string().max(200).default("") }).parse(req.body); const groupId = await ensureAutoReferenceGroup(); res.status(201).json({ Id: groupId, Name: "我的素材" }); } catch (error) { respondError(res, error, 502); }
});
app.get("/api/assets", requireAuth, async (req, res) => {
  try {
    const query = z.object({ q: z.string().max(80).optional(), type: z.enum(["Image", "Video", "Audio"]).optional(), category: assetCategorySchema.optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(100) }).parse(req.query);
    const user = res.locals.user as SessionUser;
    const assets = users.listUserAssets(user.id, query.q ?? "", query.pageSize + 1, query.type, (query.page - 1) * query.pageSize, query.category);
    const hasMore = assets.length > query.pageSize;
    res.json({ Items: assets.slice(0, query.pageSize).map(publicUserAsset), PageNumber: query.page, PageSize: query.pageSize, HasMore: hasMore });
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
    let groupId = body.groupId ?? "";
    let url = body.url;
    let assetType = body.type;
    let providerName = providerAssetName(body.name);
    if (body.uploadId) {
      const existing = users.readUserAssetByUpload(user.id, body.uploadId);
      if (existing) return res.status(202).json(publicUserAsset(existing));
      const media = users.readUpload(body.uploadId);
      if (!media || media.ownerId !== user.id || media.status !== "ready") return res.status(404).json({ error: "引用素材不存在或尚未上传完成" });
      assetType = media.contentType.startsWith("video/") ? "Video" : media.contentType.startsWith("audio/") ? "Audio" : "Image";
      providerName = providerAssetName(body.name);
      const now = Date.now();
      const asset: UserAsset = { id: `asset-local-${crypto.randomUUID()}`, ownerId: user.id, groupId, uploadId: body.uploadId, name: body.name, assetType, status: "Processing", category: body.category, createdAt: now, updatedAt: now };
      users.upsertUserAsset(asset);
      const stored = users.readUserAssetByUpload(user.id, body.uploadId);
      if (!stored) throw new Error("素材上传记录未能持久化");
      if (stored.id !== asset.id) return res.status(202).json(publicUserAsset(stored));
      try {
        await assetQueue.add("register", { assetId: asset.id }, { jobId: asset.id, attempts: 3, backoff: { type: "exponential", delay: 15_000 }, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } });
      } catch (error) {
        users.upsertUserAsset({ ...asset, lastError: "素材已上传，生成引用将在后台继续准备", updatedAt: Date.now() });
        console.warn(JSON.stringify({ type: "asset_ingest_enqueue_failed", at: new Date().toISOString(), assetId: asset.id, userId: user.id, code: (error as { code?: string }).code ?? "unknown" }));
      }
      console.info(JSON.stringify({ type: "user_asset_mutation", action: "queue_asset", userId: user.id, assetId: asset.id, at: new Date().toISOString() }));
      return res.status(202).json(publicUserAsset(users.readUserAsset(asset.id)!));
    }
    groupId ||= await ensureAutoReferenceGroup();
    const created = await callAssetApi<ProviderAssetRecord>("CreateAsset", { GroupId: groupId, URL: url, AssetType: assetType, Name: providerName });
    if (!created.Id?.startsWith("asset-")) throw new Error("素材服务未返回有效资产 ID");
    const now = Date.now();
    const asset: UserAsset = { id: created.Id, providerAssetId: created.Id, ownerId: user.id, groupId, name: created.Name ?? providerName, assetType: created.AssetType ?? assetType, status: created.Status ?? "Processing", category: body.category, url: created.URL, createdAt: now, updatedAt: now };
    users.upsertUserAsset(asset);
    console.info(JSON.stringify({ type: "user_asset_mutation", action: "create_asset", userId: user.id, assetId: asset.id, at: new Date().toISOString() }));
    res.status(201).json(publicUserAsset(asset));
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
    const deleted: string[] = []; const failed: string[] = [...blocked]; const deletable = ids.filter((id) => !blocked.has(id)); let cursor = 0;
    const next = async () => { while (cursor < deletable.length) { const id = deletable[cursor++]; if (!id) continue; try { const asset = ownedUserAsset(id, user.id); if (!asset) { failed.push(id); continue; } if (asset.providerAssetId) await callAssetApi("DeleteAsset", { Id: asset.providerAssetId }); else await assetQueue.getJob(id).then((job) => job?.remove()).catch(() => undefined); users.deleteUserAsset(id, user.id); deleted.push(id); } catch { failed.push(id); } } };
    await Promise.all(Array.from({ length: Math.min(4, deletable.length) }, next));
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
  try { const user = res.locals.user as SessionUser; const asset = ownedUserAsset(param(req.params.id), user.id); if (!asset) return res.status(404).json({ error: "素材不存在" }); res.json(publicUserAsset(asset)); } catch (error) { respondError(res, error, 502); }
});
app.patch("/api/assets/:id", requireAuth, async (req, res) => {
  try {
    const body = z.object({ name: z.string().trim().min(1).max(80).optional(), category: assetCategorySchema.optional() }).refine((value) => value.name !== undefined || value.category !== undefined, "没有需要更新的字段").parse(req.body);
    const user = res.locals.user as SessionUser; const id = param(req.params.id);
    const asset = ownedUserAsset(id, user.id);
    if (!asset) return res.status(404).json({ error: "素材不存在" });
    if (body.name !== undefined) { if (asset.providerAssetId) await callAssetApi("UpdateAsset", { Id: asset.providerAssetId, Name: providerAssetName(body.name) }); users.renameUserAsset(id, user.id, body.name); }
    if (body.category !== undefined) users.updateUserAssetCategory(id, user.id, body.category);
    console.info(JSON.stringify({ type: "user_asset_mutation", action: body.name !== undefined ? body.category !== undefined ? "update_asset" : "rename_asset" : "categorize_asset", userId: user.id, assetId: id, at: new Date().toISOString() }));
    res.json(publicUserAsset(users.readUserAsset(id)!));
  } catch (error) { respondError(res, error, 502); }
});
app.delete("/api/assets/:id", requireAuth, async (req, res) => {
  try { const user = res.locals.user as SessionUser; const id = param(req.params.id); const asset = ownedUserAsset(id, user.id); if (!asset) return res.status(404).json({ error: "素材不存在" }); if (users.isUserAssetInActiveTask(id, user.id)) return res.status(409).json({ error: "素材正被运行中的任务引用，任务结束后即可删除" }); if (asset.providerAssetId) await callAssetApi("DeleteAsset", { Id: asset.providerAssetId }); else await assetQueue.getJob(id).then((job) => job?.remove()).catch(() => undefined); users.deleteUserAsset(id, user.id); console.info(JSON.stringify({ type: "user_asset_mutation", action: "delete_asset", userId: user.id, assetId: id, at: new Date().toISOString() })); res.status(204).end(); } catch (error) { respondError(res, error, 502); }
});



// ---- OpenRouter 图片生成 ----
const imageGenerationSchema = z.object({
  requestId: z.string().uuid().optional(),
  sessionId: z.string().min(1).max(200).optional(),
  model: z.string().min(1).max(120),
  ratio: z.enum(IMAGE_RATIOS),
  resolution: z.string().min(1).max(20),
  count: z.number().int().min(1).max(4),
  prompt: z.string().trim().min(1).max(2000),
  references: z.array(z.string().min(20).max(200)).max(4).default([]),
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
    return res.json(users.listImageGenerationsForSession(user.id, sessionId, limit).map(publicImageGeneration));
  }
  res.json(users.listImageGenerations(user.id, limit).map(publicImageGeneration));
});

app.delete("/api/image-generations/:id", requireAuth, (req, res) => {
  const user = res.locals.user as SessionUser;
  if (!users.softDeleteImageGeneration(param(req.params.id), user.id)) return res.status(404).json({ error: "图片记录不存在" });
  res.status(204).end();
});

app.post("/api/image-generation", requireAuth, async (req, res) => {
  try {
    const body = imageGenerationSchema.parse(req.body);
    const user = res.locals.user as SessionUser;
    const requestId = body.requestId ?? crypto.randomUUID();
    const existing = users.readImageGeneration(requestId);
    if (existing) {
      if (existing.ownerId !== user.id) return res.status(409).json({ error: "请求标识已被使用" });
      if (existing.status === "succeeded") return res.json({ Id: existing.id, Items: existing.items, Model: existing.model, Ratio: existing.ratio, Resolution: existing.resolution, Failed: existing.failures });
      if (existing.status === "running") return res.status(202).json({ Id: existing.id, Items: existing.items, Model: existing.model, Ratio: existing.ratio, Resolution: existing.resolution, Failed: existing.failures, Status: "generating" });
      return res.status(409).json({ error: existing.error ?? "该请求未生成成功" });
    }
    const spec = imageModelById(body.model);
    if (!spec) return res.status(400).json({ error: "未知的图片模型" });
    if (body.count > spec.maxCount) return res.status(400).json({ error: "该模型单次最多生成 " + spec.maxCount + " 张" });
    if (!spec.resolutions.includes(body.resolution)) return res.status(400).json({ error: "该模型不支持此分辨率档位" });
    const session = body.sessionId ? users.readCreationSession(body.sessionId) : null;
    if (body.sessionId && (!session || session.ownerId !== user.id)) return res.status(404).json({ error: "创作会话不存在" });
    const activeSession = session ?? createCreationSession(user.id);
    // Only persist opaque upload ids in BullMQ. The worker signs fresh URLs
    // immediately before the provider call, so queue delays cannot expire them.
    for (const uploadId of body.references) {
      const media = users.readUpload(uploadId);
      if (!media || media.ownerId !== user.id) return res.status(404).json({ error: "参考素材不存在或已过期" });
    }
    if (!openRouterPool().size) return res.status(503).json({ error: "服务端尚未配置 OpenRouter API Key" });
    const startedAt = Date.now();
    const activeTask: ImageGenerationTask = {
      id: requestId, sessionId: activeSession.id, ownerId: user.id, model: body.model, modelName: spec.name, ratio: body.ratio,
      resolution: body.resolution, prompt: body.prompt, requestedCount: body.count, status: "running",
      items: [], failures: [], createdAt: startedAt, updatedAt: startedAt,
    };
    if (!users.createImageGenerationWithinLimit(activeTask, 2)) return res.status(429).json({ error: "图片生成繁忙，请等当前生成完成后再试（每用户同时最多 2 组）" });
    try {
      await imageGenerationQueue.add("generate-image", {
        ownerId: user.id, model: body.model, prompt: body.prompt, ratio: body.ratio,
        resolution: body.resolution, count: body.count, referenceUploadIds: body.references,
      }, {
        jobId: requestId,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000, jitter: 0.5 },
        removeOnComplete: { age: 7 * 24 * 3600 },
        removeOnFail: { age: 7 * 24 * 3600 },
      });
    } catch (error) {
      users.updateImageGeneration(activeTask.id, user.id, { status: "failed", items: [], failures: [], error: "任务进入生成队列失败，请重新提交" });
      console.error(JSON.stringify({ type: "image_generation_enqueue_failed", at: new Date().toISOString(), taskId: activeTask.id, userId: user.id, code: (error as { code?: string }).code ?? "unknown" }));
      return res.status(503).json({ error: "任务进入生成队列失败，请重新提交", requestId: res.locals.requestId });
    }
    users.touchCreationSession(activeSession.id, user.id, body.prompt);
    console.info(JSON.stringify({ type: "image_generation_queued", at: new Date().toISOString(), taskId: activeTask.id, userId: user.id, model: body.model, ratio: body.ratio, resolution: body.resolution, count: body.count, references: body.references.length, healthyKeys: openRouterPool().healthyCount() }));
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
      if (!task || !canAccessTask(task, user.id) || task.status !== "succeeded" || task.mediaStatus !== "ready") return res.status(404).json({ error: "成片不存在或尚未就绪" });
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
  canvasJobBaseSchema.extend({ kind: z.literal("image"), payload: z.object({ prompt: z.string().trim().min(1).max(20_000), model: z.string().min(1).max(120), ratio: z.string().min(1).max(20), resolution: z.string().min(1).max(20), referenceAssetIds: z.array(z.string().min(1).max(180)).max(30).default([]) }) }),
  canvasJobBaseSchema.extend({ kind: z.literal("character_tool"), payload: z.object({ tool: z.enum(["turnaround", "closeup", "expressions", "portrait"]), prompt: z.string().trim().min(1).max(20_000), model: z.string().min(1).max(120), ratio: z.string().min(1).max(20), resolution: z.string().min(1).max(20), referenceAssetIds: z.array(z.string().min(1).max(180)).max(30).default([]) }) }),
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
      users.createCanvasJob(canvasJob);
      try {
        await canvasQueue.add("text", { canvasJobId: canvasJob.id, kind: "text", payload: { instruction: body.payload.instruction, currentText: context.target.data.markdown ?? "", context: context.text } }, { jobId: canvasJob.id, attempts: 3, backoff: { type: "exponential", delay: 3000 }, removeOnComplete: { age: 7 * 24 * 3600 }, removeOnFail: { age: 7 * 24 * 3600 } });
      } catch (error) { users.transitionActiveCanvasJob(canvasJob.id, { status: "failed", error: "任务进入文本队列失败" }); throw error; }
      return res.status(202).json(publicCanvasJob(canvasJob));
    }

    if (body.kind === "image" || body.kind === "character_tool") {
      const references = ownedCanvasProjectAssets(canvasId, user.id, [...context.assetIds, ...body.payload.referenceAssetIds]);
      if (!users.createCanvasImageJobWithinLimit(canvasJob, 2)) return res.status(429).json({ error: "你已有 2 个图片任务正在处理，请等待其中一个完成" });
      const prompt = [context.text, body.kind === "character_tool" ? characterToolPrompts[body.payload.tool] : "", body.payload.prompt].filter(Boolean).join("\n\n");
      try {
        await canvasQueue.add(body.kind, { canvasJobId: canvasJob.id, kind: body.kind, payload: { prompt, model: body.payload.model, ratio: body.payload.ratio, resolution: body.payload.resolution, referenceAssetIds: references.map((asset) => asset.id) } }, { jobId: canvasJob.id, attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: { age: 7 * 24 * 3600 }, removeOnFail: { age: 7 * 24 * 3600 } });
      } catch (error) { users.transitionActiveCanvasJob(canvasJob.id, { status: "failed", error: "任务进入图片队列失败" }); throw error; }
      return res.status(202).json(publicCanvasJob(canvasJob));
    }

    const references = body.payload.references.length ? body.payload.references : ownedCanvasProjectAssets(canvasId, user.id, context.assetIds).map((asset) => ({ assetId: asset.id, role: asset.kind === "video" ? "reference_video" as const : asset.kind === "audio" ? "reference_audio" as const : "reference_image" as const }));
    const referenceAssets = ownedCanvasProjectAssets(canvasId, user.id, references.map((item) => item.assetId));
    const byId = new Map(referenceAssets.map((asset) => [asset.id, asset]));
    const generationAssets = references.map((reference) => {
      const asset = byId.get(reference.assetId)!;
      const type = asset.kind;
      if ((reference.role === "first_frame" || reference.role === "last_frame") && type !== "image") throw new Error("首帧和尾帧只能引用图片素材");
      return { id: asset.id, type, role: reference.role, url: canvasProjectAssetProviderUrl(asset), name: asset.title };
    });
    const input = validateGeneration({ ...body.payload.generation, prompt: [context.text, String(body.payload.generation.prompt ?? "")].filter(Boolean).join("\n\n"), assets: generationAssets });
    const taskId = crypto.randomUUID();
    const task: StoredTask = { id: taskId, ownerId: user.id, visibility: "private", status: "queued", mediaStatus: "none", mediaRevision: 0, prompt: input.prompt, model: input.model, mode: input.mode, ratio: input.ratio, resolution: input.resolution, duration: input.duration, request: input, createdAt: now, updatedAt: now };
    if (!users.createTaskWithinLimit(task, config.maxActiveGenerationsPerUser)) return res.status(429).json({ error: `你已有 ${config.maxActiveGenerationsPerUser} 个任务正在生成，请稍后再试` });
    users.createCanvasJob({ ...canvasJob, providerTaskId: taskId });
    await saveTask(task);
    try {
      await generationQueue.add("generate", { input }, { jobId: taskId, attempts: 4, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: { age: 7 * 24 * 3600 }, removeOnFail: { age: 7 * 24 * 3600 } });
    } catch (error) {
      users.transitionActiveCanvasJob(canvasJob.id, { status: "failed", error: "任务进入生成队列失败" });
      await saveTask({ ...task, status: "failed", error: "任务进入生成队列失败", updatedAt: Date.now() });
      throw error;
    }
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
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const subscriber = redis.duplicate();
  const channel = `canvas:events:${canvasId}`;
  const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15_000);
  let closed = false;
  req.on("close", () => {
    closed = true; clearInterval(heartbeat);
    void subscriber.unsubscribe(channel).finally(() => subscriber.quit());
  });
  subscriber.on("message", (_channel, message) => {
    try {
      const event = JSON.parse(message) as { type?: string; job?: CanvasJob };
      if (event.job?.ownerId === user.id) res.write(`id: ${event.job.updatedAt}\nevent: ${event.type ?? "message"}\ndata: ${JSON.stringify(publicCanvasJob(event.job))}\n\n`);
    } catch { /* 丢弃无法解析的内部事件 */ }
  });
  await subscriber.subscribe(channel);
  if (closed) return;
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
      await canvasQueue.getJob(job.id).then((queued) => queued?.remove()).catch(() => undefined);
      if (job.kind === "image" || job.kind === "character_tool") {
        const mediaId = canvasGeneratedMediaId(job.id);
        if (users.markUnreferencedGeneratedMediaForDeletion(mediaId, user.id)) {
          await mediaQueue.add("reconcile-deletes", {}, { jobId: `canvas-generated-cleanup-${mediaId}`, removeOnComplete: true, removeOnFail: true }).catch(() => undefined);
        }
      }
      if (job.providerTaskId) {
        const task = await readTask(job.providerTaskId, true);
        if (task && task.ownerId === user.id) {
          users.softDeleteCanvasProjectAssetBySource(canvasId, user.id, "generation", task.id);
          users.softDeleteTask(task.id, user.id);
          await generationQueue.getJob(task.id).then((queued) => queued?.remove()).catch(() => undefined);
          await mediaQueue.add("delete-task-media", { taskId: task.id }, { jobId: `delete-${task.id}`, attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true }).catch(() => undefined);
        }
      }
    }
    await redis.publish(`canvas:events:${canvasId}`, JSON.stringify({ type: "canvas_job", job: cancelled }));
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
  let dependency: "redis" | "database" | "queues" | "workers" | "tos" = "redis";
  let workerHealth: WorkerHealthSnapshot | undefined;
  try {
    await redis.ping();
    dependency = "database";
    if (!users.healthCheck()) throw new Error("database unavailable");
    dependency = "queues";
    await Promise.all([generationQueue.getJobCounts("wait", "active"), imageGenerationQueue.getJobCounts("wait", "active"), mediaQueue.getJobCounts("wait", "active"), previewQueue.getJobCounts("wait", "active"), assetQueue.getJobCounts("wait", "active"), canvasQueue.getJobCounts("wait", "active")]);
    dependency = "workers";
    workerHealth = await readWorkerHealth(redis);
    if (!workerHealth.ready && Date.now() >= workerReadinessRequiredAt) throw new Error(`workers unavailable: ${workerHealth.missing.join(",")}`);
    if (tosEnabled()) {
      dependency = "tos";
      const health = tosHealthGate.snapshot();
      if (!health.configured || !health.effectiveReachable) throw new Error("TOS unavailable");
    }
    res.json({ status: "ready", redis: "ok", database: "ok", queues: "ok", workers: workerHealth.ready ? "ok" : "starting", tos: tosEnabled() ? "ok" : "disabled", previewTranscodeEnabled: config.tosPreviewTranscodeEnabled, schemaVersion: users.schemaVersion(), ...runtimeIdentity });
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
    res.json({ status: "ok", redis: "ok", database: "ok", schemaVersion: users.schemaVersion(), tosConfigured: tosHealthSnapshot.configured, tosReachable: tosHealthSnapshot.effectiveReachable, tosLastProbeReachable: tosHealthSnapshot.lastProbeReachable, tosCheckedAt: tosHealthSnapshot.checkedAt, tosLastSuccessfulAt: tosHealthSnapshot.lastSuccessfulAt, tosConsecutiveFailures: tosHealthSnapshot.consecutiveFailures, previewTranscodeEnabled: config.tosPreviewTranscodeEnabled, ...runtimeIdentity });
  } catch { res.status(503).json({ status: "degraded", redis: "unavailable", database: "unavailable", tosConfigured: tosHealthSnapshot.configured, tosReachable: tosHealthSnapshot.effectiveReachable, tosLastProbeReachable: tosHealthSnapshot.lastProbeReachable, tosCheckedAt: tosHealthSnapshot.checkedAt, tosLastSuccessfulAt: tosHealthSnapshot.lastSuccessfulAt, tosConsecutiveFailures: tosHealthSnapshot.consecutiveFailures, previewTranscodeEnabled: config.tosPreviewTranscodeEnabled, ...runtimeIdentity }); }
});

app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.path.startsWith("/api/") || res.headersSent) return next(error);
  console.error(JSON.stringify({ type: "api_unhandled_error", at: new Date().toISOString(), requestId: res.locals.requestId, path: req.path, method: req.method, code: (error as { code?: string }).code ?? "unknown" }));
  res.status(500).json({ error: "服务暂时不可用，请稍后重试", requestId: res.locals.requestId });
});

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist-web");
app.use(express.static(webDir, { maxAge: "1y", immutable: true, index: false }));
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api/") || req.path.startsWith("/media/")) return next();
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(webDir, "index.html"));
});

await fs.mkdir(config.uploadDir, { recursive: true });
const migratedTasks = await migrateLegacyTasks();
if (migratedTasks) console.info(JSON.stringify({ type: "legacy_task_migration", migratedTasks, at: new Date().toISOString() }));
const cleanupUploads = async () => {
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
  const httpClosed = new Promise<void>((resolve) => server.close(() => resolve()));
  // SSE connections are intentionally long-lived. Give ordinary requests time to finish,
  // then close remaining streams so a blue/green retirement cannot hang indefinitely.
  const forceClose = setTimeout(() => server.closeAllConnections(), Math.min(config.shutdownGraceMs, 10_000));
  await httpClosed; clearTimeout(forceClose);
  await Promise.all([generationQueue.close(), imageGenerationQueue.close(), mediaQueue.close(), previewQueue.close(), assetQueue.close(), canvasQueue.close()]);
  await redis.quit(); users.close(); process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
