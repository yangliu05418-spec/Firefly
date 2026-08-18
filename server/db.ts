import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

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
  createdAt: number;
  updatedAt: number;
  error?: string;
  deletedAt?: number;
};

export type MediaObject = {
  id: string;
  ownerId: string;
  taskId?: string;
  uploadId?: string;
  kind: "input" | "output" | "preview" | "poster";
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

export type UserAsset = {
  id: string;
  ownerId: string;
  groupId: string;
  uploadId?: string;
  name: string;
  assetType: "Image" | "Video" | "Audio";
  status: "Active" | "Processing" | "Failed";
  url?: string;
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
  id: string; owner_id: string | null; visibility: "private" | "shared"; provider_id: string | null;
  status: TaskStatus; media_status: MediaStatus; media_revision: number; prompt: string; model: string; mode: string;
  ratio: string; resolution: string; duration: number; request_json: string; source_video_url: string | null;
  source_video_expires_at: number | null; error: string | null; created_at: number; updated_at: number; deleted_at: number | null;
};

type MediaRow = {
  id: string; owner_id: string; task_id: string | null; upload_id: string | null; kind: MediaObject["kind"];
  object_key: string; status: MediaObject["status"]; file_name: string; content_type: string; size: number;
  etag: string; created_at: number; updated_at: number; deleted_at: number | null;
};

type UserAssetRow = {
  id: string; owner_id: string; group_id: string; upload_id: string | null; name: string;
  asset_type: UserAsset["assetType"]; status: UserAsset["status"]; url: string | null;
  created_at: number; updated_at: number; deleted_at: number | null;
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

const mapUser = (row?: UserRow): User | null => row ? ({
  id: row.id, feishuOpenId: row.feishu_open_id, feishuUnionId: row.feishu_union_id,
  tenantKey: row.tenant_key, email: row.email, name: row.name, avatarUrl: row.avatar_url,
  status: row.status, createdAt: row.created_at, lastLoginAt: row.last_login_at
}) : null;

const mapTask = (row?: TaskRow): StoredTask | null => row ? ({
  id: row.id, ownerId: row.owner_id ?? undefined, visibility: row.visibility, providerId: row.provider_id ?? undefined,
  status: row.status, mediaStatus: row.media_status, mediaRevision: row.media_revision, prompt: row.prompt, model: row.model,
  mode: row.mode, ratio: row.ratio, resolution: row.resolution, duration: row.duration,
  request: JSON.parse(row.request_json), sourceVideoUrl: row.source_video_url ?? undefined,
  sourceVideoExpiresAt: row.source_video_expires_at ?? undefined, error: row.error ?? undefined,
  createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at ?? undefined
}) : null;

const mapMedia = (row?: MediaRow): MediaObject | null => row ? ({
  id: row.id, ownerId: row.owner_id, taskId: row.task_id ?? undefined, uploadId: row.upload_id ?? undefined,
  kind: row.kind, objectKey: row.object_key, status: row.status, fileName: row.file_name,
  contentType: row.content_type, size: row.size, etag: row.etag, createdAt: row.created_at,
  updatedAt: row.updated_at, deletedAt: row.deleted_at ?? undefined
}) : null;

const mapUserAsset = (row?: UserAssetRow): UserAsset | null => row ? ({
  id: row.id, ownerId: row.owner_id, groupId: row.group_id, uploadId: row.upload_id ?? undefined,
  name: row.name, assetType: row.asset_type, status: row.status, url: row.url ?? undefined,
  createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at ?? undefined
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

export class UserStore {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("busy_timeout = 5000");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        feishu_open_id TEXT NOT NULL UNIQUE,
        feishu_union_id TEXT NOT NULL,
        tenant_key TEXT NOT NULL,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        name TEXT NOT NULL,
        avatar_url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        created_at INTEGER NOT NULL,
        last_login_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS users_tenant_key_idx ON users(tenant_key);
      CREATE TABLE IF NOT EXISTS generation_tasks (
        id TEXT PRIMARY KEY,
        owner_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
        provider_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('queued', 'submitting', 'running', 'succeeded', 'failed')),
        media_status TEXT NOT NULL DEFAULT 'none' CHECK (media_status IN ('none', 'archiving', 'ready', 'fallback', 'failed')),
        media_revision INTEGER NOT NULL DEFAULT 0,
        prompt TEXT NOT NULL,
        model TEXT NOT NULL,
        mode TEXT NOT NULL,
        ratio TEXT NOT NULL,
        resolution TEXT NOT NULL,
        duration INTEGER NOT NULL,
        request_json TEXT NOT NULL DEFAULT '{}',
        source_video_url TEXT,
        source_video_expires_at INTEGER,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        FOREIGN KEY (owner_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS generation_tasks_owner_created_idx ON generation_tasks(owner_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS generation_tasks_visibility_created_idx ON generation_tasks(visibility, created_at DESC);
      CREATE TABLE IF NOT EXISTS media_objects (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        task_id TEXT,
        upload_id TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('input', 'output', 'preview', 'poster')),
        object_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('uploading', 'ready', 'delete_pending', 'deleted')),
        file_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        etag TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        FOREIGN KEY (owner_id) REFERENCES users(id),
        FOREIGN KEY (task_id) REFERENCES generation_tasks(id)
      );
      CREATE INDEX IF NOT EXISTS media_objects_task_kind_idx ON media_objects(task_id, kind);
      CREATE INDEX IF NOT EXISTS media_objects_upload_idx ON media_objects(upload_id);
      CREATE INDEX IF NOT EXISTS media_objects_delete_idx ON media_objects(status, updated_at);
      CREATE TABLE IF NOT EXISTS user_assets (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        upload_id TEXT,
        name TEXT NOT NULL,
        asset_type TEXT NOT NULL CHECK (asset_type IN ('Image', 'Video', 'Audio')),
        status TEXT NOT NULL CHECK (status IN ('Active', 'Processing', 'Failed')),
        url TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        FOREIGN KEY (owner_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS user_assets_owner_updated_idx ON user_assets(owner_id, updated_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS user_assets_owner_upload_idx ON user_assets(owner_id, upload_id) WHERE upload_id IS NOT NULL AND deleted_at IS NULL;
      CREATE TABLE IF NOT EXISTS canvas_projects (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
        document_json TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        FOREIGN KEY (owner_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS canvas_projects_owner_updated_idx ON canvas_projects(owner_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS canvas_assets (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        canvas_id TEXT NOT NULL,
        source_upload_id TEXT,
        object_key TEXT NOT NULL UNIQUE,
        file_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        etag TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('copying', 'ready', 'failed')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        FOREIGN KEY (owner_id) REFERENCES users(id),
        FOREIGN KEY (canvas_id) REFERENCES canvas_projects(id)
      );
      CREATE INDEX IF NOT EXISTS canvas_assets_canvas_idx ON canvas_assets(canvas_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS canvas_assets_delete_idx ON canvas_assets(status, updated_at);
    `);
    const mediaSchema = this.database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'media_objects'").get() as { sql?: string } | undefined;
    if (mediaSchema?.sql && !mediaSchema.sql.includes("'preview'")) {
      this.database.transaction(() => {
        this.database.exec(`
          DROP INDEX IF EXISTS media_objects_task_kind_idx;
          DROP INDEX IF EXISTS media_objects_upload_idx;
          DROP INDEX IF EXISTS media_objects_delete_idx;
          ALTER TABLE media_objects RENAME TO media_objects_before_preview;
          CREATE TABLE media_objects (
            id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL,
            task_id TEXT,
            upload_id TEXT,
            kind TEXT NOT NULL CHECK (kind IN ('input', 'output', 'preview', 'poster')),
            object_key TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL CHECK (status IN ('uploading', 'ready', 'delete_pending', 'deleted')),
            file_name TEXT NOT NULL,
            content_type TEXT NOT NULL,
            size INTEGER NOT NULL DEFAULT 0,
            etag TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            deleted_at INTEGER,
            FOREIGN KEY (owner_id) REFERENCES users(id),
            FOREIGN KEY (task_id) REFERENCES generation_tasks(id)
          );
          INSERT INTO media_objects SELECT * FROM media_objects_before_preview;
          DROP TABLE media_objects_before_preview;
          CREATE INDEX media_objects_task_kind_idx ON media_objects(task_id, kind);
          CREATE INDEX media_objects_upload_idx ON media_objects(upload_id);
          CREATE INDEX media_objects_delete_idx ON media_objects(status, updated_at);
        `);
      })();
    }
  }

  findById(id: string) { return mapUser(this.database.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined); }
  findByEmail(email: string) { return mapUser(this.database.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email) as UserRow | undefined); }

  upsertFromFeishu(profile: { openId: string; unionId: string; tenantKey: string; email: string; name: string; avatarUrl: string }) {
    const now = Date.now();
    const existingByEmail = this.findByEmail(profile.email);
    if (existingByEmail && existingByEmail.feishuOpenId !== profile.openId) throw new Error("该企业邮箱已绑定其他飞书身份，请联系管理员");
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
      INSERT INTO generation_tasks (id, owner_id, visibility, provider_id, status, media_status, media_revision, prompt, model, mode, ratio, resolution, duration, request_json, source_video_url, source_video_expires_at, error, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id, visibility=excluded.visibility, provider_id=excluded.provider_id,
        status=excluded.status, media_status=excluded.media_status, media_revision=excluded.media_revision, prompt=excluded.prompt,
        model=excluded.model, mode=excluded.mode, ratio=excluded.ratio, resolution=excluded.resolution, duration=excluded.duration,
        request_json=excluded.request_json, source_video_url=excluded.source_video_url, source_video_expires_at=excluded.source_video_expires_at,
        error=excluded.error, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at
    `).run(
      task.id, task.ownerId ?? null, task.visibility ?? (task.ownerId ? "private" : "shared"), task.providerId ?? null,
      task.status, task.mediaStatus ?? "none", task.mediaRevision ?? 0, task.prompt, task.model, task.mode, task.ratio,
      task.resolution, task.duration, JSON.stringify(task.request ?? {}), task.sourceVideoUrl ?? null,
      task.sourceVideoExpiresAt ?? null, task.error ?? null, task.createdAt, task.updatedAt, task.deletedAt ?? null
    );
    return task;
  }

  readTask(id: string, includeDeleted = false) {
    const row = this.database.prepare(`SELECT * FROM generation_tasks WHERE id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"}`).get(id) as TaskRow | undefined;
    return mapTask(row);
  }

  listTasksForUser(userId: string, limit = 50) {
    const rows = this.database.prepare(`SELECT * FROM generation_tasks WHERE deleted_at IS NULL AND (owner_id = ? OR visibility = 'shared') ORDER BY created_at DESC LIMIT ?`).all(userId, limit) as TaskRow[];
    return rows.map((row) => mapTask(row)!);
  }

  countActiveTasksForUser(userId: string) {
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM generation_tasks WHERE owner_id = ? AND deleted_at IS NULL AND status IN ('queued', 'submitting', 'running')").get(userId) as { count: number };
    return row.count;
  }

  healthCheck() { return (this.database.prepare("SELECT 1 AS ok").get() as { ok: number }).ok === 1; }

  recoverableMediaTasks(minimumSourceExpiry: number, staleBefore: number, limit = 20) {
    const rows = this.database.prepare(`
      SELECT * FROM generation_tasks
      WHERE deleted_at IS NULL AND status IN ('succeeded', 'failed')
        AND source_video_url IS NOT NULL AND source_video_expires_at > ?
        AND (media_status IN ('failed', 'fallback') OR (media_status = 'archiving' AND updated_at < ?))
        AND NOT EXISTS (
          SELECT 1 FROM media_objects
          WHERE media_objects.task_id = generation_tasks.id AND media_objects.kind = 'output' AND media_objects.status = 'ready'
        )
      ORDER BY updated_at ASC LIMIT ?
    `).all(minimumSourceExpiry, staleBefore, limit) as TaskRow[];
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
      WHERE deleted_at IS NULL AND status = 'succeeded' AND media_status = 'ready'
        AND EXISTS (
          SELECT 1 FROM media_objects
          WHERE media_objects.task_id = generation_tasks.id AND media_objects.kind = 'output' AND media_objects.status = 'ready'
        )
        AND NOT EXISTS (
          SELECT 1 FROM media_objects
          WHERE media_objects.task_id = generation_tasks.id AND media_objects.kind = 'preview' AND media_objects.status = 'ready'
        )
      ORDER BY updated_at ASC LIMIT ?
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

  softDeleteTask(taskId: string, ownerId: string) {
    const now = Date.now();
    return this.database.transaction(() => {
      const result = this.database.prepare("UPDATE generation_tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND visibility = 'private' AND deleted_at IS NULL").run(now, now, taskId, ownerId);
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
    this.database.prepare(`
      INSERT INTO user_assets (id, owner_id, group_id, upload_id, name, asset_type, status, url, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id, group_id=excluded.group_id,
        upload_id=COALESCE(excluded.upload_id, user_assets.upload_id), name=excluded.name,
        asset_type=excluded.asset_type, status=excluded.status, url=COALESCE(excluded.url, user_assets.url),
        updated_at=excluded.updated_at, deleted_at=excluded.deleted_at
    `).run(asset.id, asset.ownerId, asset.groupId, asset.uploadId ?? null, asset.name, asset.assetType, asset.status,
      asset.url ?? null, asset.createdAt, asset.updatedAt, asset.deletedAt ?? null);
    return asset;
  }

  readUserAsset(id: string) {
    return mapUserAsset(this.database.prepare("SELECT * FROM user_assets WHERE id = ? AND deleted_at IS NULL").get(id) as UserAssetRow | undefined);
  }

  listUserAssets(ownerId: string, query = "", limit = 100, assetType?: UserAsset["assetType"], offset = 0) {
    const pattern = `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`;
    const rows = this.database.prepare(`
      SELECT * FROM user_assets
      WHERE owner_id = ? AND deleted_at IS NULL AND name LIKE ? ESCAPE '\\' AND (? IS NULL OR asset_type = ?)
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(ownerId, pattern, assetType ?? null, assetType ?? null, limit, offset) as UserAssetRow[];
    return rows.map((row) => mapUserAsset(row)!);
  }

  renameUserAsset(id: string, ownerId: string, name: string) {
    const result = this.database.prepare("UPDATE user_assets SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").run(name, Date.now(), id, ownerId);
    return result.changes > 0;
  }

  deleteUserAsset(id: string, ownerId: string) {
    const now = Date.now();
    const result = this.database.prepare("UPDATE user_assets SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").run(now, now, id, ownerId);
    return result.changes > 0;
  }

  isUserAssetInActiveTask(id: string, ownerId: string) {
    const escaped = id.replace(/[\\%_]/g, "\\$&");
    const row = this.database.prepare(`
      SELECT 1 AS found FROM generation_tasks
      WHERE owner_id = ? AND deleted_at IS NULL
        AND status IN ('queued', 'submitting', 'running')
        AND request_json LIKE ? ESCAPE '\\'
      LIMIT 1
    `).get(ownerId, `%${escaped}%`) as { found: number } | undefined;
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

  softDeleteCanvasProject(id: string, ownerId: string) {
    const now = Date.now();
    const result = this.database.prepare("UPDATE canvas_projects SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").run(now, now, id, ownerId);
    return result.changes > 0;
  }

  clearGenerationHistory() {
    return this.database.transaction(() => {
      this.database.prepare("DELETE FROM media_objects").run();
      this.database.prepare("DELETE FROM generation_tasks").run();
    })();
  }

  close() { this.database.close(); }
}

export const users = new UserStore(config.databasePath);
