import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { assertSchemaVersion, schemaVersion } from "./migrations.js";

export type User = {
  id: string;
  feishuOpenId: string;
  feishuUnionId: string;
  tenantKey: string;
  email: string;
  name: string;
  avatarUrl: string;
  status: "active" | "disabled";
  createdAt: number;
  lastLoginAt: number;
};

export type TaskStatus = "queued" | "submitting" | "running" | "succeeded" | "failed";
export type MediaStatus = "none" | "archiving" | "ready" | "fallback" | "failed";
export type StoredTask = {
  id: string;
  sessionId?: string;
  ownerId?: string;
  visibility?: "private" | "shared";
  providerId?: string;
  status: TaskStatus;
  mediaStatus?: MediaStatus;
  mediaRevision?: number;
  prompt: string;
  model: string;
  mode: string;
  ratio: string;
  resolution: string;
  duration: number;
  request?: unknown;
  sourceVideoUrl?: string;
  sourceVideoExpiresAt?: number;
  /** TOS 抓取任务 id（可追踪元数据，排障用） */
  fetchTaskId?: string;
  /** 归档恢复轮次（每次完整 archive-output 失败 +1，达到上限停止自动恢复） */
  mediaAttempts?: number;
  /** 最近一次归档失败的结构化描述（JSON：phase/code/statusCode/message/elapsedMs） */
  mediaLastError?: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
  deletedAt?: number;
};

/** 归档自动恢复轮次上限：达到后停止重试，保留临时源可播放（fallback 分层保护） */
export const MAX_MEDIA_RECOVERY_ATTEMPTS = 3;

