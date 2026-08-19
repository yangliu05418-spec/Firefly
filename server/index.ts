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
import { users, type CanvasProject, type UserAsset } from "./db.js";
import { canvasDocumentSchema, DEFAULT_CANVAS_DOCUMENT } from "./canvas-document.js";
import { publicCanvasProject, publicCanvasProjectDetail } from "./canvas-public.js";
import { consumeFeishuAuthorization, createFeishuAuthorization, exchangeFeishuCode } from "./feishu.js";
import { generationQueue, listTasksForUser, mediaQueue, migrateLegacyTasks, readTask, redis, saveTask, type StoredTask } from "./redis.js";
import { canAccessTask } from "./task-access.js";
import { publicTask } from "./task-public.js";
import { validateGeneration } from "./provider.js";
import { callAssetApi } from "./asset-api.js";
import { ensureAutoReferenceGroup } from "./asset-registration.js";
import { previewRedirectCacheControl } from "./media-cache.js";
import { stablePreviewUrl } from "./preview-url-cache.js";
import { abortMultipartUpload, completeMultipartUpload, createMultipartUpload, deleteObject, headObject, inputObjectKey, inspectMediaObject, signUploadPart, signedObjectUrl, tosConfigured, tosEnabled, tosHealth } from "./tos.js";
import { createCanvasAssetFromUpload } from "./canvas-assets.js";
import { resolveUploadMediaUrl } from "./media-url.js";
import { IMAGE_MODELS, IMAGE_RATIOS, imageModelById, computeImageSize, DEFAULT_IMAGE_MODEL } from "./image-models.js";
import { acquireImageSlot, downloadImageBuffer, generateSingleImage, openRouterPool, OpenRouterError, releaseImageSlot } from "./openrouter.js";
import { storeGeneratedImage } from "./generated-media.js";

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
  res.status(status).json({ error: message, ...(code ? { code } : {}), requestId: res.locals.requestId });
};
const param = (value: string | string[]) => Array.isArray(value) ? value[0] : value;
const execFileAsync = promisify(execFile);

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

/** 执行 ffprobe：60s 超时 + 瞬时失败重试一次；失败信息携带 stderr/超时标记/耗时（可观测） */
const runFfprobe = async (filePath: string) => {
  const startedAt = Date.now();
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate", "-show_entries", "format=duration", "-of", "json", filePath], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
      return { stdout, elapsedMs: Date.now() - startedAt };
    } catch (error) {
      lastError = error;
    }
  }
  const detail = lastError as { stderr?: string; killed?: boolean; signal?: string; message?: string } | undefined;
  const reason = detail?.stderr?.trim().slice(0, 300) || detail?.message || "ffprobe 无法读取素材";
  throw new Error("素材校验失败：" + reason + (detail?.killed ? "（读取超时）" : "") + "（耗时 " + (Date.now() - startedAt) + "ms）");
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
    if (tosEnabled()) {
      if (!tosConfigured()) throw new Error("TOS 存储尚未配置完成");
      const objectKey = inputObjectKey(owner.id, id, name);
      const tosUploadId = await createMultipartUpload(objectKey, meta.mime || "application/octet-stream", name);
      const partSize = config.tosUploadPartSize;
      const partCount = Math.ceil(meta.size / partSize);
      const stored = { ...meta, name, ownerId: owner.id, objectKey, tosUploadId, partSize, partCount, direct: true, createdAt: Date.now() };
      await redis.set(`upload:${id}`, JSON.stringify(stored), "EX", 24 * 3600);
      const parts = Array.from({ length: partCount }, (_, index) => ({ partNumber: index + 1, url: signUploadPart(objectKey, tosUploadId, index + 1) }));
      console.info(JSON.stringify({ type: "tos_upload_started", at: new Date().toISOString(), userId: owner.id, uploadId: id, size: meta.size, parts: partCount }));
      return res.status(201).json({ id, direct: true, chunkSize: partSize, concurrency: config.tosUploadConcurrency, parts });
    }
    const dir = path.join(config.uploadDir, id);
    await fs.mkdir(dir, { recursive: true, mode: 0o750 });
    const stored = { ...meta, name, received: 0, createdAt: Date.now(), ownerId: owner.id, mediaExpiresAt: Date.now() + 24 * 3600 * 1000, direct: false };
    await redis.set(`upload:${id}`, JSON.stringify(stored), "EX", 24 * 3600);
    res.status(201).json({ id, chunkSize: 16 * 1024 * 1024 });
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

