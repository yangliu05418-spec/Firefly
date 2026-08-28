import crypto from "node:crypto";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { AtlasStore, type AtlasGlobalAssetRegistration, type AtlasMediaKind, type AtlasProject, type AtlasProjectAsset, type AtlasTransfer, type AtlasTransferPart } from "./atlas-store.js";

const GIB = 1024 * 1024 * 1024;
const DEFAULT_PART_SIZE = 16 * 1024 * 1024;
const DEFAULT_TRANSFER_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LEASE_TTL_MS = 45_000;
const DEFAULT_MAX_ACTIVE_TRANSFERS_PER_USER = 8;
// TOS CopyObject accepts source objects up to 5 GiB. Atlas local multipart
// upload remains 8 GiB; a larger existing Firefly object must be selected from
// the device until durable UploadPartCopy is implemented.
const TOS_COPY_OBJECT_MAX_BYTES = 5 * GIB;

export type AtlasVerifiedObject = { size: number; contentType: string; etag: string; metadata?: Record<string, string> };
export type AtlasImportSource = {
  objectKey: string;
  fileName: string;
  kind: AtlasMediaKind;
  contentType: string;
  size: number;
};

export type AtlasStorageDependencies = {
  createMultipartUpload: (input: { objectKey: string; contentType: string; fileName: string; metadata?: Record<string, string> }) => Promise<string>;
  signUploadPart: (input: { objectKey: string; uploadId: string; partNumber: number }) => string | Promise<string>;
  listParts: (input: { objectKey: string; uploadId: string }) => Promise<AtlasTransferPart[]>;
  completeMultipartUpload: (input: { objectKey: string; uploadId: string; parts: AtlasTransferPart[] }) => Promise<void>;
  abortMultipartUpload: (input: { objectKey: string; uploadId: string }) => Promise<void>;
  deleteObject: (objectKey: string) => Promise<void>;
  verifyObject: (objectKey: string) => Promise<AtlasVerifiedObject>;
  copyObject: (input: { sourceObjectKey: string; destinationObjectKey: string; contentType: string; fileName: string }) => Promise<void>;
  signedObjectUrl: (objectKey: string, options: { fileName: string; attachment: boolean }) => string | Promise<string>;
  enqueueDelete: (objectKey: string) => void | Promise<void>;
};

export type AtlasRouterDependencies = {
  store: AtlasStore;
  requireAuth: RequestHandler;
  storage: AtlasStorageDependencies;
  resolveImportSource: (input: { ownerId: string; sourceType: "user_asset" | "generation" | "generated" | "canvas_project"; sourceId: string }) => Promise<AtlasImportSource | null>;
  registerGlobalAsset?: (input: {
    id: string; ownerId: string; name: string; objectKey: string; contentType: string; size: number; etag: string;
    category: "material"; assetType: "Video"; status: "Active";
  }) => unknown | Promise<unknown>;
  enabled?: boolean;
  agentEnabled?: boolean;
  maxUploadBytes?: number;
  partSize?: number;
  leaseTtlMs?: number;
  now?: () => number;
  randomId?: () => string;
};

class AtlasRouteError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const asyncRoute = (handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => void handler(req, res).catch((error) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message ?? "请求参数无效", code: "ATLAS_REQUEST_INVALID" });
    if (error instanceof AtlasRouteError) return res.status(error.status).json({ error: error.message, code: error.code });
    next(error);
  });

const userId = (res: Response) => {
  const id = (res.locals.user as { id?: unknown } | undefined)?.id;
  if (typeof id !== "string" || !id) throw new AtlasRouteError(401, "ATLAS_AUTH_REQUIRED", "请使用企业飞书账号登录");
  return id;
};
const param = (value: string | string[]) => Array.isArray(value) ? value[0] : value;
const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const shard = (value: string) => sha256(value).slice(0, 2);
const safeName = (value: string) => value.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120) || "media";
const atlasAssetObjectKey = (ownerId: string, projectId: string, assetId: string, fileName: string) =>
  `atlas/assets/${shard(assetId)}/${ownerId}/${projectId}/${assetId}/${safeName(fileName)}`;
const atlasCheckpointObjectKey = (ownerId: string, projectId: string, revision: number) =>
  `atlas/checkpoints/${shard(projectId)}/${ownerId}/${projectId}/${revision}.json.gz`;
const atlasExportObjectKey = (ownerId: string, projectId: string, exportId: string) =>
  `atlas/exports/${shard(exportId)}/${ownerId}/${projectId}/${exportId}/result.mp4`;
const leaseHash = (token: string) => sha256(token);

const publicProject = (project: AtlasProject) => ({
  id: project.id, title: project.title, revision: project.revision,
  hasCheckpoint: Boolean(project.latestVersionId), leaseDeviceId: project.leaseDeviceId,
  leaseExpiresAt: project.leaseExpiresAt, createdAt: project.createdAt, updatedAt: project.updatedAt,
});
const publicAsset = (asset: AtlasProjectAsset) => ({
  id: asset.id, projectId: asset.projectId, sourceType: asset.sourceType, sourceId: asset.sourceId,
  kind: asset.kind, fileName: asset.fileName, contentType: asset.contentType, size: asset.size,
  status: asset.status, error: asset.error, createdAt: asset.createdAt, updatedAt: asset.updatedAt,
  mediaUrl: asset.status === "ready" ? `/api/atlas/project-assets/${asset.id}/media` : undefined,
});
const publicTransfer = (transfer: AtlasTransfer) => ({
  id: transfer.id, projectId: transfer.projectId, assetId: transfer.assetId, versionId: transfer.versionId,
  kind: transfer.kind, size: transfer.size, partSize: transfer.partSize, partCount: transfer.partCount,
  status: transfer.status, expiresAt: transfer.expiresAt,
});

const projectTitle = z.string().trim().min(1, "项目名称不能为空").max(120, "项目名称不能超过120个字符");
const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
const leaseToken = z.string().min(32).max(256);
const partsSchema = z.array(z.object({
  partNumber: z.number().int().positive().max(10_000),
  etag: z.string().trim().min(1).max(512),
})).min(1).max(10_000);

const validateCompleteParts = (parts: AtlasTransferPart[], transfer: AtlasTransfer) => {
  const sorted = [...parts].sort((left, right) => left.partNumber - right.partNumber);
  if (sorted.length !== transfer.partCount || sorted.some((part, index) => part.partNumber !== index + 1)) {
    throw new AtlasRouteError(400, "ATLAS_UPLOAD_PARTS_INCOMPLETE", "上传分片不完整，请继续上传缺失部分");
  }
  return sorted;
};