export type MediaObject = {
  id: string;
  ownerId: string;
  taskId?: string;
  uploadId?: string;
  kind: "input" | "output" | "preview" | "poster" | "generated";
  objectKey: string;
  status: "uploading" | "ready" | "delete_pending" | "deleted";
  fileName: string;
  contentType: string;
  size: number;
  etag: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type ImageGenerationTask = {
  id: string;
  sessionId?: string;
  ownerId: string;
  model: string;
  modelName: string;
  ratio: string;
  resolution: string;
  prompt: string;
  requestedCount: number;
  status: "running" | "succeeded" | "failed";
  items: { mediaId: string; width?: number; height?: number }[];
  failures: string[];
  error?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type CreationSession = {
  id: string;
  ownerId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type AssetCategory = "character" | "scene" | "prop" | "material";

export type UserAsset = {
  id: string;
  providerAssetId?: string;
  ownerId: string;
  groupId: string;
  uploadId?: string;
  name: string;
  assetType: "Image" | "Video" | "Audio";
  status: "Active" | "Processing" | "Failed";
  category: AssetCategory;
  url?: string;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type CanvasAsset = {
  id: string;
  ownerId: string;
  canvasId: string;
  sourceUploadId?: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  size: number;
  etag: string;
  status: "copying" | "ready" | "failed";
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type CanvasProjectAsset = {
  id: string;
  ownerId: string;
  canvasId: string;
  canvasAssetId?: string;
  kind: "image" | "video" | "audio";
  sourceType: "canvas_asset" | "generation" | "generated" | "user_asset" | "montage";
  sourceId: string;
  title: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
  status: "copying" | "ready" | "failed";
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type CanvasJob = {
  id: string;
  ownerId: string;
  canvasId: string;
  nodeId: string;
  kind: "text" | "image" | "video" | "character_tool";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  payload: unknown;
  resultAssetId?: string;
  providerTaskId?: string;
  partialText: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  cancelledAt?: number;
};

export type CanvasMontage = {
  id: string;
  ownerId: string;
  canvasId: string;
  revision: number;
  timeline: unknown;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type CanvasExport = {
  id: string;
  ownerId: string;
  canvasId: string;
  montageId: string;
  status: "uploading" | "verifying" | "ready" | "failed" | "cancelled";
  objectKey: string;
  tosUploadId?: string;
  parts: { partNumber: number; etag: string }[];
  resultAssetId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

export type CanvasProject = {
  id: string;
  ownerId: string;
  title: string;
  documentJson: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

type UserRow = {
  id: string;
  feishu_open_id: string;
  feishu_union_id: string;
  tenant_key: string;
  email: string;
  name: string;
  avatar_url: string;
  status: "active" | "disabled";
  created_at: number;
  last_login_at: number;
};

type TaskRow = {
  id: string; session_id: string | null; owner_id: string | null; visibility: "private" | "shared"; provider_id: string | null;
  status: TaskStatus; media_status: MediaStatus; media_revision: number; prompt: string; model: string; mode: string;
  ratio: string; resolution: string; duration: number; request_json: string; source_video_url: string | null;
  source_video_expires_at: number | null; error: string | null; created_at: number; updated_at: number; deleted_at: number | null;
  fetch_task_id: string | null; media_attempts: number | null; media_last_error: string | null;
};

type MediaRow = {
  id: string; owner_id: string; task_id: string | null; upload_id: string | null; kind: MediaObject["kind"];
  object_key: string; status: MediaObject["status"]; file_name: string; content_type: string; size: number;
  etag: string; created_at: number; updated_at: number; deleted_at: number | null;
};

type ImageGenerationRow = {
  id: string; session_id: string | null; owner_id: string; model: string; model_name: string; ratio: string; resolution: string;
  prompt: string; requested_count: number; status: ImageGenerationTask["status"]; items_json: string;
  failures_json: string; error: string | null; created_at: number; updated_at: number; deleted_at: number | null;
};

type CreationSessionRow = {
  id: string; owner_id: string; title: string; created_at: number; updated_at: number; deleted_at: number | null;
};

type UserAssetRow = {
  id: string; provider_asset_id: string | null; owner_id: string; group_id: string; upload_id: string | null; name: string;
  asset_type: UserAsset["assetType"]; status: UserAsset["status"]; category: AssetCategory; url: string | null;
  last_error: string | null; created_at: number; updated_at: number; deleted_at: number | null;
};

type CanvasProjectRow = {
  id: string; owner_id: string; title: string; document_json: string; revision: number;
  created_at: number; updated_at: number; deleted_at: number | null;
};

type CanvasAssetRow = {
  id: string; owner_id: string; canvas_id: string; source_upload_id: string | null;
  object_key: string; file_name: string; content_type: string; size: number; etag: string;
  status: "copying" | "ready" | "failed"; created_at: number; updated_at: number; deleted_at: number | null;
};

type CanvasProjectAssetRow = {
  id: string; owner_id: string; canvas_id: string; canvas_asset_id: string | null;
  kind: CanvasProjectAsset["kind"]; source_type: CanvasProjectAsset["sourceType"]; source_id: string;
  title: string; content_type: string; size: number; width: number | null; height: number | null;
  duration_ms: number | null; status: CanvasProjectAsset["status"]; created_at: number; updated_at: number; deleted_at: number | null;
};

type CanvasJobRow = {
  id: string; owner_id: string; canvas_id: string; node_id: string; kind: CanvasJob["kind"];
  status: CanvasJob["status"]; payload_json: string; result_asset_id: string | null; provider_task_id: string | null;
  partial_text: string; error: string | null; created_at: number; updated_at: number; cancelled_at: number | null;
};

type CanvasMontageRow = {
  id: string; owner_id: string; canvas_id: string; revision: number; timeline_json: string;
  created_at: number; updated_at: number; deleted_at: number | null;
};

type CanvasExportRow = {
  id: string; owner_id: string; canvas_id: string; montage_id: string; status: CanvasExport["status"];
  object_key: string; tos_upload_id: string | null; parts_json: string; result_asset_id: string | null;
  error: string | null; created_at: number; updated_at: number;
};

const mapUser = (row?: UserRow): User | null => row ? ({
  id: row.id, feishuOpenId: row.feishu_open_id, feishuUnionId: row.feishu_union_id,
  tenantKey: row.tenant_key, email: row.email, name: row.name, avatarUrl: row.avatar_url,
  status: row.status, createdAt: row.created_at, lastLoginAt: row.last_login_at
}) : null;

const mapTask = (row?: TaskRow): StoredTask | null => row ? ({
  id: row.id, sessionId: row.session_id ?? undefined, ownerId: row.owner_id ?? undefined, visibility: row.visibility, providerId: row.provider_id ?? undefined,
  status: row.status, mediaStatus: row.media_status, mediaRevision: row.media_revision, prompt: row.prompt, model: row.model,
  mode: row.mode, ratio: row.ratio, resolution: row.resolution, duration: row.duration,
  request: JSON.parse(row.request_json), sourceVideoUrl: row.source_video_url ?? undefined,
  sourceVideoExpiresAt: row.source_video_expires_at ?? undefined, error: row.error ?? undefined,
  fetchTaskId: row.fetch_task_id ?? undefined, mediaAttempts: row.media_attempts ?? undefined,
  mediaLastError: row.media_last_error ?? undefined,
  createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at ?? undefined
}) : null;

const mapMedia = (row?: MediaRow): MediaObject | null => row ? ({
  id: row.id, ownerId: row.owner_id, taskId: row.task_id ?? undefined, uploadId: row.upload_id ?? undefined,
  kind: row.kind, objectKey: row.object_key, status: row.status, fileName: row.file_name,
  contentType: row.content_type, size: row.size, etag: row.etag, createdAt: row.created_at,
  updatedAt: row.updated_at, deletedAt: row.deleted_at ?? undefined
}) : null;

const mapImageGeneration = (row?: ImageGenerationRow): ImageGenerationTask | null => row ? ({
  id: row.id, sessionId: row.session_id ?? undefined, ownerId: row.owner_id, model: row.model, modelName: row.model_name,
  ratio: row.ratio, resolution: row.resolution, prompt: row.prompt, requestedCount: row.requested_count,
  status: row.status, items: JSON.parse(row.items_json), failures: JSON.parse(row.failures_json),
  error: row.error ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at,
  deletedAt: row.deleted_at ?? undefined,
}) : null;

const mapCreationSession = (row?: CreationSessionRow): CreationSession | null => row ? ({
  id: row.id, ownerId: row.owner_id, title: row.title, createdAt: row.created_at,
  updatedAt: row.updated_at, deletedAt: row.deleted_at ?? undefined,
}) : null;

const mapUserAsset = (row?: UserAssetRow): UserAsset | null => row ? ({
  id: row.id, providerAssetId: row.provider_asset_id ?? undefined, ownerId: row.owner_id, groupId: row.group_id, uploadId: row.upload_id ?? undefined,
  name: row.name, assetType: row.asset_type, status: row.status, category: row.category, url: row.url ?? undefined,
  lastError: row.last_error ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at ?? undefined
}) : null;

const mapCanvasProject = (row?: CanvasProjectRow): CanvasProject | null => row ? ({
  id: row.id, ownerId: row.owner_id, title: row.title, documentJson: row.document_json,
  revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
  deletedAt: row.deleted_at ?? undefined
}) : null;

const mapCanvasAsset = (row?: CanvasAssetRow): CanvasAsset | null => row ? ({
  id: row.id, ownerId: row.owner_id, canvasId: row.canvas_id, sourceUploadId: row.source_upload_id ?? undefined,
  objectKey: row.object_key, fileName: row.file_name, contentType: row.content_type, size: row.size,
  etag: row.etag, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
  deletedAt: row.deleted_at ?? undefined
}) : null;

const mapCanvasProjectAsset = (row?: CanvasProjectAssetRow): CanvasProjectAsset | null => row ? ({
  id: row.id, ownerId: row.owner_id, canvasId: row.canvas_id, canvasAssetId: row.canvas_asset_id ?? undefined,
  kind: row.kind, sourceType: row.source_type, sourceId: row.source_id, title: row.title,
  contentType: row.content_type, size: row.size, width: row.width ?? undefined, height: row.height ?? undefined,
  durationMs: row.duration_ms ?? undefined, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
  deletedAt: row.deleted_at ?? undefined,
}) : null;

const mapCanvasJob = (row?: CanvasJobRow): CanvasJob | null => row ? ({
  id: row.id, ownerId: row.owner_id, canvasId: row.canvas_id, nodeId: row.node_id, kind: row.kind, status: row.status,
  payload: JSON.parse(row.payload_json), resultAssetId: row.result_asset_id ?? undefined, providerTaskId: row.provider_task_id ?? undefined,
  partialText: row.partial_text, error: row.error ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at,
  cancelledAt: row.cancelled_at ?? undefined,
}) : null;

const mapCanvasMontage = (row?: CanvasMontageRow): CanvasMontage | null => row ? ({
  id: row.id, ownerId: row.owner_id, canvasId: row.canvas_id, revision: row.revision,
  timeline: JSON.parse(row.timeline_json), createdAt: row.created_at, updatedAt: row.updated_at,
  deletedAt: row.deleted_at ?? undefined,
}) : null;

const mapCanvasExport = (row?: CanvasExportRow): CanvasExport | null => row ? ({
  id: row.id, ownerId: row.owner_id, canvasId: row.canvas_id, montageId: row.montage_id, status: row.status,
  objectKey: row.object_key, tosUploadId: row.tos_upload_id ?? undefined, parts: JSON.parse(row.parts_json),
  resultAssetId: row.result_asset_id ?? undefined, error: row.error ?? undefined,
  createdAt: row.created_at, updatedAt: row.updated_at,
}) : null;

export class UserStore {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("busy_timeout = 5000");
    try { assertSchemaVersion(this.database); }
    catch (error) { this.database.close(); throw error; }
  }

  findById(id: string) { return mapUser(this.database.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined); }
  findByEmail(email: string) { return mapUser(this.database.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email) as UserRow | undefined); }

  upsertFromFeishu(profile: { openId: string; unionId: string; tenantKey: string; email: string; name: string; avatarUrl: string }) {
    const now = Date.now();
    const existingByEmail = this.findByEmail(profile.email);
    // 安全设计（非缺陷）：企业邮箱是企业 SSO 的身份锚点，禁止新 open_id 冒领已绑定邮箱（防账号接管）；
    // 账号迁移/重绑由管理员介入（disableByEmail 或人工处理），此处保留强校验并输出审计日志。
    if (existingByEmail && existingByEmail.feishuOpenId !== profile.openId) {
      console.warn(JSON.stringify({ type: "auth_binding_conflict", at: new Date().toISOString(), email: profile.email, existingOpenId: existingByEmail.feishuOpenId, attemptedOpenId: profile.openId }));
      throw new Error("该企业邮箱已绑定其他飞书身份，请联系管理员");
    }
    const existing = this.database.prepare("SELECT * FROM users WHERE feishu_open_id = ?").get(profile.openId) as UserRow | undefined;
    if (existing) {
      this.database.prepare(`UPDATE users SET feishu_union_id = ?, tenant_key = ?, email = ?, name = ?, avatar_url = ?, last_login_at = ? WHERE id = ?`)
        .run(profile.unionId, profile.tenantKey, profile.email, profile.name, profile.avatarUrl, now, existing.id);
      return this.findById(existing.id)!;
    }
    const id = crypto.randomUUID();
    this.database.prepare(`INSERT INTO users (id, feishu_open_id, feishu_union_id, tenant_key, email, name, avatar_url, status, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
      .run(id, profile.openId, profile.unionId, profile.tenantKey, profile.email, profile.name, profile.avatarUrl, now, now);
    return this.findById(id)!;
  }

  disableByEmail(email: string) {
    const user = this.findByEmail(email);
    if (!user) return null;
    this.database.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(user.id);
    return { ...user, status: "disabled" as const };
  }

  saveTask(task: StoredTask) {
    this.database.prepare(`
      INSERT INTO generation_tasks (id, session_id, owner_id, visibility, provider_id, status, media_status, media_revision, prompt, model, mode, ratio, resolution, duration, request_json, source_video_url, source_video_expires_at, error, fetch_task_id, media_attempts, media_last_error, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET session_id=excluded.session_id, owner_id=excluded.owner_id, visibility=excluded.visibility, provider_id=excluded.provider_id,
        status=excluded.status, media_status=excluded.media_status, media_revision=excluded.media_revision, prompt=excluded.prompt,
        model=excluded.model, mode=excluded.mode, ratio=excluded.ratio, resolution=excluded.resolution, duration=excluded.duration,
        request_json=excluded.request_json, source_video_url=excluded.source_video_url, source_video_expires_at=excluded.source_video_expires_at,
        error=excluded.error, fetch_task_id=excluded.fetch_task_id, media_attempts=excluded.media_attempts, media_last_error=excluded.media_last_error,
        updated_at=excluded.updated_at, deleted_at=COALESCE(generation_tasks.deleted_at, excluded.deleted_at)
    `).run(
      task.id, task.sessionId ?? null, task.ownerId ?? null, task.visibility ?? (task.ownerId ? "private" : "shared"), task.providerId ?? null,
      task.status, task.mediaStatus ?? "none", task.mediaRevision ?? 0, task.prompt, task.model, task.mode, task.ratio,
      task.resolution, task.duration, JSON.stringify(task.request ?? {}), task.sourceVideoUrl ?? null,
      task.sourceVideoExpiresAt ?? null, task.error ?? null, task.fetchTaskId ?? null,
      task.mediaAttempts ?? 0, task.mediaLastError ?? null, task.createdAt, task.updatedAt, task.deletedAt ?? null
    );
    return this.readTask(task.id, true)!;
  }

  readTask(id: string, includeDeleted = false) {
    const row = this.database.prepare(`SELECT * FROM generation_tasks WHERE id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"}`).get(id) as TaskRow | undefined;
    return mapTask(row);
  }

  listTasksForUser(userId: string, limit = 50) {
    const rows = this.database.prepare(`SELECT * FROM generation_tasks WHERE deleted_at IS NULL AND (owner_id = ? OR visibility = 'shared') ORDER BY created_at DESC LIMIT ?`).all(userId, limit) as TaskRow[];
    return rows.map((row) => mapTask(row)!);
  }

  listTasksForSession(userId: string, sessionId: string, limit = 50) {
    const rows = this.database.prepare(`SELECT * FROM generation_tasks WHERE owner_id = ? AND session_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`).all(userId, sessionId, limit) as TaskRow[];
    return rows.map((row) => mapTask(row)!);
  }

  createCreationSession(session: CreationSession) {
    this.database.prepare("INSERT INTO creation_sessions (id, owner_id, title, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(session.id, session.ownerId, session.title, session.createdAt, session.updatedAt, session.deletedAt ?? null);
    return session;
  }

  readCreationSession(id: string, includeDeleted = false) {
    return mapCreationSession(this.database.prepare(`SELECT * FROM creation_sessions WHERE id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"}`).get(id) as CreationSessionRow | undefined);
  }

  listCreationSessions(ownerId: string, limit = 100) {
    return (this.database.prepare("SELECT * FROM creation_sessions WHERE owner_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?").all(ownerId, limit) as CreationSessionRow[])
      .map((row) => mapCreationSession(row)!);
  }

  renameCreationSession(id: string, ownerId: string, title: string) {
    const now = Date.now();
    const result = this.database.prepare("UPDATE creation_sessions SET title = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").run(title, now, id, ownerId);
    return result.changes ? this.readCreationSession(id) : null;
  }

  touchCreationSession(id: string, ownerId: string, prompt?: string) {
    const now = Date.now();
    const autoTitle = prompt?.trim().slice(0, 40);
    const result = autoTitle
      ? this.database.prepare("UPDATE creation_sessions SET title = CASE WHEN title = '新创作' THEN ? ELSE title END, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").run(autoTitle, now, id, ownerId)
      : this.database.prepare("UPDATE creation_sessions SET updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").run(now, id, ownerId);
    return result.changes ? this.readCreationSession(id) : null;
  }

  softDeleteCreationSession(id: string, ownerId: string) {
    const now = Date.now();
    return this.database.prepare("UPDATE creation_sessions SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").run(now, now, id, ownerId).changes > 0;
  }

  countActiveTasksForUser(userId: string) {
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM generation_tasks WHERE owner_id = ? AND deleted_at IS NULL AND status IN ('queued', 'submitting', 'running')").get(userId) as { count: number };
    return row.count;
  }

  /** Atomically reserves one active generation slot and persists the queued task. */
  createTaskWithinLimit(task: StoredTask, limit: number) {
    return this.database.transaction(() => {
      if (!task.ownerId || this.countActiveTasksForUser(task.ownerId) >= limit) return false;
      this.saveTask(task);
      return true;
    })();
  }

  healthCheck() { return (this.database.prepare("SELECT 1 AS ok").get() as { ok: number }).ok === 1; }
  schemaVersion() { return schemaVersion(this.database); }

  recoverableMediaTasks(minimumSourceExpiry: number, staleBefore: number, limit = 20) {
    const rows = this.database.prepare(`
      SELECT * FROM generation_tasks
      WHERE deleted_at IS NULL AND status IN ('succeeded', 'failed')
        AND source_video_url IS NOT NULL AND source_video_expires_at > ?
        AND (media_attempts IS NULL OR media_attempts < ?)
        AND (media_status IN ('failed', 'fallback') OR (media_status = 'archiving' AND updated_at < ?))
      ORDER BY updated_at ASC LIMIT ?
    `).all(minimumSourceExpiry, MAX_MEDIA_RECOVERY_ATTEMPTS, staleBefore, limit) as TaskRow[];
    return rows.map((row) => mapTask(row)!);
  }

  recoverablePosterTasks(limit = 20) {
    const rows = this.database.prepare(`
      SELECT * FROM generation_tasks
      WHERE deleted_at IS NULL AND status = 'succeeded' AND media_status = 'ready'
        AND EXISTS (
          SELECT 1 FROM media_objects
          WHERE media_objects.task_id = generation_tasks.id AND media_objects.kind = 'output' AND media_objects.status = 'ready'
        )
        AND NOT EXISTS (
          SELECT 1 FROM media_objects
          WHERE media_objects.task_id = generation_tasks.id AND media_objects.kind = 'poster' AND media_objects.status = 'ready'
        )
      ORDER BY updated_at ASC LIMIT ?
    `).all(limit) as TaskRow[];
    return rows.map((row) => mapTask(row)!);
  }

  recoverablePreviewTasks(limit = 20) {
    const rows = this.database.prepare(`
      SELECT * FROM generation_tasks
      WHERE deleted_at IS NULL AND status = 'succeeded' AND media_status IN ('archiving', 'ready')
        AND EXISTS (
          SELECT 1 FROM media_objects
          WHERE media_objects.task_id = generation_tasks.id AND media_objects.kind = 'output' AND media_objects.status = 'ready'
        )
        AND NOT EXISTS (
          SELECT 1 FROM media_objects
          WHERE media_objects.task_id = generation_tasks.id AND media_objects.kind = 'preview' AND media_objects.status = 'ready'
        )
      ORDER BY updated_at DESC LIMIT ?
    `).all(limit) as TaskRow[];
    return rows.map((row) => mapTask(row)!);
  }

  upsertMedia(media: MediaObject) {
    this.database.prepare(`
      INSERT INTO media_objects (id, owner_id, task_id, upload_id, kind, object_key, status, file_name, content_type, size, etag, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id, task_id=excluded.task_id, upload_id=excluded.upload_id,
        kind=excluded.kind, object_key=excluded.object_key, status=excluded.status, file_name=excluded.file_name,
        content_type=excluded.content_type, size=excluded.size, etag=excluded.etag, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at
    `).run(media.id, media.ownerId, media.taskId ?? null, media.uploadId ?? null, media.kind, media.objectKey, media.status,
      media.fileName, media.contentType, media.size, media.etag, media.createdAt, media.updatedAt, media.deletedAt ?? null);
    return media;
  }

  readMedia(id: string) { return mapMedia(this.database.prepare("SELECT * FROM media_objects WHERE id = ?").get(id) as MediaRow | undefined); }
  readUpload(uploadId: string) { return mapMedia(this.database.prepare("SELECT * FROM media_objects WHERE upload_id = ? AND kind = 'input' AND status = 'ready'").get(uploadId) as MediaRow | undefined); }
  readTaskMedia(taskId: string, kind: "output" | "preview" | "poster") { return mapMedia(this.database.prepare("SELECT * FROM media_objects WHERE task_id = ? AND kind = ? AND status = 'ready' ORDER BY created_at DESC LIMIT 1").get(taskId, kind) as MediaRow | undefined); }

  commitTaskMediaIfActive(taskId: string, media: MediaObject, finalizeOutput = false) {
    return this.database.transaction(() => {
      const task = this.readTask(taskId, true);
      if (!task || task.deletedAt) return null;
      if (media.taskId !== taskId || media.ownerId !== task.ownerId || media.status !== "ready") throw new Error("任务媒体归属或状态不一致");
      if (finalizeOutput && media.kind !== "output") throw new Error("只有成片可以完成媒体归档");
      this.upsertMedia(media);
      const now = Date.now();
      const result = finalizeOutput
        ? this.database.prepare(`
            UPDATE generation_tasks
            SET status = 'succeeded', media_status = 'ready', media_revision = media_revision + 1,
                media_last_error = NULL, updated_at = ?
            WHERE id = ? AND deleted_at IS NULL
          `).run(now, taskId)
        : this.database.prepare("UPDATE generation_tasks SET media_revision = media_revision + 1, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(now, taskId);
      if (!result.changes) return null;
      return this.readTask(taskId)!;
    })();
  }

  createImageGeneration(task: ImageGenerationTask) {
    this.database.prepare(`
      INSERT INTO image_generation_tasks
        (id, session_id, owner_id, model, model_name, ratio, resolution, prompt, requested_count, status, items_json, failures_json, error, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id, task.sessionId ?? null, task.ownerId, task.model, task.modelName, task.ratio, task.resolution, task.prompt,
      task.requestedCount, task.status, JSON.stringify(task.items), JSON.stringify(task.failures),
      task.error ?? null, task.createdAt, task.updatedAt, task.deletedAt ?? null,
    );
    return task;
  }

  readImageGeneration(id: string) {
    return mapImageGeneration(this.database.prepare("SELECT * FROM image_generation_tasks WHERE id = ? AND deleted_at IS NULL").get(id) as ImageGenerationRow | undefined);
  }

  listImageGenerations(ownerId: string, limit = 50) {
    return (this.database.prepare("SELECT * FROM image_generation_tasks WHERE owner_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?").all(ownerId, limit) as ImageGenerationRow[])
      .map((row) => mapImageGeneration(row)!);
  }

  listImageGenerationsForSession(ownerId: string, sessionId: string, limit = 50) {
    return (this.database.prepare("SELECT * FROM image_generation_tasks WHERE owner_id = ? AND session_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?").all(ownerId, sessionId, limit) as ImageGenerationRow[])
      .map((row) => mapImageGeneration(row)!);
  }

  createImageGenerationWithinLimit(task: ImageGenerationTask, limit: number) {
    return this.database.transaction(() => {
      const count = (this.database.prepare("SELECT COUNT(*) AS count FROM image_generation_tasks WHERE owner_id = ? AND status = 'running' AND deleted_at IS NULL").get(task.ownerId) as { count: number }).count;
      if (count >= limit) return false;
      this.createImageGeneration(task);
      return true;
    })();
  }

  updateImageGeneration(id: string, ownerId: string, patch: Pick<ImageGenerationTask, "status" | "items" | "failures"> & { error?: string }) {
    const result = this.database.prepare(`
      UPDATE image_generation_tasks
      SET status = ?, items_json = ?, failures_json = ?, error = ?, updated_at = ?
      WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
    `).run(patch.status, JSON.stringify(patch.items), JSON.stringify(patch.failures), patch.error ?? null, Date.now(), id, ownerId);
    return result.changes ? this.readImageGeneration(id) : null;
  }

  failStaleImageGenerations(staleBefore: number) {
    return this.database.prepare(`
      UPDATE image_generation_tasks
      SET status = 'failed', error = '生成进程意外中断，请重新提交', updated_at = ?
      WHERE status = 'running' AND deleted_at IS NULL AND updated_at < ?
    `).run(Date.now(), staleBefore).changes;
  }

  softDeleteImageGeneration(id: string, ownerId: string) {
    const now = Date.now();
    return this.database.transaction(() => {
      const task = this.readImageGeneration(id);
      if (!task || task.ownerId !== ownerId) return false;
      const removed = this.database.prepare("UPDATE image_generation_tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").run(now, now, id, ownerId);
      if (!removed.changes) return false;
      const mediaIds = task.items.map((item) => item.mediaId);
      const mark = this.database.prepare("UPDATE media_objects SET status = 'delete_pending', updated_at = ? WHERE id = ? AND owner_id = ? AND kind = 'generated' AND status != 'deleted'");
      for (const mediaId of mediaIds) mark.run(now, mediaId, ownerId);
      return true;
    })();
  }

  /**
   * 删除权限矩阵：owner 可删除自己的任务（private 与 shared 一致）；
   * shared 读者只读不可删。shared 任务被 owner 删除后级联清理媒体。
   */
  softDeleteTask(taskId: string, ownerId: string) {
    const now = Date.now();
    return this.database.transaction(() => {
      const result = this.database.prepare("UPDATE generation_tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").run(now, now, taskId, ownerId);
      if (!result.changes) return false;
      this.database.prepare("UPDATE media_objects SET status = 'delete_pending', updated_at = ? WHERE task_id = ? AND kind IN ('output', 'preview', 'poster') AND status != 'deleted'").run(now, taskId);
      return true;
    })();
  }

  pendingMediaDeletes(limit = 100) {
    return (this.database.prepare("SELECT * FROM media_objects WHERE status = 'delete_pending' ORDER BY updated_at LIMIT ?").all(limit) as MediaRow[]).map((row) => mapMedia(row)!);
  }

  markMediaDeleted(id: string) {
    const now = Date.now();
    this.database.prepare("UPDATE media_objects SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
  }

  upsertUserAsset(asset: UserAsset) {
    try {
      this.database.prepare(`
        INSERT INTO user_assets (id, provider_asset_id, owner_id, group_id, upload_id, name, asset_type, status, category, url, last_error, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET provider_asset_id=COALESCE(excluded.provider_asset_id, user_assets.provider_asset_id), owner_id=excluded.owner_id, group_id=excluded.group_id,
          upload_id=COALESCE(excluded.upload_id, user_assets.upload_id), name=excluded.name,
          asset_type=excluded.asset_type, status=excluded.status, category=excluded.category, url=COALESCE(excluded.url, user_assets.url),
          last_error=excluded.last_error, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at
      `).run(asset.id, asset.providerAssetId ?? null, asset.ownerId, asset.groupId, asset.uploadId ?? null, asset.name, asset.assetType, asset.status, asset.category,
        asset.url ?? null, asset.lastError ?? null, asset.createdAt, asset.updatedAt, asset.deletedAt ?? null);
      return asset;
    } catch (error) {
      // 同一 (owner_id, upload_id) 已被登记：复用先写入的记录，避免并发请求回退状态或重复入队。
      if ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
        const existing = asset.uploadId ? this.readUserAssetByUpload(asset.ownerId, asset.uploadId) : null;
        if (existing) return existing;
      }
      throw error;
    }
  }

  readUserAsset(id: string) {
    return mapUserAsset(this.database.prepare("SELECT * FROM user_assets WHERE id = ? AND deleted_at IS NULL").get(id) as UserAssetRow | undefined);
  }

  /** Internal recovery read: includes soft-deleted tombstones used as the provider cleanup outbox. */
  readUserAssetIncludingDeleted(id: string) {
    return mapUserAsset(this.database.prepare("SELECT * FROM user_assets WHERE id = ?").get(id) as UserAssetRow | undefined);
  }

  /** 按上传 ID 查已登记的素材（幂等复用：同一 uploadId 重复请求时直接返回既有资产） */
  readUserAssetByUpload(ownerId: string, uploadId: string) {
    return mapUserAsset(this.database.prepare("SELECT * FROM user_assets WHERE owner_id = ? AND upload_id = ? AND deleted_at IS NULL").get(ownerId, uploadId) as UserAssetRow | undefined);
  }

  listUserAssets(ownerId: string, query = "", limit = 100, assetType?: UserAsset["assetType"], offset = 0, category?: AssetCategory) {
    const pattern = `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`;
    const rows = this.database.prepare(`
      SELECT * FROM user_assets
      WHERE owner_id = ? AND deleted_at IS NULL AND name LIKE ? ESCAPE '\\' AND (? IS NULL OR asset_type = ?) AND (? IS NULL OR category = ?)
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(ownerId, pattern, assetType ?? null, assetType ?? null, category ?? null, category ?? null, limit, offset) as UserAssetRow[];
    return rows.map((row) => mapUserAsset(row)!);
  }

  listProcessingUserAssets(limit = 100) {
    return (this.database.prepare("SELECT * FROM user_assets WHERE status = 'Processing' AND deleted_at IS NULL ORDER BY updated_at ASC LIMIT ?").all(limit) as UserAssetRow[]).map((row) => mapUserAsset(row)!);
  }

  /** Soft-deleted rows retain the provider id until the asynchronous delete is confirmed. */
  listDeletedUserAssetsNeedingProviderDelete(limit = 100) {
    return (this.database.prepare(`
      SELECT * FROM user_assets
      WHERE deleted_at IS NOT NULL AND provider_asset_id IS NOT NULL
      ORDER BY updated_at ASC LIMIT ?
    `).all(limit) as UserAssetRow[]).map((row) => mapUserAsset(row)!);
  }

  recordProviderIdForDeletedUserAsset(id: string, providerAssetId: string) {
    const result = this.database.prepare(`
      UPDATE user_assets SET provider_asset_id = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NOT NULL AND provider_asset_id IS NULL
    `).run(providerAssetId, Date.now(), id);
    return result.changes > 0;
  }

  clearDeletedUserAssetProviderId(id: string, providerAssetId: string) {
    const result = this.database.prepare(`
      UPDATE user_assets SET provider_asset_id = NULL, updated_at = ?
      WHERE id = ? AND deleted_at IS NOT NULL AND provider_asset_id = ?
    `).run(Date.now(), id, providerAssetId);
    return result.changes > 0;
  }

  /** Reusable library assets must be copied outside inputs/' seven-day lifecycle. */
  listUserAssetsNeedingMediaPromotion(limit = 100) {
    const rows = this.database.prepare(`
      SELECT DISTINCT asset.* FROM user_assets asset
      JOIN media_objects media ON media.upload_id = asset.upload_id
        AND media.kind = 'input' AND media.status = 'ready'
      WHERE asset.deleted_at IS NULL AND asset.upload_id IS NOT NULL
        AND media.object_key LIKE 'inputs/%'
      ORDER BY asset.updated_at ASC LIMIT ?
    `).all(limit) as UserAssetRow[];
    return rows.map((row) => mapUserAsset(row)!);
  }

  renameUserAsset(id: string, ownerId: string, name: string) {
    const result = this.database.prepare("UPDATE user_assets SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").run(name, Date.now(), id, ownerId);
    return result.changes > 0;
  }

  updateUserAssetCategory(id: string, ownerId: string, category: AssetCategory) {
    const result = this.database.prepare("UPDATE user_assets SET category = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").run(category, Date.now(), id, ownerId);
    return result.changes > 0;
  }

  deleteUserAsset(id: string, ownerId: string) {
    const now = Date.now();
    const result = this.database.prepare("UPDATE user_assets SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").run(now, now, id, ownerId);
    return result.changes > 0;
  }

  /**
   * 活动任务是否引用了某资产：对 request_json 的 assets 数组做 JSON 结构化精确匹配
   * （json_each + json_extract），替代旧版 LIKE 文本模糊匹配（避免 id 前缀误判/漏判）。
   */
  isUserAssetInActiveTask(id: string, ownerId: string) {
    const row = this.database.prepare(`
      SELECT 1 AS found FROM generation_tasks, json_each(generation_tasks.request_json, '$.assets') AS entry
      WHERE generation_tasks.owner_id = ? AND generation_tasks.deleted_at IS NULL
        AND generation_tasks.status IN ('queued', 'submitting', 'running')
        AND json_extract(entry.value, '$.assetId') = ?
      LIMIT 1
    `).get(ownerId, id) as { found: number } | undefined;
    return Boolean(row?.found);
  }

  createCanvasProject(project: CanvasProject) {
    this.database.prepare(`INSERT INTO canvas_projects (id, owner_id, title, document_json, revision, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(project.id, project.ownerId, project.title, project.documentJson, project.revision, project.createdAt, project.updatedAt, project.deletedAt ?? null);
    return project;
  }

  readCanvasProject(id: string) {
    return mapCanvasProject(this.database.prepare("SELECT * FROM canvas_projects WHERE id = ? AND deleted_at IS NULL").get(id) as CanvasProjectRow | undefined);
  }

  listCanvasProjects(ownerId: string, limit: number, offset: number) {
    const rows = this.database.prepare("SELECT * FROM canvas_projects WHERE owner_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ? OFFSET ?").all(ownerId, limit, offset) as CanvasProjectRow[];
    return rows.map((row) => mapCanvasProject(row)!);
  }

  updateCanvasProjectDocument(id: string, ownerId: string, documentJson: string, expectedRevision: number) {
    return this.database.transaction(() => {
      const current = this.readCanvasProject(id);
      if (!current || current.ownerId !== ownerId) return null;
      if (current.revision !== expectedRevision) return { status: "conflict" as const, currentRevision: current.revision };
      const nextRevision = expectedRevision + 1;
      const result = this.database.prepare("UPDATE canvas_projects SET document_json = ?, revision = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND revision = ?")
        .run(documentJson, nextRevision, Date.now(), id, ownerId, expectedRevision);
      if (!result.changes) return { status: "conflict" as const, currentRevision: this.readCanvasProject(id)?.revision ?? current.revision };
      return { status: "ok" as const, revision: nextRevision };
    })();
  }

  renameCanvasProject(id: string, ownerId: string, title: string) {
    const result = this.database.prepare("UPDATE canvas_projects SET title = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").run(title, Date.now(), id, ownerId);
    return result.changes > 0;
  }

  createCanvasAsset(asset: CanvasAsset) {
    this.database.prepare(`INSERT INTO canvas_assets (id, owner_id, canvas_id, source_upload_id, object_key, file_name, content_type, size, etag, status, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(asset.id, asset.ownerId, asset.canvasId, asset.sourceUploadId ?? null, asset.objectKey, asset.fileName, asset.contentType, asset.size, asset.etag, asset.status, asset.createdAt, asset.updatedAt, asset.deletedAt ?? null);
    return asset;
  }

  readCanvasAsset(id: string) {
    return mapCanvasAsset(this.database.prepare("SELECT * FROM canvas_assets WHERE id = ? AND deleted_at IS NULL").get(id) as CanvasAssetRow | undefined);
  }

  updateCanvasAsset(id: string, patch: { status?: CanvasAsset["status"]; size?: number; etag?: string; contentType?: string }) {
    const current = this.readCanvasAsset(id);
    if (!current) return null;
    const now = Date.now();
    this.database.prepare("UPDATE canvas_assets SET status = ?, size = ?, etag = ?, content_type = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(patch.status ?? current.status, patch.size ?? current.size, patch.etag ?? current.etag, patch.contentType ?? current.contentType, now, id);
    return this.readCanvasAsset(id)!;
  }

  softDeleteCanvasAsset(id: string, ownerId: string) {
    const result = this.database.prepare("UPDATE canvas_assets SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").run(Date.now(), Date.now(), id, ownerId);
    return result.changes > 0;
  }

  pendingCanvasAssetDeletes(limit = 100) {
    return (this.database.prepare("SELECT * FROM canvas_assets WHERE deleted_at IS NOT NULL AND status = 'ready' ORDER BY updated_at LIMIT ?").all(limit) as CanvasAssetRow[]).map((row) => mapCanvasAsset(row)!);
  }

  listCanvasAssetsByCanvas(canvasId: string) {
    return (this.database.prepare("SELECT * FROM canvas_assets WHERE canvas_id = ? AND deleted_at IS NULL AND status = 'ready' ORDER BY created_at ASC").all(canvasId) as CanvasAssetRow[]).map((row) => mapCanvasAsset(row)!);
  }

  copyingCanvasAssets(limit = 100) {
    return (this.database.prepare("SELECT * FROM canvas_assets WHERE deleted_at IS NULL AND status = 'copying' ORDER BY updated_at ASC LIMIT ?").all(limit) as CanvasAssetRow[]).map((row) => mapCanvasAsset(row)!);
  }

  upsertCanvasProjectAsset(asset: CanvasProjectAsset) {
    this.database.prepare(`
      INSERT INTO canvas_project_assets
        (id, owner_id, canvas_id, canvas_asset_id, kind, source_type, source_id, title, content_type, size, width, height, duration_ms, status, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(canvas_id, source_type, source_id) WHERE deleted_at IS NULL DO UPDATE SET
        canvas_asset_id=excluded.canvas_asset_id, title=excluded.title, content_type=excluded.content_type,
        size=excluded.size, width=excluded.width, height=excluded.height, duration_ms=excluded.duration_ms,
        status=excluded.status, updated_at=excluded.updated_at
    `).run(
      asset.id, asset.ownerId, asset.canvasId, asset.canvasAssetId ?? null, asset.kind, asset.sourceType, asset.sourceId,
      asset.title, asset.contentType, asset.size, asset.width ?? null, asset.height ?? null, asset.durationMs ?? null,
      asset.status, asset.createdAt, asset.updatedAt, asset.deletedAt ?? null,
    );
    return this.readCanvasProjectAssetBySource(asset.canvasId, asset.sourceType, asset.sourceId)!;
  }

  readCanvasProjectAsset(id: string) {
    return mapCanvasProjectAsset(this.database.prepare("SELECT * FROM canvas_project_assets WHERE id = ? AND deleted_at IS NULL").get(id) as CanvasProjectAssetRow | undefined);
  }

  readCanvasProjectAssetBySource(canvasId: string, sourceType: CanvasProjectAsset["sourceType"], sourceId: string) {
    return mapCanvasProjectAsset(this.database.prepare("SELECT * FROM canvas_project_assets WHERE canvas_id = ? AND source_type = ? AND source_id = ? AND deleted_at IS NULL").get(canvasId, sourceType, sourceId) as CanvasProjectAssetRow | undefined);
  }

  updateCanvasProjectAssetByCanvasAsset(canvasAssetId: string, patch: Pick<CanvasProjectAsset, "status" | "size" | "contentType">) {
    this.database.prepare("UPDATE canvas_project_assets SET status = ?, size = ?, content_type = ?, updated_at = ? WHERE canvas_asset_id = ? AND deleted_at IS NULL")
      .run(patch.status, patch.size, patch.contentType, Date.now(), canvasAssetId);
  }

  updateCanvasProjectAssetStatusBySource(sourceType: CanvasProjectAsset["sourceType"], sourceId: string, status: CanvasProjectAsset["status"]) {
    return this.database.prepare("UPDATE canvas_project_assets SET status = ?, updated_at = ? WHERE source_type = ? AND source_id = ? AND deleted_at IS NULL")
      .run(status, Date.now(), sourceType, sourceId).changes;
  }

  softDeleteCanvasProjectAssetBySource(canvasId: string, ownerId: string, sourceType: CanvasProjectAsset["sourceType"], sourceId: string) {
    const now = Date.now();
    return this.database.prepare(`
      UPDATE canvas_project_assets SET deleted_at = ?, updated_at = ?
      WHERE canvas_id = ? AND owner_id = ? AND source_type = ? AND source_id = ? AND deleted_at IS NULL
    `).run(now, now, canvasId, ownerId, sourceType, sourceId).changes > 0;
  }

  listCanvasProjectAssets(canvasId: string, ownerId: string, limit = 100, before = Number.MAX_SAFE_INTEGER, beforeId = "\uffff") {
    return (this.database.prepare(`
      SELECT * FROM canvas_project_assets
      WHERE canvas_id = ? AND owner_id = ? AND deleted_at IS NULL
        AND (created_at < ? OR (created_at = ? AND id < ?))
      ORDER BY created_at DESC, id DESC LIMIT ?
    `).all(canvasId, ownerId, before, before, beforeId, limit) as CanvasProjectAssetRow[]).map((row) => mapCanvasProjectAsset(row)!);
  }

  createCanvasJob(job: CanvasJob) {
    this.database.prepare(`
      INSERT INTO canvas_jobs
        (id, owner_id, canvas_id, node_id, kind, status, payload_json, result_asset_id, provider_task_id, partial_text, error, created_at, updated_at, cancelled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(job.id, job.ownerId, job.canvasId, job.nodeId, job.kind, job.status, JSON.stringify(job.payload ?? {}), job.resultAssetId ?? null, job.providerTaskId ?? null, job.partialText, job.error ?? null, job.createdAt, job.updatedAt, job.cancelledAt ?? null);
    return job;
  }

  createCanvasImageJobWithinLimit(job: CanvasJob, limit: number) {
    return this.database.transaction(() => {
      const active = (this.database.prepare(`
        SELECT COUNT(*) AS count FROM canvas_jobs
        WHERE owner_id = ? AND kind IN ('image', 'character_tool') AND status IN ('queued', 'running')
      `).get(job.ownerId) as { count: number }).count;
      if (active >= limit) return false;
      this.createCanvasJob(job);
      return true;
    })();
  }

  readCanvasJob(id: string) {
    return mapCanvasJob(this.database.prepare("SELECT * FROM canvas_jobs WHERE id = ?").get(id) as CanvasJobRow | undefined);
  }

  listCanvasJobs(canvasId: string, ownerId: string, updatedAfter = 0) {
    return (this.database.prepare("SELECT * FROM canvas_jobs WHERE canvas_id = ? AND owner_id = ? AND updated_at > ? ORDER BY updated_at ASC LIMIT 500").all(canvasId, ownerId, updatedAfter) as CanvasJobRow[]).map((row) => mapCanvasJob(row)!);
  }

  readCanvasJobByProviderTask(providerTaskId: string) {
    return mapCanvasJob(this.database.prepare("SELECT * FROM canvas_jobs WHERE provider_task_id = ? ORDER BY created_at DESC LIMIT 1").get(providerTaskId) as CanvasJobRow | undefined);
  }

  updateCanvasJob(id: string, patch: Partial<Pick<CanvasJob, "status" | "resultAssetId" | "providerTaskId" | "partialText" | "cancelledAt">> & { error?: string | null }) {
    const current = this.readCanvasJob(id);
    if (!current) return null;
    const updatedAt = Date.now();
    this.database.prepare(`
      UPDATE canvas_jobs SET status = ?, result_asset_id = ?, provider_task_id = ?, partial_text = ?, error = ?, updated_at = ?, cancelled_at = ?
      WHERE id = ?
    `).run(
      patch.status ?? current.status, patch.resultAssetId ?? current.resultAssetId ?? null,
      patch.providerTaskId ?? current.providerTaskId ?? null, patch.partialText ?? current.partialText,
      patch.error === undefined ? current.error ?? null : patch.error, updatedAt,
      patch.cancelledAt ?? current.cancelledAt ?? null, id,
    );
    return this.readCanvasJob(id)!;
  }

  transitionActiveCanvasJob(id: string, patch: Partial<Pick<CanvasJob, "status" | "resultAssetId" | "providerTaskId" | "partialText">> & { error?: string | null }) {
    const current = this.readCanvasJob(id);
    if (!current || !["queued", "running"].includes(current.status)) return null;
    const updatedAt = Date.now();
    const result = this.database.prepare(`
      UPDATE canvas_jobs SET status = ?, result_asset_id = ?, provider_task_id = ?, partial_text = ?, error = ?, updated_at = ?
      WHERE id = ? AND status IN ('queued', 'running')
    `).run(
      patch.status ?? current.status, patch.resultAssetId ?? current.resultAssetId ?? null,
      patch.providerTaskId ?? current.providerTaskId ?? null, patch.partialText ?? current.partialText,
      patch.error === undefined ? current.error ?? null : patch.error, updatedAt, id,
    );
    return result.changes ? this.readCanvasJob(id)! : null;
  }

  cancelCanvasJob(id: string) {
    return this.database.transaction(() => {
      const updatedAt = Date.now();
      const result = this.database.prepare(`
        UPDATE canvas_jobs SET status = 'cancelled', error = NULL, updated_at = ?, cancelled_at = ?
        WHERE id = ? AND status IN ('queued', 'running')
      `).run(updatedAt, updatedAt, id);
      return { changed: result.changes > 0, job: this.readCanvasJob(id) };
    })();
  }

  completeCanvasGeneratedJob(id: string, asset: CanvasProjectAsset) {
    return this.database.transaction(() => {
      const current = this.readCanvasJob(id);
      if (!current || !["queued", "running"].includes(current.status)) return null;
      if (asset.canvasId !== current.canvasId || asset.ownerId !== current.ownerId || asset.sourceType !== "generated") throw new Error("画布生成结果归属不一致");
      const media = this.readMedia(asset.sourceId);
      if (!media || media.ownerId !== current.ownerId || media.kind !== "generated" || media.status !== "ready") throw new Error("画布生成媒体尚未就绪");
      const storedAsset = this.upsertCanvasProjectAsset(asset);
      const result = this.database.prepare(`
        UPDATE canvas_jobs SET status = 'succeeded', result_asset_id = ?, error = NULL, updated_at = ?
        WHERE id = ? AND status IN ('queued', 'running')
      `).run(storedAsset.id, Date.now(), id);
      if (!result.changes) return null;
      return { job: this.readCanvasJob(id)!, asset: storedAsset };
    })();
  }

  attachCanvasProjectAssetToActiveJob(id: string, asset: CanvasProjectAsset, complete: boolean) {
    return this.database.transaction(() => {
      const current = this.readCanvasJob(id);
      if (!current || !["queued", "running"].includes(current.status)) return null;
      if (asset.canvasId !== current.canvasId || asset.ownerId !== current.ownerId) throw new Error("画布任务素材归属不一致");
      if (asset.sourceType === "generation" && asset.sourceId !== current.providerTaskId) throw new Error("画布视频任务来源不一致");
      const storedAsset = this.upsertCanvasProjectAsset(asset);
      const result = this.database.prepare(`
        UPDATE canvas_jobs SET status = ?, result_asset_id = ?, error = NULL, updated_at = ?
        WHERE id = ? AND status IN ('queued', 'running')
      `).run(complete ? "succeeded" : current.status, storedAsset.id, Date.now(), id);
      if (!result.changes) return null;
      return { job: this.readCanvasJob(id)!, asset: storedAsset };
    })();
  }

  markUnreferencedGeneratedMediaForDeletion(id: string, ownerId: string) {
    const result = this.database.prepare(`
      UPDATE media_objects SET status = 'delete_pending', updated_at = ?
      WHERE id = ? AND owner_id = ? AND kind = 'generated' AND status = 'ready'
        AND NOT EXISTS (
          SELECT 1 FROM canvas_project_assets
          WHERE source_type = 'generated' AND source_id = media_objects.id AND deleted_at IS NULL
        )
    `).run(Date.now(), id, ownerId);
    return result.changes > 0;
  }

  createCanvasMontage(montage: CanvasMontage) {
    this.database.prepare("INSERT INTO canvas_montages (id, owner_id, canvas_id, revision, timeline_json, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(montage.id, montage.ownerId, montage.canvasId, montage.revision, JSON.stringify(montage.timeline), montage.createdAt, montage.updatedAt, montage.deletedAt ?? null);
    return montage;
  }

  readCanvasMontage(id: string) {
    return mapCanvasMontage(this.database.prepare("SELECT * FROM canvas_montages WHERE id = ? AND deleted_at IS NULL").get(id) as CanvasMontageRow | undefined);
  }

  listCanvasMontages(canvasId: string, ownerId: string) {
    return (this.database.prepare("SELECT * FROM canvas_montages WHERE canvas_id = ? AND owner_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100").all(canvasId, ownerId) as CanvasMontageRow[]).map((row) => mapCanvasMontage(row)!);
  }

  updateCanvasMontage(id: string, ownerId: string, revision: number, timeline: unknown) {
    const result = this.database.prepare("UPDATE canvas_montages SET timeline_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND revision = ?")
      .run(JSON.stringify(timeline), Date.now(), id, ownerId, revision);
    return result.changes ? this.readCanvasMontage(id) : null;
  }

  createCanvasExport(record: CanvasExport) {
    this.database.prepare(`
      INSERT INTO canvas_exports
        (id, owner_id, canvas_id, montage_id, status, object_key, tos_upload_id, parts_json, result_asset_id, error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.ownerId, record.canvasId, record.montageId, record.status, record.objectKey, record.tosUploadId ?? null, JSON.stringify(record.parts), record.resultAssetId ?? null, record.error ?? null, record.createdAt, record.updatedAt);
    return record;
  }

  readCanvasExport(id: string) {
    return mapCanvasExport(this.database.prepare("SELECT * FROM canvas_exports WHERE id = ?").get(id) as CanvasExportRow | undefined);
  }

  updateCanvasExport(id: string, patch: Partial<Pick<CanvasExport, "status" | "tosUploadId" | "parts" | "resultAssetId">> & { error?: string | null }) {
    const current = this.readCanvasExport(id);
    if (!current) return null;
    this.database.prepare(`
      UPDATE canvas_exports SET status = ?, tos_upload_id = ?, parts_json = ?, result_asset_id = ?, error = ?, updated_at = ? WHERE id = ?
    `).run(
      patch.status ?? current.status, patch.tosUploadId ?? current.tosUploadId ?? null,
      JSON.stringify(patch.parts ?? current.parts), patch.resultAssetId ?? current.resultAssetId ?? null,
      patch.error === undefined ? current.error ?? null : patch.error, Date.now(), id,
    );
    return this.readCanvasExport(id)!;
  }


  listCanvasExports(canvasId: string, ownerId: string) {
    return (this.database.prepare("SELECT * FROM canvas_exports WHERE canvas_id = ? AND owner_id = ? ORDER BY updated_at DESC LIMIT 100").all(canvasId, ownerId) as CanvasExportRow[]).map((row) => mapCanvasExport(row)!);
  }

  canvasesPendingAssetCleanup(limit = 20) {
    return (this.database.prepare(`
      SELECT DISTINCT cp.id FROM canvas_projects cp
      WHERE cp.deleted_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM canvas_assets ca WHERE ca.canvas_id = cp.id AND ca.deleted_at IS NULL AND ca.status = 'ready')
      ORDER BY cp.deleted_at ASC LIMIT ?
    `).all(limit) as { id: string }[]).map((row) => row.id);
  }

  softDeleteCanvasProject(id: string, ownerId: string) {
    const now = Date.now();
    const result = this.database.prepare("UPDATE canvas_projects SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").run(now, now, id, ownerId);
    return result.changes > 0;
  }

  clearGenerationHistory() {
    return this.database.transaction(() => {
      this.database.prepare("DELETE FROM image_generation_tasks").run();
      this.database.prepare("DELETE FROM media_objects").run();
      this.database.prepare("DELETE FROM generation_tasks").run();
    })();
  }

  close() { this.database.close(); }
}