app.post("/api/uploads/:id/chunks", requireAuth, express.raw({ type: "application/octet-stream", limit: "17mb" }), async (req, res) => {
  try {
    const uploadId = param(req.params.id);
    const raw = await redis.get(`upload:${uploadId}`);
    if (!raw) throw new Error("上传已过期，请重新选择文件");
    const meta = JSON.parse(raw);
    if (meta.ownerId !== (res.locals.user as SessionUser).id) return res.status(404).json({ error: "上传不存在或已过期" });
    if (meta.direct) return res.status(409).json({ error: "当前上传使用 TOS 直传" });
    const offset = Number(req.header("x-upload-offset") ?? -1);
    if (offset !== meta.received) return res.status(409).json({ error: "分片顺序不正确", expectedOffset: meta.received });
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length || meta.received + body.length > meta.size) throw new Error("无效的上传分片");
    await fs.appendFile(path.join(config.uploadDir, uploadId, "payload"), body);
    meta.received += body.length;
    await redis.set(`upload:${uploadId}`, JSON.stringify(meta), "EX", 24 * 3600);
    res.json({ received: meta.received });
  } catch (error) { respondError(res, error); }
});

app.post("/api/uploads/:id/complete", requireAuth, async (req, res) => {
  try {
    const startedAt = Date.now();
    const uploadId = param(req.params.id);
    const raw = await redis.get(`upload:${uploadId}`);
    if (!raw) throw new Error("上传已过期，请重新选择文件");
    const meta = JSON.parse(raw);
    if (meta.ownerId !== (res.locals.user as SessionUser).id) return res.status(404).json({ error: "上传不存在或已过期" });
    if (meta.direct) {
      const body = z.object({ parts: z.array(z.object({ partNumber: z.number().int().min(1), eTag: z.string().min(1).max(256) })) }).parse(req.body);
      const parts = [...body.parts].sort((a, b) => a.partNumber - b.partNumber);
      if (parts.length !== meta.partCount || parts.some((part, index) => part.partNumber !== index + 1)) throw new Error("上传分片不完整或顺序错误");
      const stageLog = (stage: string, extra: Record<string, unknown> = {}) => console.info(JSON.stringify({ type: "upload_complete_stage", at: new Date().toISOString(), uploadId, userId: meta.ownerId, stage, elapsedMs: Date.now() - startedAt, ...extra }));
      stageLog("start");
      try {
        await completeMultipartUpload(meta.objectKey, meta.tosUploadId, parts);
        stageLog("merged");
        const head = await headObject(meta.objectKey);
        const size = Number(head.headers["content-length"] ?? 0);
        if (size !== meta.size) throw new Error("TOS 合并后的文件大小不一致");
        stageLog("headed", { size });
        const validationUrl = signedObjectUrl(meta.objectKey, { expires: 900, fileName: meta.name });
        await inspectMediaObject(meta.objectKey, meta.type);
        stageLog("inspected");
        // ffprobe 软校验：TOS image/video info 已权威校验格式与尺寸；此处仅额外探测可解码性，
        // 失败只告警不阻塞（避免跨洋拉取抖动导致上传必然失败）
        try {
          await validateMedia(validationUrl, meta.type);
          stageLog("probed");
        } catch (probeError) {
          if (probeError instanceof MediaValidationError) {
            // 确定性规格违规（尺寸/时长/FPS/编码）：源头拒绝，避免流入素材服务（CreateAsset）产生难以理解的 502
            stageLog("probe_rejected");
            throw probeError;
          }
          console.warn(JSON.stringify({ type: "upload_probe_soft_failed", at: new Date().toISOString(), uploadId, userId: meta.ownerId, message: probeError instanceof Error ? probeError.message.slice(0, 300) : undefined }));
          stageLog("probe_soft_failed");
        }
        const now = Date.now();
        users.upsertMedia({ id: `input:${uploadId}`, ownerId: meta.ownerId, uploadId, kind: "input", objectKey: meta.objectKey, status: "ready", fileName: meta.name, contentType: String(head.headers["content-type"] ?? meta.mime ?? "application/octet-stream"), size, etag: String(head.headers.etag ?? ""), createdAt: now, updatedAt: now });
        await redis.del(`upload:${uploadId}`);
        console.info(JSON.stringify({ type: "tos_upload_completed", at: new Date().toISOString(), userId: meta.ownerId, uploadId, size, requestId: head.requestId }));
        return res.json({ id: uploadId, uploadId, name: meta.name, type: meta.type, size });
      } catch (error) {
        console.warn(JSON.stringify({ type: "tos_upload_failed", at: new Date().toISOString(), userId: meta.ownerId, uploadId, errorCode: (error as { code?: string }).code ?? "validation_failed", message: error instanceof Error ? error.message.slice(0, 400) : undefined }));
        await abortMultipartUpload(meta.objectKey, meta.tosUploadId).catch(() => undefined);
        await deleteObject(meta.objectKey).catch(() => undefined);
        await redis.del(`upload:${uploadId}`);
        throw error;
      }
    }
    if (meta.received !== meta.size) throw new Error("文件上传尚未完成");
    const finalPath = path.join(config.uploadDir, uploadId, meta.name);
    await fs.rename(path.join(config.uploadDir, uploadId, "payload"), finalPath);
    try { await validateMedia(finalPath, meta.type); } catch (error) { await fs.rm(path.join(config.uploadDir, uploadId), { recursive: true, force: true }); await redis.del(`upload:${uploadId}`); throw error; }
    // 统一引用形态：legacy 后端同样登记 media_objects（kind=input），与 TOS 路径一致，避免双栈引用语义分叉
    const now = Date.now();
    users.upsertMedia({ id: `input:${uploadId}`, ownerId: meta.ownerId, uploadId, kind: "input", objectKey: `legacy/${uploadId}/${meta.name}`, status: "ready", fileName: meta.name, contentType: meta.mime || "application/octet-stream", size: meta.size, etag: "", createdAt: now, updatedAt: now });
    const publicUrl = await resolveUploadMediaUrl({ objectKey: `legacy/${uploadId}/${meta.name}`, uploadId, fileName: meta.name });
    res.json({ id: uploadId, name: meta.name, type: meta.type, size: meta.size, url: publicUrl });
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

app.post("/api/generations", requireAuth, async (req, res) => {
  try {
    const requestedInput = validateGeneration(req.body);
    const owner = res.locals.user as SessionUser;
    if (users.countActiveTasksForUser(owner.id) >= config.maxActiveGenerationsPerUser) return res.status(429).json({ error: `你已有 ${config.maxActiveGenerationsPerUser} 个任务正在生成，请等待其中一个完成`, requestId: res.locals.requestId });
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
    const task: StoredTask = { id, ownerId: owner.id, visibility: "private", status: "queued", mediaStatus: "none", mediaRevision: 0, prompt: input.prompt, model: input.model, mode: input.mode, ratio: input.ratio, resolution: input.resolution, duration: input.duration, request: requestedInput, createdAt: now, updatedAt: now };
    await saveTask(task);
    try {
      await generationQueue.add("generate", { input }, { jobId: id, attempts: 4, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: { age: 7 * 24 * 3600 }, removeOnFail: { age: 7 * 24 * 3600 } });
    } catch (error) {
      const failed = { ...task, status: "failed" as const, error: "任务进入生成队列失败，请重新提交", updatedAt: Date.now() };
      await saveTask(failed);
      console.error(JSON.stringify({ type: "generation_enqueue_failed", at: new Date().toISOString(), taskId: id, userId: owner.id, code: (error as { code?: string }).code ?? "unknown" }));
      return res.status(503).json({ error: `${failed.error}（Case ID: ${id}）`, caseId: id });
    }
    console.info(JSON.stringify({ type: "generation_queued", at: new Date().toISOString(), requestId: res.locals.requestId, taskId: id, userId: owner.id, model: input.model, mode: input.mode, assetCount: input.assets.length }));
    res.status(202).json(publicTask(task));
  } catch (error) { respondError(res, error); }
});

app.get("/api/generations", requireAuth, async (_req, res) => {
  res.json((await listTasksForUser((res.locals.user as SessionUser).id)).map(publicTask));
});
app.get("/api/generations/:id", requireAuth, async (req, res) => {
  const task = await readTask(param(req.params.id));
  task && canAccessTask(task, (res.locals.user as SessionUser).id) ? res.json(publicTask(task)) : res.status(404).json({ error: "任务不存在或已过期" });
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
    const media = task.mediaStatus === "ready" ? (users.readTaskMedia(task.id, "preview") ?? users.readTaskMedia(task.id, "output")) : null;
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
const publicUserAsset = (asset: UserAsset) => ({ Id: asset.id, Name: asset.name, AssetType: asset.assetType, Status: asset.status, URL: asset.url, GroupId: asset.groupId, UploadId: asset.uploadId });
const refreshUserAsset = async (asset: UserAsset) => {
  if (asset.status === "Active" && asset.url) return asset;
  try {
    const provider = await callAssetApi<ProviderAssetRecord>("GetAsset", { Id: asset.id });
    const updated: UserAsset = { ...asset, name: provider.Name ?? asset.name, assetType: provider.AssetType ?? asset.assetType, status: provider.Status ?? asset.status, url: provider.URL ?? asset.url, groupId: provider.GroupId ?? asset.groupId, updatedAt: Date.now() };
    users.upsertUserAsset(updated);
    return updated;
  } catch (error) {
    console.warn(JSON.stringify({ type: "user_asset_refresh_failed", at: new Date().toISOString(), assetId: asset.id, ownerId: asset.ownerId, code: (error as { code?: string }).code ?? "unknown" }));
    return asset;
  }
};
const refreshUserAssetList = async (assets: UserAsset[]) => {
  const refreshed = new Array<UserAsset>(assets.length); let cursor = 0;
  const next = async () => { while (cursor < assets.length) { const index = cursor++; const asset = assets[index]; if (asset) refreshed[index] = await refreshUserAsset(asset); } };
  await Promise.all(Array.from({ length: Math.min(6, Math.max(1, assets.length)) }, next));
  return refreshed;
};
const ownedUserAsset = (assetId: string, ownerId: string) => { const asset = users.readUserAsset(assetId); return asset?.ownerId === ownerId ? asset : null; };

app.get("/api/assets/groups", requireAuth, async (_req, res) => {
  try { const groupId = await ensureAutoReferenceGroup(); res.json({ Items: [{ Id: groupId, Name: "我的素材", Description: "仅当前用户可见" }] }); } catch (error) { respondError(res, error, 502); }
});
app.post("/api/assets/groups", requireAuth, async (req, res) => {
  try { z.object({ name: z.string().min(1).max(80), description: z.string().max(200).default("") }).parse(req.body); const groupId = await ensureAutoReferenceGroup(); res.status(201).json({ Id: groupId, Name: "我的素材" }); } catch (error) { respondError(res, error, 502); }
});
app.get("/api/assets", requireAuth, async (req, res) => {
  try {
    const query = z.object({ q: z.string().max(80).optional(), type: z.enum(["Image", "Video", "Audio"]).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(100) }).parse(req.query);
    const user = res.locals.user as SessionUser;
    const assets = users.listUserAssets(user.id, query.q ?? "", query.pageSize + 1, query.type, (query.page - 1) * query.pageSize);
    const hasMore = assets.length > query.pageSize;
    res.json({ Items: (await refreshUserAssetList(assets.slice(0, query.pageSize))).map(publicUserAsset), PageNumber: query.page, PageSize: query.pageSize, HasMore: hasMore });
  } catch (error) { respondError(res, error, 502); }
});
app.post("/api/assets", requireAuth, async (req, res) => {
  try {
    const body = z.object({ groupId: z.string().startsWith("group-").optional(), url: z.string().url().optional(), uploadId: z.string().min(20).optional(), type: z.enum(["Image", "Video", "Audio"]), name: z.string().min(1).max(80) }).refine((value) => Boolean(value.url || value.uploadId), "素材缺少可用地址").parse(req.body);
    const user = res.locals.user as SessionUser;
    const groupId = await ensureAutoReferenceGroup();
    let url = body.url;
    if (body.uploadId) {
      const existing = users.readUserAssetByUpload(user.id, body.uploadId);
      if (existing) return res.status(201).json(publicUserAsset(existing));
      const media = users.readUpload(body.uploadId);
      if (!media || media.ownerId !== user.id) return res.status(404).json({ error: "引用素材不存在或已过期" });
      url = signedObjectUrl(media.objectKey, { expires: 24 * 3600, fileName: media.fileName });
    }
    const created = await callAssetApi<ProviderAssetRecord>("CreateAsset", { GroupId: groupId, URL: url, AssetType: body.type, Name: body.name });
    if (!created.Id?.startsWith("asset-")) throw new Error("素材服务未返回有效资产 ID");
    const now = Date.now();
    const asset: UserAsset = { id: created.Id, ownerId: user.id, groupId, uploadId: body.uploadId, name: created.Name ?? body.name, assetType: created.AssetType ?? body.type, status: created.Status ?? "Processing", url: created.URL, createdAt: now, updatedAt: now };
    users.upsertUserAsset(asset);
    console.info(JSON.stringify({ type: "user_asset_mutation", action: "create_asset", userId: user.id, assetId: asset.id, at: new Date().toISOString() }));
    res.status(201).json(publicUserAsset(asset));
  } catch (error) {
    // 素材服务对尺寸不合规素材返回英文错误，翻译为清晰中文提示（兜底，正常在 complete 阶段已被拦截）
    const message = error instanceof Error ? error.message : "";
    if (/between 300px and 6000px|out of range|height.{0,40}(?:300|6000)|width.{0,40}(?:300|6000)/i.test(message)) {
      return res.status(400).json({ error: "图片尺寸不符合官方要求（300–6000px，宽高比 0.4–2.5），请上传符合要求的图片", requestId: res.locals.requestId });
    }
    console.warn(JSON.stringify({ type: "asset_create_failed", at: new Date().toISOString(), userId: user.id, uploadId: body.uploadId ?? null, message: message.slice(0, 300) }));
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
    const next = async () => { while (cursor < deletable.length) { const id = deletable[cursor++]; if (!id) continue; try { await callAssetApi("DeleteAsset", { Id: id }); users.deleteUserAsset(id, user.id); deleted.push(id); } catch { failed.push(id); } } };
    await Promise.all(Array.from({ length: Math.min(4, deletable.length) }, next));
    console.info(JSON.stringify({ type: "user_asset_mutation", action: "bulk_delete", userId: user.id, deleted: deleted.length, failed: failed.length, at: new Date().toISOString() }));
    res.json({ deleted, failed });
  } catch (error) { respondError(res, error, 502); }
});
app.get("/api/assets/:id", requireAuth, async (req, res) => {
  try { const user = res.locals.user as SessionUser; const asset = ownedUserAsset(param(req.params.id), user.id); if (!asset) return res.status(404).json({ error: "素材不存在" }); res.json(publicUserAsset(await refreshUserAsset(asset))); } catch (error) { respondError(res, error, 502); }
});
app.patch("/api/assets/:id", requireAuth, async (req, res) => {
  try { const body = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body); const user = res.locals.user as SessionUser; const id = param(req.params.id); if (!ownedUserAsset(id, user.id)) return res.status(404).json({ error: "素材不存在" }); await callAssetApi("UpdateAsset", { Id: id, Name: body.name }); users.renameUserAsset(id, user.id, body.name); console.info(JSON.stringify({ type: "user_asset_mutation", action: "rename_asset", userId: user.id, assetId: id, at: new Date().toISOString() })); res.json(publicUserAsset(users.readUserAsset(id)!)); } catch (error) { respondError(res, error, 502); }
});
app.delete("/api/assets/:id", requireAuth, async (req, res) => {
  try { const user = res.locals.user as SessionUser; const id = param(req.params.id); if (!ownedUserAsset(id, user.id)) return res.status(404).json({ error: "素材不存在" }); if (users.isUserAssetInActiveTask(id, user.id)) return res.status(409).json({ error: "素材正被运行中的任务引用，任务结束后即可删除" }); await callAssetApi("DeleteAsset", { Id: id }); users.deleteUserAsset(id, user.id); console.info(JSON.stringify({ type: "user_asset_mutation", action: "delete_asset", userId: user.id, assetId: id, at: new Date().toISOString() })); res.status(204).end(); } catch (error) { respondError(res, error, 502); }
});



// ---- OpenRouter 图片生成 ----
const imageGenerationSchema = z.object({
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

app.post("/api/image-generation", requireAuth, async (req, res) => {
  try {
    const body = imageGenerationSchema.parse(req.body);
    const user = res.locals.user as SessionUser;
    const spec = imageModelById(body.model);
    if (!spec) return res.status(400).json({ error: "未知的图片模型" });
    if (body.count > spec.maxCount) return res.status(400).json({ error: "该模型单次最多生成 " + spec.maxCount + " 张" });
    if (!spec.resolutions.includes(body.resolution)) return res.status(400).json({ error: "该模型不支持此分辨率档位" });
    const size = computeImageSize(body.ratio, Number(body.resolution), spec.maxSize);
    // 参考图（图生图）：uploadId → 签名地址（临时，仅供本次请求）
    const references: string[] = [];
    for (const uploadId of body.references) {
      const media = users.readUpload(uploadId);
      if (!media || media.ownerId !== user.id) return res.status(404).json({ error: "参考素材不存在或已过期" });
      references.push(signedObjectUrl(media.objectKey, { expires: 2 * 3600, fileName: media.fileName }));
    }
    if (!openRouterPool().size) return res.status(503).json({ error: "服务端尚未配置 OpenRouter API Key" });
    if (!acquireImageSlot(user.id)) return res.status(429).json({ error: "图片生成繁忙，请等当前生成完成后再试（每用户同时最多 2 组）" });
    const startedAt = Date.now();
    let slotReleased = false;
    const releaseSlot = () => { if (!slotReleased) { slotReleased = true; releaseImageSlot(user.id); } };
    res.on("finish", releaseSlot);
    res.on("close", releaseSlot);
    console.info(JSON.stringify({ type: "image_generation_started", at: new Date().toISOString(), userId: user.id, model: body.model, ratio: body.ratio, resolution: body.resolution, size, count: body.count, references: references.length, healthyKeys: openRouterPool().healthyCount() }));
    // 并发生成（上限 2），逐个落盘
    let cursor = 0;
    const items: { mediaId: string; width?: number; height?: number }[] = [];
    const failures: string[] = [];
    const worker = async () => {
      while (cursor < body.count) {
        const index = cursor++;
        try {
          const url = await generateSingleImage({ model: body.model, prompt: body.prompt, references, size });
          const buffer = await downloadImageBuffer(url);
          const contentType = url.startsWith("data:image/png") ? "image/png" : url.startsWith("data:image/webp") ? "image/webp" : url.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png";
          const media = await storeGeneratedImage({ ownerId: user.id, body: buffer, contentType, fileName: "nano-image-" + (index + 1) + ".png" });
          items.push({ mediaId: media.id });
          console.info(JSON.stringify({ type: "image_generation_completed", at: new Date().toISOString(), userId: user.id, mediaId: media.id, index, bytes: buffer.length }));
        } catch (error) {
          failures.push(error instanceof Error ? error.message : "生成失败");
          console.warn(JSON.stringify({ type: "image_generation_failed", at: new Date().toISOString(), userId: user.id, index, code: (error as { code?: string }).code ?? "unknown", message: error instanceof Error ? error.message : undefined }));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, body.count) }, worker));
    if (!items.length) {
      const message = failures[0] ?? "图片生成失败";
      return res.status(502).json({ error: message, requestId: res.locals.requestId });
    }
    console.info(JSON.stringify({ type: "image_generation_done", at: new Date().toISOString(), userId: user.id, model: body.model, requested: body.count, ok: items.length, failed: failures.length, elapsedMs: Date.now() - startedAt }));
    res.json({ Items: items, Model: body.model, Ratio: body.ratio, Resolution: body.resolution, Failed: failures });
  } catch (error) {
    if (error instanceof OpenRouterError) console.warn(JSON.stringify({ type: "image_generation_error", at: new Date().toISOString(), status: error.status, message: error.message }));
    respondError(res, error, error instanceof OpenRouterError ? (error.status === "network" ? 502 : 502) : 400);
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
    res.redirect(302, signedObjectUrl(media.objectKey, download ? { download: true, fileName: media.fileName } : { fileName: media.fileName }));
  } catch (error) { respondError(res, error, 502); }
});

// ---- Canvas projects ----
const canvasListQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) });
const canvasTitleBodySchema = z.object({ title: z.string().trim().min(1, "画布名称不能为空").max(80, "画布名称不能超过 80 个字符") });
const canvasSaveBodySchema = z.object({ revision: z.number().int().min(0), document: canvasDocumentSchema });
const canvasMediaImportSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("generation"), taskId: z.string().min(1).max(120) }),
  z.object({ kind: z.literal("upload"), uploadId: z.string().min(20).max(200) }),
  z.object({ kind: z.literal("generated"), mediaId: z.string().min(1).max(120) }),
]);
const accessibleCanvas = (id: string, userId: string) => {
  const project = users.readCanvasProject(id);
  return project && project.ownerId === userId ? project : null;
};

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
      documentJson: JSON.stringify(DEFAULT_CANVAS_DOCUMENT), revision: 0, createdAt: now, updatedAt: now
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
      const media = users.readTaskMedia(task.id, "output") ?? users.readTaskMedia(task.id, "preview");
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
      console.info(JSON.stringify({ type: "canvas_media_import", kind: "generation", userId: user.id, canvasId, taskId: task.id, width, height, durationMs, at: new Date().toISOString() }));
      res.json({ mediaRef: { source: "generation", taskId: task.id }, title: task.prompt || "参考素材生成", fileName: media.fileName, width, height, durationMs });
      return;
    }
    if (body.kind === "upload") {
    const asset = await createCanvasAssetFromUpload({ source: { kind: "upload", uploadId: body.uploadId }, ownerId: user.id, canvasId });
    console.info(JSON.stringify({ type: "canvas_media_import", kind: "upload", userId: user.id, canvasId, assetId: asset.id, at: new Date().toISOString() }));
    res.status(201).json({ mediaRef: { source: "canvas-asset", assetId: asset.id }, title: asset.fileName, fileName: asset.fileName, status: asset.status });
    return;
    }
    if (body.kind === "generated") {
      const media = users.readMedia(body.mediaId);
      if (!media || media.ownerId !== user.id || media.kind !== "generated" || media.status !== "ready") return res.status(404).json({ error: "生成图片不存在或尚未就绪" });
      const asset = await createCanvasAssetFromUpload({ source: { kind: "object", objectKey: media.objectKey, fileName: media.fileName, contentType: media.contentType, ownerId: media.ownerId }, ownerId: user.id, canvasId });
      console.info(JSON.stringify({ type: "canvas_media_import", kind: "generated", userId: user.id, canvasId, mediaId: media.id, assetId: asset.id, at: new Date().toISOString() }));
      res.status(201).json({ mediaRef: { source: "canvas-asset", assetId: asset.id }, title: asset.fileName, fileName: asset.fileName, status: asset.status });
    }
  } catch (error) { respondError(res, error, 502); }
});