const normalizeStoredParts = (parts: AtlasTransferPart[], transfer: AtlasTransfer) => {
  const byNumber = new Map<number, AtlasTransferPart>();
  for (const part of parts) {
    const withinKnownShape = transfer.partCount === 0 ? part.partNumber <= 10_000 : part.partNumber <= transfer.partCount;
    if (Number.isInteger(part.partNumber) && part.partNumber > 0 && withinKnownShape && typeof part.etag === "string" && part.etag) {
      byNumber.set(part.partNumber, { partNumber: part.partNumber, etag: part.etag });
    }
  }
  return [...byNumber.values()].sort((left, right) => left.partNumber - right.partNumber);
};

const readCompletedParts = async (storage: AtlasStorageDependencies, store: AtlasStore, transfer: AtlasTransfer, ownerId: string, now: number) => {
  const completed = normalizeStoredParts(await storage.listParts({ objectKey: transfer.objectKey, uploadId: transfer.tosUploadId! }), transfer);
  store.recordTransferParts(transfer.id, ownerId, completed, now);
  return completed;
};

const mergeCompletedParts = (reported: AtlasTransferPart[], completed: AtlasTransferPart[], transfer: AtlasTransfer) =>
  normalizeStoredParts([...reported, ...completed], transfer);

const assertTransferNotExpired = (transfer: AtlasTransfer, at: number) => {
  if (transfer.expiresAt <= at && !["completed", "cancelled"].includes(transfer.status)) {
    throw new AtlasRouteError(410, "ATLAS_UPLOAD_EXPIRED", "上传会话已过期，请重新开始上传");
  }
};

const isObjectNotFound = (error: unknown) => {
  const status = Number((error as { statusCode?: number; status?: number }).statusCode
    ?? (error as { statusCode?: number; status?: number }).status ?? 0);
  const code = String((error as { code?: string; name?: string }).code
    ?? (error as { code?: string; name?: string }).name ?? "");
  return status === 404 || /NoSuchKey|NotFound|ObjectNotFound/i.test(code);
};

const verifyExpectedObject = async (storage: AtlasStorageDependencies, transfer: AtlasTransfer, digest?: string) => {
  const verified = await storage.verifyObject(transfer.objectKey);
  if (verified.size !== transfer.size) throw new AtlasRouteError(422, "ATLAS_UPLOAD_SIZE_MISMATCH", "上传对象大小与项目记录不一致");
  const expectedContentType = transfer.contentType.split(";", 1)[0]!.trim().toLowerCase();
  const actualContentType = verified.contentType.split(";", 1)[0]!.trim().toLowerCase();
  if (actualContentType !== expectedContentType) {
    throw new AtlasRouteError(422, "ATLAS_UPLOAD_TYPE_MISMATCH", "上传对象类型与项目记录不一致");
  }
  const actualDigest = verified.metadata?.sha256?.trim().toLowerCase();
  if (digest && actualDigest !== digest.trim().toLowerCase()) {
    throw new AtlasRouteError(422, "ATLAS_CHECKPOINT_DIGEST_MISMATCH", "项目检查点完整性校验失败");
  }
  return verified;
};

const verifyCompletedTransfer = async (
  storage: AtlasStorageDependencies,
  store: AtlasStore,
  transfer: AtlasTransfer,
  ownerId: string,
  reportedParts: AtlasTransferPart[],
  at: number,
  digest?: string,
) => {
  // CompleteMultipart removes the UploadId immediately. If its response (or
  // this process) is lost, a retry must reconcile the deterministic final key
  // before ListParts, otherwise a successful upload becomes unrecoverable.
  if (transfer.status === "verifying") {
    try { return await verifyExpectedObject(storage, transfer, digest); }
    catch (error) { if (!isObjectNotFound(error)) throw error; }
  }
  let completedParts: AtlasTransferPart[];
  try {
    completedParts = await readCompletedParts(storage, store, transfer, ownerId, at);
  } catch (error) {
    if (transfer.status !== "verifying") throw error;
    try { return await verifyExpectedObject(storage, transfer, digest); }
    catch (verificationError) {
      if (!isObjectNotFound(verificationError)) throw verificationError;
      throw error;
    }
  }
  const parts = validateCompleteParts(mergeCompletedParts(reportedParts, completedParts, transfer), transfer);
  if (!store.markTransferVerifying(transfer.id, ownerId, parts, at)) {
    throw new AtlasRouteError(409, "ATLAS_CHECKPOINT_STATE_CHANGED", "检查点状态已变化，请刷新后重试");
  }
  return completeAndVerify(storage, transfer, parts, digest);
};

const completeAndVerify = async (storage: AtlasStorageDependencies, transfer: AtlasTransfer, parts: AtlasTransferPart[], digest?: string) => {
  try {
    await storage.completeMultipartUpload({ objectKey: transfer.objectKey, uploadId: transfer.tosUploadId!, parts });
  } catch (completeError) {
    try { return await verifyExpectedObject(storage, transfer, digest); }
    catch { throw completeError; }
  }
  return verifyExpectedObject(storage, transfer, digest);
};

const scheduleDelete = (storage: AtlasStorageDependencies, objectKey: string) => {
  void Promise.resolve(storage.enqueueDelete(objectKey)).catch((error) => console.warn(JSON.stringify({
    type: "atlas_delete_handoff_failed", at: new Date().toISOString(), objectKeyHash: sha256(objectKey).slice(0, 16),
    code: (error as { code?: string }).code ?? "unknown",
  })));
};
const scheduleAbort = (
  storage: AtlasStorageDependencies,
  store: AtlasStore,
  transfer: { id: string; ownerId: string; objectKey: string; uploadId: string },
  at: () => number,
) => {
  void storage.abortMultipartUpload(transfer)
    .then(() => { store.markTransferAborted(transfer.id, transfer.ownerId, at()); })
    .catch((error) => console.warn(JSON.stringify({
      type: "atlas_multipart_abort_failed", at: new Date().toISOString(), transferId: transfer.id,
      userId: transfer.ownerId, objectKeyHash: sha256(transfer.objectKey).slice(0, 16),
      code: (error as { code?: string }).code ?? "unknown",
    })));
};