app.get("/api/canvas-media/:assetId", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user as SessionUser;
    const asset = users.readCanvasAsset(param(req.params.id));
    if (!asset || asset.ownerId !== user.id) return res.status(404).json({ error: "画布素材不存在" });
    if (asset.status === "copying") return res.status(425).json({ error: "素材正在迁移到长期存储，请稍后重试" });
    if (asset.status === "failed") return res.status(425).json({ error: "素材迁移失败，请删除节点后重新插入" });
    res.setHeader("Cache-Control", previewRedirectCacheHeader);
    res.setHeader("Vary", "Cookie");
    res.redirect(302, signedObjectUrl(asset.objectKey, { fileName: asset.fileName }));
  } catch (error) { respondError(res, error, 502); }
});

let latestTosHealth: { configured: boolean; reachable: boolean; checkedAt?: string } = { configured: tosConfigured(), reachable: false };
const probeTos = async () => { latestTosHealth = { ...await tosHealth(), checkedAt: new Date().toISOString() }; };

app.get("/api/health", async (_req, res) => {
  try {
    await redis.ping();
    if (!users.healthCheck()) throw new Error("database unavailable");
    res.json({ status: "ok", redis: "ok", database: "ok", tosConfigured: latestTosHealth.configured, tosReachable: latestTosHealth.reachable, tosCheckedAt: latestTosHealth.checkedAt });
  } catch { res.status(503).json({ status: "degraded", redis: "unavailable", database: "unavailable", tosConfigured: latestTosHealth.configured, tosReachable: latestTosHealth.reachable }); }
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
const shutdown = async () => { clearInterval(cleanupTimer); clearInterval(tosProbeTimer); server.close(); await Promise.all([generationQueue.close(), mediaQueue.close()]); await redis.quit(); users.close(); process.exit(0); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