const tryRegisterGlobalAsset = async (
  store: AtlasStore,
  registration: AtlasGlobalAssetRegistration | null,
  register: AtlasRouterDependencies["registerGlobalAsset"],
  at: () => number,
) => {
  if (!registration || registration.status !== "pending" || !register) return;
  try {
    await register({
      id: registration.assetId, ownerId: registration.ownerId, name: registration.name,
      objectKey: registration.objectKey, contentType: registration.contentType,
      size: registration.size, etag: registration.etag,
      category: "material", assetType: "Video", status: "Active",
    });
    store.markGlobalAssetRegistrationCompleted(registration.assetId, registration.ownerId, at());
  } catch (error) {
    store.recordGlobalAssetRegistrationError(
      registration.assetId, registration.ownerId,
      error instanceof Error ? error.message : "全局资产登记失败", at(),
    );
    console.warn(JSON.stringify({
      type: "atlas_global_asset_registration_deferred", at: new Date().toISOString(),
      assetId: registration.assetId, userId: registration.ownerId,
      code: (error as { code?: string }).code ?? "unknown",
    }));
  }
};

export const createAtlasRouter = (dependencies: AtlasRouterDependencies) => {
  const router = express.Router();
  const now = dependencies.now ?? Date.now;
  const randomId = dependencies.randomId ?? crypto.randomUUID;
  const maxUploadBytes = dependencies.maxUploadBytes ?? 8 * GIB;
  const partSize = dependencies.partSize ?? DEFAULT_PART_SIZE;
  const leaseTtlMs = dependencies.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const storage = dependencies.storage;

  router.use((_req, res, next) => dependencies.enabled === false
    ? res.status(404).json({ error: "Atlas 尚未开放", code: "ATLAS_DISABLED" })
    : next());
  router.use(dependencies.requireAuth);

  router.get("/bootstrap", asyncRoute(async (_req, res) => {
    const user = res.locals.user as { id: string; email?: string; name?: string; avatarUrl?: string };
    res.json({
      user: { id: user.id, email: user.email ?? "", name: user.name ?? "", avatarUrl: user.avatarUrl ?? "" },
      capabilities: { agent: dependencies.agentEnabled !== false, maxUploadBytes, partSize, uploadConcurrency: 3 },
    });
  }));

  router.get("/projects", asyncRoute(async (req, res) => {
    const query = pagination.parse(req.query);
    res.json({ items: dependencies.store.listProjects(userId(res), query.limit, query.offset).map(publicProject) });
  }));

  router.post("/projects", asyncRoute(async (req, res) => {
    const body = z.object({ title: projectTitle.default("未命名项目") }).parse(req.body ?? {});
    const project = dependencies.store.createProject({ id: randomId(), ownerId: userId(res), title: body.title, now: now() });
    res.status(201).json(publicProject(project));
  }));

  router.get("/projects/:id", asyncRoute(async (req, res) => {
    const project = dependencies.store.readProject(param(req.params.id), userId(res));
    if (!project) throw new AtlasRouteError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在");
    res.json(publicProject(project));
  }));

  const updateProject = asyncRoute(async (req, res) => {
    const body = z.object({ title: projectTitle, expectedRevision: z.number().int().min(0) }).parse(req.body);
    const result = dependencies.store.updateProject(param(req.params.id), userId(res), body.expectedRevision, body.title, now());
    if (result.status === "missing") throw new AtlasRouteError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在");
    if (result.status === "conflict") return res.status(409).json({ error: "项目已在其他窗口更新", code: "ATLAS_REVISION_CONFLICT", currentRevision: result.currentRevision });
    res.json(publicProject(result.project));
  });
  router.put("/projects/:id", updateProject);
  router.patch("/projects/:id", updateProject);

  router.delete("/projects/:id", asyncRoute(async (req, res) => {
    const deleted = dependencies.store.softDeleteProject(param(req.params.id), userId(res), now());
    if (!deleted) throw new AtlasRouteError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在");
    for (const objectKey of deleted.objects) scheduleDelete(storage, objectKey);
    for (const transfer of deleted.uploads) scheduleAbort(storage, dependencies.store, transfer, now);
    res.status(204).end();
  }));

  router.post("/projects/:id/lease", asyncRoute(async (req, res) => {
    const body = z.object({ deviceId: z.string().trim().min(8).max(200), takeover: z.boolean().default(false) }).parse(req.body);
    const token = crypto.randomBytes(32).toString("base64url");
    const result = dependencies.store.acquireLease(param(req.params.id), userId(res), body.deviceId, leaseHash(token), now(), leaseTtlMs, body.takeover);
    if (result.status === "missing") throw new AtlasRouteError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在");
    if (result.status === "locked") return res.status(409).json({ error: "项目正在另一窗口编辑", code: "ATLAS_PROJECT_LOCKED", deviceId: result.deviceId, expiresAt: result.expiresAt });
    res.status(201).json({ token, deviceId: result.project.leaseDeviceId, expiresAt: result.project.leaseExpiresAt });
  }));

  router.put("/projects/:id/lease", asyncRoute(async (req, res) => {
    const body = z.object({ token: leaseToken }).parse(req.body);
    const ownerId = userId(res);
    const projectId = param(req.params.id);
    if (!dependencies.store.readProject(projectId, ownerId)) throw new AtlasRouteError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在");
    const project = dependencies.store.renewLease(projectId, ownerId, leaseHash(body.token), now(), leaseTtlMs);
    if (!project) throw new AtlasRouteError(409, "ATLAS_LEASE_LOST", "编辑租约已失效，请重新接管项目");
    res.json({ deviceId: project.leaseDeviceId, expiresAt: project.leaseExpiresAt });
  }));

  router.delete("/projects/:id/lease", asyncRoute(async (req, res) => {
    const body = z.object({ token: leaseToken }).parse(req.body);
    if (!dependencies.store.readProject(param(req.params.id), userId(res))) throw new AtlasRouteError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在");
    dependencies.store.releaseLease(param(req.params.id), userId(res), leaseHash(body.token), now());
    res.status(204).end();
  }));

  router.post("/projects/:id/checkpoints", asyncRoute(async (req, res) => {
    const body = z.object({
      expectedRevision: z.number().int().min(0), leaseToken,
      digest: z.string().regex(/^[a-f0-9]{64}$/i, "检查点摘要必须是SHA-256"),
      size: z.number().int().positive().max(128 * 1024 * 1024),
    }).parse(req.body);
    const ownerId = userId(res);
    const projectId = param(req.params.id);
    if (!dependencies.store.hasLease(projectId, ownerId, leaseHash(body.leaseToken), now())) {
      if (!dependencies.store.readProject(projectId, ownerId)) throw new AtlasRouteError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在");
      throw new AtlasRouteError(409, "ATLAS_LEASE_LOST", "编辑租约已失效，请重新接管项目");
    }
    const checkpointId = randomId();
    const transferId = randomId();
    const revision = body.expectedRevision + 1;
    const objectKey = atlasCheckpointObjectKey(ownerId, projectId, revision);
    let reservation = dependencies.store.reserveCheckpoint({
      id: checkpointId, transferId, ownerId, projectId, expectedRevision: body.expectedRevision, objectKey,
      digest: body.digest.toLowerCase(), size: body.size, partSize, partCount: Math.ceil(body.size / partSize),
      now: now(), expiresAt: now() + DEFAULT_TRANSFER_TTL_MS, leaseTokenHash: leaseHash(body.leaseToken),
    });
    if (reservation.status === "missing") throw new AtlasRouteError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在");
    if (reservation.status === "lease_lost") throw new AtlasRouteError(409, "ATLAS_LEASE_LOST", "编辑租约已失效，请重新接管项目");
    if (reservation.status === "conflict") return res.status(409).json({ error: "项目已在其他窗口更新", code: "ATLAS_REVISION_CONFLICT", currentRevision: reservation.currentRevision });
    if (reservation.status === "stale_in_flight") throw new AtlasRouteError(425, "ATLAS_CHECKPOINT_STALE_IN_FLIGHT", "旧窗口的检查点仍在完成中，请稍后重试");
    if (reservation.status === "generation_invalid" || reservation.status === "state_changed") throw new AtlasRouteError(409, "ATLAS_CHECKPOINT_STATE_CHANGED", "检查点状态异常，请刷新后重试");
    if (reservation.status === "resetting") throw new AtlasRouteError(425, "ATLAS_CHECKPOINT_RECOVERING", "检查点正在恢复，请稍后重试");
    if (reservation.status === "recoverable") {
      // Claim the failed reservation in SQLite before touching its
      // deterministic TOS key. Only the CAS winner may clean up the previous
      // attempt; a losing concurrent retry must never delete the winner's new
      // object after it has been uploaded.
      const claimToken = randomId();
      const claimed = dependencies.store.claimFailedCheckpointReset({
        versionId: reservation.version.id, transferId: reservation.transfer.id, ownerId, projectId,
        expectedRevision: body.expectedRevision, now: now(), leaseTokenHash: leaseHash(body.leaseToken), claimToken,
      });
      if (claimed.status === "missing") throw new AtlasRouteError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在");
      if (claimed.status === "lease_lost") throw new AtlasRouteError(409, "ATLAS_LEASE_LOST", "编辑租约已失效，请重新接管项目");
      if (claimed.status === "conflict") return res.status(409).json({ error: "项目已在其他窗口更新", code: "ATLAS_REVISION_CONFLICT", currentRevision: claimed.currentRevision });
      if (claimed.status === "state_changed") throw new AtlasRouteError(425, "ATLAS_CHECKPOINT_RECOVERING", "检查点正在恢复，请稍后重试");
      try {
        if (claimed.previousTransfer.tosUploadId) {
          await storage.abortMultipartUpload({
            objectKey: claimed.previousTransfer.objectKey,
            uploadId: claimed.previousTransfer.tosUploadId,
          }).catch((error) => {
            const code = String((error as { code?: string }).code ?? "");
            if (!/NoSuchUpload|UploadStatusNotUploading|UploadStatusMismatch/.test(code)) throw error;
          });
        }
        if (!dependencies.store.refreshFailedCheckpointResetClaim(claimed.transfer.id, ownerId, claimToken, now())) {
          throw new AtlasRouteError(409, "ATLAS_CHECKPOINT_STATE_CHANGED", "检查点恢复所有权已变化，请重试");
        }
        await storage.deleteObject(claimed.previousTransfer.objectKey);
        if (!dependencies.store.refreshFailedCheckpointResetClaim(claimed.transfer.id, ownerId, claimToken, now())) {
          throw new AtlasRouteError(409, "ATLAS_CHECKPOINT_STATE_CHANGED", "检查点恢复所有权已变化，请重试");
        }
      } catch (error) {
        dependencies.store.releaseFailedCheckpointReset(
          claimed.version.id, claimed.transfer.id, ownerId, claimToken,
          error instanceof Error ? error.message : "检查点清理失败", now(),
        );
        throw error;
      }
      const restarted = dependencies.store.finishFailedCheckpointReset({
        versionId: claimed.version.id, transferId: claimed.transfer.id, ownerId, projectId,
        expectedRevision: body.expectedRevision, digest: body.digest.toLowerCase(), size: body.size,
        partSize, partCount: Math.ceil(body.size / partSize), now: now(), expiresAt: now() + DEFAULT_TRANSFER_TTL_MS,
        leaseTokenHash: leaseHash(body.leaseToken), claimToken,
      });
      if (restarted.status !== "ok") {
        dependencies.store.releaseFailedCheckpointReset(
          claimed.version.id, claimed.transfer.id, ownerId, claimToken,
          `RESET_FINISH_${restarted.status.toUpperCase()}`, now(),
        );
      }
      if (restarted.status === "missing") throw new AtlasRouteError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在");
      if (restarted.status === "lease_lost") throw new AtlasRouteError(409, "ATLAS_LEASE_LOST", "编辑租约已失效，请重新接管项目");
      if (restarted.status === "conflict") return res.status(409).json({ error: "项目已在其他窗口更新", code: "ATLAS_REVISION_CONFLICT", currentRevision: restarted.currentRevision });
      if (restarted.status === "state_changed") throw new AtlasRouteError(409, "ATLAS_CHECKPOINT_STATE_CHANGED", "检查点状态已变化，请刷新后重试");
      reservation = { status: "created", version: restarted.version, transfer: restarted.transfer };
    }
    if (!reservation.transfer) throw new AtlasRouteError(409, "ATLAS_CHECKPOINT_STATE_INVALID", "检查点状态不可恢复");
    if (reservation.version.status === "ready") return res.json({ checkpointId: reservation.version.id, revision: reservation.version.revision, status: "ready" });
    let transfer = reservation.transfer;
    assertTransferNotExpired(transfer, now());
    let activatedByRequest = false;
    if (!transfer.tosUploadId) {
      const candidateUploadId = await storage.createMultipartUpload({
        objectKey: transfer.objectKey, contentType: transfer.contentType, fileName: transfer.fileName,
        metadata: { sha256: body.digest.toLowerCase() },
      });
      const claimed = dependencies.store.claimTransferUploadId(transfer.id, ownerId, candidateUploadId, now());
      if (claimed.status === "missing") {
        await storage.abortMultipartUpload({ objectKey: transfer.objectKey, uploadId: candidateUploadId }).catch(() => undefined);
        throw new AtlasRouteError(409, "ATLAS_CHECKPOINT_STATE_CHANGED", "检查点状态已变化，请刷新后重试");
      }
      transfer = claimed.transfer;
      activatedByRequest = claimed.status === "won";
      if (claimed.status === "existing" && transfer.tosUploadId !== candidateUploadId) {
        await storage.abortMultipartUpload({ objectKey: transfer.objectKey, uploadId: candidateUploadId }).catch((error) => {
          const code = String((error as { code?: string }).code ?? "");
          if (!/NoSuchUpload|UploadStatusNotUploading|UploadStatusMismatch/.test(code)) throw error;
        });
      }
    }
    const completedParts = activatedByRequest ? [] : await readCompletedParts(storage, dependencies.store, transfer, ownerId, now());
    const completedNumbers = new Set(completedParts.map((part) => part.partNumber));
    const parts = await Promise.all(Array.from({ length: transfer.partCount }, (_, index) => index + 1)
      .filter((partNumber) => !completedNumbers.has(partNumber))
      .map(async (partNumber) => ({
        partNumber,
        url: await storage.signUploadPart({ objectKey: transfer.objectKey, uploadId: transfer.tosUploadId!, partNumber }),
      })));
    res.status(reservation.status === "created" ? 201 : 200).json({
      checkpointId: reservation.version.id, revision: reservation.version.revision,
      transfer: publicTransfer(transfer), completedParts, parts,
    });
  }));

  router.post("/projects/:id/checkpoints/:checkpointId/complete", asyncRoute(async (req, res) => {
    const body = z.object({ leaseToken, parts: partsSchema }).parse(req.body);
    const ownerId = userId(res);
    const projectId = param(req.params.id);
    if (!dependencies.store.hasLease(projectId, ownerId, leaseHash(body.leaseToken), now())) {
      if (!dependencies.store.readProject(projectId, ownerId)) throw new AtlasRouteError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在");
      throw new AtlasRouteError(409, "ATLAS_LEASE_LOST", "编辑租约已失效，请重新接管项目");
    }
    const version = dependencies.store.readVersion(param(req.params.checkpointId), ownerId);
    if (!version || version.projectId !== projectId) throw new AtlasRouteError(404, "ATLAS_CHECKPOINT_NOT_FOUND", "项目检查点不存在");
    if (version.status === "ready") return res.json({ checkpointId: version.id, revision: version.revision, status: "ready" });
    const effectiveTransfer = dependencies.store.readTransferForVersion(version.id, ownerId);
    if (!effectiveTransfer?.tosUploadId) throw new AtlasRouteError(409, "ATLAS_CHECKPOINT_STATE_INVALID", "检查点上传状态不可用");
    assertTransferNotExpired(effectiveTransfer, now());
    let verified: AtlasVerifiedObject;
    try {
      verified = await verifyCompletedTransfer(
        storage, dependencies.store, effectiveTransfer, ownerId, body.parts, now(), version.digest,
      );
    }
    catch (error) {
      dependencies.store.recordTransferError(effectiveTransfer.id, ownerId, error instanceof Error ? error.message : "检查点上传失败", now());
      throw error;
    }
    const completed = dependencies.store.completeCheckpoint(version.id, ownerId, now(), leaseHash(body.leaseToken));
    if (completed.status === "missing") throw new AtlasRouteError(404, "ATLAS_CHECKPOINT_NOT_FOUND", "项目检查点不存在");
    if (completed.status === "lease_lost") {
      // Multipart has already produced the deterministic final object, but a
      // different editor took over while TOS was completing. Never let the
      // expiry reconciler commit this stale checkpoint later.
      dependencies.store.markTransferCancelled(effectiveTransfer.id, ownerId, now());
      await storage.deleteObject(effectiveTransfer.objectKey);
      throw new AtlasRouteError(409, "ATLAS_LEASE_LOST", "编辑租约已失效，旧窗口的检查点未保存");
    }
    if (completed.status === "conflict") return res.status(409).json({ error: "项目已在其他窗口更新", code: "ATLAS_REVISION_CONFLICT", currentRevision: completed.currentRevision });
    res.json({ checkpointId: completed.version.id, revision: completed.version.revision, status: "ready" });
  }));

  router.get("/projects/:id/checkpoint", asyncRoute(async (req, res) => {
    const ownerId = userId(res);
    const projectId = param(req.params.id);
    if (!dependencies.store.readProject(projectId, ownerId)) throw new AtlasRouteError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在");
    const version = dependencies.store.readLatestVersion(projectId, ownerId);
    if (!version) throw new AtlasRouteError(404, "ATLAS_CHECKPOINT_NOT_FOUND", "项目还没有云端检查点");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Cookie");
    res.redirect(302, await storage.signedObjectUrl(version.objectKey, { fileName: `${version.revision}.json.gz`, attachment: false }));
  }));

  router.get("/projects/:id/assets", asyncRoute(async (req, res) => {
    const query = pagination.parse(req.query);
    const items = dependencies.store.listAssets(param(req.params.id), userId(res), query.limit, query.offset);
    if (!items) throw new AtlasRouteError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在");
    res.json({ items: items.map(publicAsset) });
  }));

  router.post("/projects/:id/assets/import", asyncRoute(async (req, res) => {
    const body = z.object({
      sourceType: z.enum(["user_asset", "generation", "generated", "canvas_project"]),
      sourceId: z.string().min(1).max(200),
    }).parse(req.body);
    const ownerId = userId(res);
    const projectId = param(req.params.id);
    if (!dependencies.store.readProject(projectId, ownerId)) throw new AtlasRouteError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在");
    const source = await dependencies.resolveImportSource({ ownerId, sourceType: body.sourceType, sourceId: body.sourceId });
    if (!source) throw new AtlasRouteError(404, "ATLAS_IMPORT_SOURCE_NOT_FOUND", "要导入的素材不存在");
    if (source.size > TOS_COPY_OBJECT_MAX_BYTES) {
      throw new AtlasRouteError(422, "ATLAS_IMPORT_TOO_LARGE", "该资产超过5GiB，请从本机直接导入以使用可续传上传");
    }
    const assetId = randomId();
    const objectKey = atlasAssetObjectKey(ownerId, projectId, assetId, source.fileName);
    const created = dependencies.store.createImportedAsset({
      id: assetId, ownerId, projectId, sourceType: body.sourceType, sourceId: body.sourceId, kind: source.kind,
      objectKey, fileName: safeName(source.fileName), contentType: source.contentType, size: source.size, now: now(),
    });
    if (created.status === "missing") throw new AtlasRouteError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在");
    if (created.status === "existing" && created.asset.status === "ready") return res.json(publicAsset(created.asset));
    const target = created.status === "existing"
      ? dependencies.store.prepareImportedAssetRetry(created.asset.id, ownerId, now())!
      : created.asset;
    try {
      let verified: AtlasVerifiedObject | undefined;
      try {
        verified = await storage.verifyObject(target.objectKey);
      } catch (verificationError) {
        if (!isObjectNotFound(verificationError)) throw verificationError;
        try {
          await storage.copyObject({ sourceObjectKey: source.objectKey, destinationObjectKey: target.objectKey, contentType: source.contentType, fileName: source.fileName });
        } catch (copyError) {
          try { verified = await storage.verifyObject(target.objectKey); }
          catch (reconcileError) { if (isObjectNotFound(reconcileError)) throw copyError; throw reconcileError; }
        }
        verified ??= await storage.verifyObject(target.objectKey);
      }
      if (!verified) throw new AtlasRouteError(502, "ATLAS_IMPORT_VERIFY_FAILED", "导入素材未能完成校验，请重试");
      if (verified.size !== source.size) throw new AtlasRouteError(422, "ATLAS_IMPORT_SIZE_MISMATCH", "导入素材完整性校验失败");
      if (verified.contentType.split(";", 1)[0]!.trim().toLowerCase() !== source.contentType.split(";", 1)[0]!.trim().toLowerCase()) {
        throw new AtlasRouteError(422, "ATLAS_IMPORT_TYPE_MISMATCH", "导入素材类型校验失败");
      }
      const ready = dependencies.store.markAssetReady(target.id, ownerId, verified, now())!;
      res.status(created.status === "created" ? 201 : 200).json(publicAsset(ready));
    } catch (error) {
      dependencies.store.markAssetFailed(target.id, ownerId, error instanceof Error ? error.message : "素材导入失败", now());
      throw error;
    }
  }));

  router.delete("/projects/:id/assets/:assetId", asyncRoute(async (req, res) => {
    const ownerId = userId(res);
    const projectId = param(req.params.id);
    const asset = dependencies.store.readAsset(param(req.params.assetId), ownerId);
    if (!asset || asset.projectId !== projectId || !dependencies.store.readProject(projectId, ownerId)) {
      throw new AtlasRouteError(404, "ATLAS_ASSET_NOT_FOUND", "Atlas素材不存在");
    }
    const deleted = dependencies.store.softDeleteAsset(asset.id, ownerId, now())!;
    if (deleted.transfer?.tosUploadId && ["initiated", "uploading", "verifying"].includes(deleted.transfer.status)) {
      scheduleAbort(storage, dependencies.store, {
        id: deleted.transfer.id, ownerId, objectKey: deleted.transfer.objectKey, uploadId: deleted.transfer.tosUploadId,
      }, now);
    }
    if (!deleted.retained) scheduleDelete(storage, asset.objectKey);
    res.status(204).end();
  }));

  router.all("/project-assets/:assetId/media", asyncRoute(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") throw new AtlasRouteError(405, "ATLAS_METHOD_NOT_ALLOWED", "请求方法不受支持");
    const asset = dependencies.store.readAsset(param(req.params.assetId), userId(res));
    if (!asset) throw new AtlasRouteError(404, "ATLAS_ASSET_NOT_FOUND", "Atlas素材不存在");
    if (asset.status === "uploading" || asset.status === "copying") throw new AtlasRouteError(425, "ATLAS_ASSET_PROCESSING", "素材仍在处理，请稍后重试");
    if (asset.status !== "ready") throw new AtlasRouteError(409, "ATLAS_ASSET_UNAVAILABLE", "素材当前不可用");
    const attachment = req.query.download === "1";
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Cookie");
    res.redirect(302, await storage.signedObjectUrl(asset.objectKey, { fileName: asset.fileName, attachment }));
  }));

  router.post("/projects/:id/uploads", asyncRoute(async (req, res) => {
    const body = z.object({
      name: z.string().trim().min(1).max(180), kind: z.enum(["image", "video", "audio"]),
      contentType: z.string().trim().min(1).max(150), size: z.number().int().positive().max(maxUploadBytes).nullable(),
      purpose: z.enum(["asset", "export"]).default("asset"),
      // Optional for one compatibility release. Current Atlas clients always
      // send this value and retry the same creation intent with the same key.
      idempotencyKey: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
    }).superRefine((value, context) => {
      if (value.purpose === "asset" && value.size === null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["size"], message: "素材上传必须提供文件大小" });
    }).parse(req.body);
    if (!body.contentType.toLowerCase().startsWith(`${body.kind}/`)) throw new AtlasRouteError(400, "ATLAS_MEDIA_TYPE_MISMATCH", "文件类型与媒体类型不一致");
    if (body.purpose === "export" && (body.kind !== "video" || body.contentType.toLowerCase() !== "video/mp4")) {
      throw new AtlasRouteError(400, "ATLAS_EXPORT_TYPE_INVALID", "Atlas导出仅支持MP4视频");
    }
    const ownerId = userId(res);
    const projectId = param(req.params.id);
    if (!dependencies.store.readProject(projectId, ownerId)) throw new AtlasRouteError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在");
    const intentKey = body.idempotencyKey ?? randomId();
    const intentDigest = sha256(`${ownerId}\0${projectId}\0${body.purpose}\0${intentKey}`);
    const assetId = `atlas-asset-${intentDigest.slice(0, 32)}`;
    const transferId = `atlas-transfer-${intentDigest.slice(0, 32)}`;
    const fileName = safeName(body.name);
    const declaredSize = body.size ?? 0;
    const objectKey = body.purpose === "export"
      ? atlasExportObjectKey(ownerId, projectId, assetId)
      : atlasAssetObjectKey(ownerId, projectId, assetId, fileName);
    const reserved = dependencies.store.reserveUploadedAsset({
      asset: { id: assetId, ownerId, projectId, sourceType: body.purpose === "export" ? "atlas_export" : "local_upload", kind: body.kind, objectKey, fileName, contentType: body.contentType, size: declaredSize },
      transfer: { id: transferId, kind: body.purpose === "export" ? "export" : "asset_upload", size: declaredSize, partSize, partCount: declaredSize ? Math.ceil(declaredSize / partSize) : 0, expiresAt: now() + DEFAULT_TRANSFER_TTL_MS },
      now: now(), maxActiveTransfers: DEFAULT_MAX_ACTIVE_TRANSFERS_PER_USER,
    });
    if (reserved.status === "missing") throw new AtlasRouteError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas项目不存在");
    if (reserved.status === "limit") {
      res.setHeader("Retry-After", "15");
      throw new AtlasRouteError(429, "ATLAS_UPLOAD_CONCURRENCY_LIMIT", "当前上传任务较多，请等待已有上传完成后重试");
    }
    if (reserved.status === "idempotency_conflict") throw new AtlasRouteError(409, "ATLAS_UPLOAD_INTENT_CONFLICT", "上传请求与已有上传意图不一致，请重新选择文件");
    if (["failed", "cancelled"].includes(reserved.transfer.status)) {
      throw new AtlasRouteError(409, "ATLAS_UPLOAD_RESTART_REQUIRED", "上次上传会话已经结束，请重新开始上传");
    }
    if (reserved.transfer.status === "completed" && reserved.asset.status === "ready") {
      return res.status(200).json({
        uploadId: reserved.transfer.id, partSize: reserved.transfer.partSize,
        asset: publicAsset(reserved.asset), transfer: publicTransfer(reserved.transfer),
        concurrency: 3, completedParts: reserved.transfer.parts, parts: [], completed: true,
      });
    }
    let uploadId: string | undefined;
    try {
      let transfer = reserved.transfer;
      if (transfer.status === "initiated") {
        uploadId = await storage.createMultipartUpload({ objectKey, contentType: body.contentType, fileName });
        const claimed = dependencies.store.claimTransferUploadId(transferId, ownerId, uploadId, now());
        if (claimed.status === "missing") throw new AtlasRouteError(409, "ATLAS_UPLOAD_STATE_INVALID", "上传会话状态已变化，请重试");
        transfer = claimed.transfer;
        if (claimed.status === "existing" && transfer.tosUploadId !== uploadId) {
          await storage.abortMultipartUpload({ objectKey, uploadId }).catch((error) => {
            const code = String((error as { code?: string }).code ?? "");
            if (!/NoSuchUpload|UploadStatusNotUploading|UploadStatusMismatch/.test(code)) throw error;
          });
          uploadId = undefined;
        }
      }
      if (transfer.status !== "uploading" || !transfer.tosUploadId) {
        throw new AtlasRouteError(409, "ATLAS_UPLOAD_STATE_INVALID", "上传会话当前无法继续");
      }
      let completedParts = transfer.parts;
      let parts: { partNumber: number; url: string }[] = [];
      let initialSigningPending = false;
      try {
        completedParts = await readCompletedParts(storage, dependencies.store, transfer, ownerId, now());
        const completedNumbers = new Set(completedParts.map((part) => part.partNumber));
        const initialParts = Array.from({ length: transfer.partCount }, (_, index) => index + 1).slice(0, 12);
        parts = await Promise.all(initialParts.filter((partNumber) => !completedNumbers.has(partNumber)).map(async (partNumber) => ({
          partNumber,
          url: await storage.signUploadPart({ objectKey, uploadId: transfer.tosUploadId!, partNumber }),
        })));
      } catch (error) {
        initialSigningPending = true;
        dependencies.store.recordTransferError(transfer.id, ownerId, error instanceof Error ? error.message : "分片签名暂不可用", now());
        console.warn(JSON.stringify({
          type: "atlas_upload_initial_signing_deferred", at: new Date().toISOString(), transferId: transfer.id,
          userId: ownerId, code: (error as { code?: string }).code ?? "unknown",
        }));
      }
      res.status(reserved.status === "created" ? 201 : 200).json({
        uploadId: transfer.id, partSize: transfer.partSize,
        asset: publicAsset(reserved.asset), transfer: publicTransfer(transfer), concurrency: 3,
        completedParts, parts, initialSigningPending,
      });
    } catch (error) {
      // A signing or response failure after activation is resumable: retain
      // the durable UploadId so the same intent can ListParts and continue.
      // Abort only when TOS creation succeeded but the DB activation did not.
      const durableTransfer = dependencies.store.readTransfer(transferId, ownerId);
      const needsOrphanCleanup = Boolean(uploadId && durableTransfer?.tosUploadId !== uploadId);
      if (uploadId && needsOrphanCleanup) {
        try {
          await storage.abortMultipartUpload({ objectKey, uploadId });
        } catch (abortError) {
          console.warn(JSON.stringify({
            type: "atlas_multipart_init_cleanup_failed", at: new Date().toISOString(), transferId,
            userId: ownerId, objectKeyHash: sha256(objectKey).slice(0, 16),
            code: (abortError as { code?: string }).code ?? "unknown",
          }));
        }
      }
      dependencies.store.recordTransferError(transferId, ownerId, error instanceof Error ? error.message : "上传初始化失败", now());
      throw error;
    }
  }));

  router.post("/projects/:id/uploads/:uploadId/parts/sign", asyncRoute(async (req, res) => {
    const body = z.object({ partNumbers: z.array(z.number().int().positive()).min(1).max(100) }).parse(req.body);
    const ownerId = userId(res);
    const projectId = param(req.params.id);
    const transfer = dependencies.store.readTransfer(param(req.params.uploadId), ownerId);
    if (!transfer || transfer.projectId !== projectId || !["asset_upload", "export"].includes(transfer.kind) || transfer.status !== "uploading" || !transfer.tosUploadId) {
      throw new AtlasRouteError(404, "ATLAS_UPLOAD_NOT_FOUND", "上传会话不存在或已失效");
    }
    assertTransferNotExpired(transfer, now());
    const unique = [...new Set(body.partNumbers)].sort((left, right) => left - right);
    const maximumPart = transfer.partCount || Math.ceil(maxUploadBytes / transfer.partSize);
    if (unique.some((partNumber) => partNumber > maximumPart)) throw new AtlasRouteError(400, "ATLAS_UPLOAD_PART_INVALID", "分片编号超出文件范围");
    const completedParts = await readCompletedParts(storage, dependencies.store, transfer, ownerId, now());
    const completedNumbers = new Set(completedParts.map((part) => part.partNumber));
    const parts = await Promise.all(unique.filter((partNumber) => !completedNumbers.has(partNumber)).map(async (partNumber) => ({
      partNumber, url: await storage.signUploadPart({ objectKey: transfer.objectKey, uploadId: transfer.tosUploadId!, partNumber }),
    })));
    res.json({ uploadId: transfer.id, completedParts, parts });
  }));

  router.get("/projects/:id/uploads/:uploadId", asyncRoute(async (req, res) => {
    const ownerId = userId(res);
    const projectId = param(req.params.id);
    const transfer = dependencies.store.readTransfer(param(req.params.uploadId), ownerId);
    if (!transfer || transfer.projectId !== projectId || !["asset_upload", "export"].includes(transfer.kind)) {
      throw new AtlasRouteError(404, "ATLAS_UPLOAD_NOT_FOUND", "上传会话不存在或已失效");
    }
    assertTransferNotExpired(transfer, now());
    const completedParts = transfer.tosUploadId && ["uploading", "verifying"].includes(transfer.status)
      ? await readCompletedParts(storage, dependencies.store, transfer, ownerId, now())
      : transfer.parts;
    res.json({ transfer: publicTransfer(transfer), completedParts });
  }));

  router.post("/projects/:id/uploads/:uploadId/complete", asyncRoute(async (req, res) => {
    const body = z.object({
      parts: partsSchema,
      totalSize: z.number().int().positive().max(maxUploadBytes).optional(),
      purpose: z.enum(["asset", "export"]).optional(),
    }).parse(req.body);
    const ownerId = userId(res);
    const projectId = param(req.params.id);
    let transfer = dependencies.store.readTransfer(param(req.params.uploadId), ownerId);
    if (!transfer || transfer.projectId !== projectId || !["asset_upload", "export"].includes(transfer.kind) || !transfer.assetId || !transfer.tosUploadId) {
      throw new AtlasRouteError(404, "ATLAS_UPLOAD_NOT_FOUND", "上传会话不存在或已失效");
    }
    assertTransferNotExpired(transfer, now());
    const assetId = transfer.assetId;
    const existing = dependencies.store.readAsset(assetId, ownerId);
    if (transfer.status === "completed" && existing?.status === "ready") {
      if (transfer.kind === "export") {
        await tryRegisterGlobalAsset(
          dependencies.store,
          dependencies.store.readGlobalAssetRegistration(assetId, ownerId),
          dependencies.registerGlobalAsset,
          now,
        );
      }
      return res.json(publicAsset(existing));
    }
    if (transfer.status !== "uploading" && transfer.status !== "verifying") throw new AtlasRouteError(409, "ATLAS_UPLOAD_STATE_INVALID", "上传会话当前无法完成");
    if (body.purpose && body.purpose !== (transfer.kind === "export" ? "export" : "asset")) {
      throw new AtlasRouteError(409, "ATLAS_UPLOAD_PURPOSE_MISMATCH", "上传用途与会话不一致");
    }
    if (transfer.size === 0 || transfer.partCount === 0) {
      if (transfer.kind !== "export" || !body.totalSize) throw new AtlasRouteError(400, "ATLAS_EXPORT_SIZE_REQUIRED", "完成流式导出时必须提供实际文件大小");
      const finalized = dependencies.store.finalizeStreamingTransfer(transfer.id, ownerId, body.totalSize, Math.ceil(body.totalSize / transfer.partSize), now());
      if (!finalized) throw new AtlasRouteError(409, "ATLAS_UPLOAD_SIZE_CONFLICT", "导出文件大小与已保存会话不一致");
      transfer = finalized;
    } else if (body.totalSize && body.totalSize !== transfer.size) {
      throw new AtlasRouteError(409, "ATLAS_UPLOAD_SIZE_CONFLICT", "实际文件大小与上传会话不一致");
    }
    try {
      const verified = await verifyCompletedTransfer(
        storage, dependencies.store, transfer, ownerId, body.parts, now(),
      );
      const exportReady = transfer.kind === "export"
        ? dependencies.store.markExportReadyWithOutbox(assetId, ownerId, verified, now())
        : null;
      const ready = transfer.kind === "export"
        ? exportReady?.asset ?? null
        : dependencies.store.markAssetReady(assetId, ownerId, verified, now());
      if (!ready) throw new AtlasRouteError(409, "ATLAS_UPLOAD_STATE_INVALID", "素材状态已变化，请刷新后重试");
      if (exportReady) {
        await tryRegisterGlobalAsset(dependencies.store, exportReady.registration, dependencies.registerGlobalAsset, now);
      }
      res.json(publicAsset(ready));
    } catch (error) {
      dependencies.store.recordTransferError(transfer.id, ownerId, error instanceof Error ? error.message : "上传完成失败", now());
      throw error;
    }
  }));

  router.delete("/projects/:id/uploads/:uploadId", asyncRoute(async (req, res) => {
    const ownerId = userId(res);
    const projectId = param(req.params.id);
    const transfer = dependencies.store.readTransfer(param(req.params.uploadId), ownerId);
    if (!transfer || transfer.projectId !== projectId || !["asset_upload", "export"].includes(transfer.kind) || !transfer.assetId) {
      throw new AtlasRouteError(404, "ATLAS_UPLOAD_NOT_FOUND", "上传会话不存在或已失效");
    }
    const deleted = dependencies.store.softDeleteAsset(transfer.assetId, ownerId, now());
    if (deleted?.transfer?.tosUploadId) scheduleAbort(storage, dependencies.store, {
      id: deleted.transfer.id, ownerId, objectKey: deleted.transfer.objectKey, uploadId: deleted.transfer.tosUploadId,
    }, now);
    res.status(204).end();
  }));

  return router;
};
