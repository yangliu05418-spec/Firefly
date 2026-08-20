import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "./config.js";
import { UserStore } from "./db.js";
import { migrateDatabase } from "./migrations.js";
import { consumeFeishuAuthorization, createFeishuAuthorization, validateFeishuProfile } from "./feishu.js";
import type { StoredTask } from "./redis.js";
import { canAccessTask } from "./task-access.js";

const openStore = (databasePath: string) => { migrateDatabase(databasePath); return new UserStore(databasePath); };

class MemoryRedis {
  values = new Map<string, string>();
  async set(key: string, value: string) { this.values.set(key, value); return "OK"; }
  async getdel(key: string) { const value = this.values.get(key) ?? null; this.values.delete(key); return value; }
}

const task = (values: Partial<StoredTask> = {}): StoredTask => ({
  id: "task-1", status: "queued", prompt: "", model: "model", mode: "text", ratio: "16:9", resolution: "720p", duration: 4,
  createdAt: Date.now(), updatedAt: Date.now(), ...values
});

describe("enterprise identity and isolation", () => {
  const directories: string[] = [];

  beforeEach(() => {
    config.feishuAppId = "cli_test";
    config.feishuAppSecret = "secret";
    config.feishuTenantKey = "tenant-dokuai";
    config.allowedEmailDomain = "dokuai.tv";
  });

  afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

  it("requires both the configured tenant and email domain", () => {
    const valid = { open_id: "ou_1", union_id: "on_1", tenant_key: "tenant-dokuai", enterprise_email: " Artist@DOKUAI.TV ", name: "Artist" };
    expect(validateFeishuProfile(valid).email).toBe("artist@dokuai.tv");
    expect(() => validateFeishuProfile({ ...valid, tenant_key: "other" })).toThrow("获准企业");
    expect(() => validateFeishuProfile({ ...valid, enterprise_email: "artist@example.com" })).toThrow("企业邮箱");
    expect(() => validateFeishuProfile({ ...valid, enterprise_email: undefined, email: "artist@dokuai.tv" })).toThrow("企业身份");
  });

  it("creates one durable user per Feishu identity and rejects email rebinding", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-users-")); directories.push(directory);
    const store = openStore(path.join(directory, "users.db"));
    const profile = { openId: "ou_1", unionId: "on_1", tenantKey: "tenant-dokuai", email: "artist@dokuai.tv", name: "Artist", avatarUrl: "" };
    const first = store.upsertFromFeishu(profile);
    expect(store.upsertFromFeishu({ ...profile, name: "Artist Two" }).id).toBe(first.id);
    expect(() => store.upsertFromFeishu({ ...profile, openId: "ou_2" })).toThrow("已绑定");
    expect(store.disableByEmail(profile.email)?.status).toBe("disabled");
    store.close();
  });

  it("persists private tasks and media independently of Redis", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-tasks-")); directories.push(directory);
    const databasePath = path.join(directory, "firefly.db");
    let store = openStore(databasePath);
    const owner = store.upsertFromFeishu({ openId: "ou_owner", unionId: "on_owner", tenantKey: "tenant-dokuai", email: "owner@dokuai.tv", name: "Owner", avatarUrl: "" });
    const other = store.upsertFromFeishu({ openId: "ou_other", unionId: "on_other", tenantKey: "tenant-dokuai", email: "other@dokuai.tv", name: "Other", avatarUrl: "" });
    const storedTask = task({ id: "task-durable", ownerId: owner.id, visibility: "private", status: "succeeded", mediaStatus: "ready", mediaRevision: 1 });
    store.saveTask(storedTask);
    expect(store.healthCheck()).toBe(true);
    expect(store.countActiveTasksForUser(owner.id)).toBe(0);
    store.saveTask(task({ id: "task-running", ownerId: owner.id, visibility: "private", status: "running" }));
    expect(store.countActiveTasksForUser(owner.id)).toBe(1);
    store.upsertMedia({ id: "media-output", ownerId: owner.id, taskId: storedTask.id, kind: "output", objectKey: "outputs/aa/result.mp4", status: "ready", fileName: "result.mp4", contentType: "video/mp4", size: 1024, etag: "etag", createdAt: Date.now(), updatedAt: Date.now() });
    store.close();
    store = openStore(databasePath);
    expect(store.listTasksForUser(owner.id).map((item) => item.id)).toContain(storedTask.id);
    expect(store.listTasksForUser(other.id).map((item) => item.id)).not.toContain(storedTask.id);
    expect(store.readTaskMedia(storedTask.id, "output")?.objectKey).toBe("outputs/aa/result.mp4");
    expect(store.softDeleteTask(storedTask.id, other.id)).toBe(false);
    expect(store.softDeleteTask(storedTask.id, owner.id)).toBe(true);
    expect(store.readTask(storedTask.id)).toBeNull();
    expect(store.pendingMediaDeletes()[0]?.id).toBe("media-output");
    store.close();
  });

  it("atomically enforces the per-user active generation limit", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-generation-limit-")); directories.push(directory);
    const store = openStore(path.join(directory, "firefly.db"));
    const owner = store.upsertFromFeishu({ openId: "ou_limit", unionId: "on_limit", tenantKey: "tenant-dokuai", email: "limit@dokuai.tv", name: "Limit", avatarUrl: "" });
    expect(store.createTaskWithinLimit(task({ id: "task-limit-1", ownerId: owner.id }), 1)).toBe(true);
    expect(store.createTaskWithinLimit(task({ id: "task-limit-2", ownerId: owner.id }), 1)).toBe(false);
    expect(store.readTask("task-limit-2")).toBeNull();
    store.close();
  });

  it("refuses a legacy media-table rebuild during an online migration", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-preview-migration-")); directories.push(directory);
    const databasePath = path.join(directory, "legacy.db");
    const legacy = new Database(databasePath);
    legacy.exec(`CREATE TABLE media_objects (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, task_id TEXT, upload_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('input', 'output', 'poster')),
      object_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('uploading', 'ready', 'delete_pending', 'deleted')),
      file_name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0,
      etag TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
    )`);
    legacy.close();
    expect(() => openStore(databasePath)).toThrow("refusing a destructive migration");
  });

  it("selects only recoverable TOS archives with a valid temporary source", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-recovery-")); directories.push(directory);
    const store = openStore(path.join(directory, "recovery.db"));
    const owner = store.upsertFromFeishu({ openId: "ou_recovery", unionId: "on_recovery", tenantKey: "tenant-dokuai", email: "recovery@dokuai.tv", name: "Recovery", avatarUrl: "" });
    const now = Date.now();
    const archive = (id: string, values: Partial<StoredTask> = {}) => store.saveTask(task({ id, ownerId: owner.id, visibility: "private", status: "succeeded", mediaStatus: "failed", sourceVideoUrl: "https://provider.example/video.mp4", sourceVideoExpiresAt: now + 60 * 60_000, updatedAt: now - 60 * 60_000, ...values }));
    archive("recover-failed");
    archive("recover-stale", { mediaStatus: "archiving" });
    archive("recover-handoff-failed", { status: "failed", mediaStatus: "archiving" });
    archive("recover-legacy-fallback", { mediaStatus: "fallback" });
    archive("ignore-active", { mediaStatus: "archiving", updatedAt: now });
    archive("ignore-expired", { sourceVideoExpiresAt: now - 1 });
    archive("ignore-ready");
    store.upsertMedia({ id: "ready-output", ownerId: owner.id, taskId: "ignore-ready", kind: "output", objectKey: "outputs/ready.mp4", status: "ready", fileName: "result.mp4", contentType: "video/mp4", size: 10, etag: "etag", createdAt: now, updatedAt: now });
    expect(store.recoverableMediaTasks(now + 5 * 60_000, now - 30 * 60_000).map((item) => item.id).sort()).toEqual(["ignore-ready", "recover-failed", "recover-handoff-failed", "recover-legacy-fallback", "recover-stale"]);
    store.close();
  });

  it("selects ready videos whose poster still needs recovery", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-posters-")); directories.push(directory);
    const store = openStore(path.join(directory, "posters.db"));
    const owner = store.upsertFromFeishu({ openId: "ou_poster", unionId: "on_poster", tenantKey: "tenant-dokuai", email: "poster@dokuai.tv", name: "Poster", avatarUrl: "" });
    const now = Date.now();
    const saveReady = (id: string) => store.saveTask(task({ id, ownerId: owner.id, visibility: "private", status: "succeeded", mediaStatus: "ready", updatedAt: now }));
    saveReady("poster-missing"); saveReady("poster-ready"); saveReady("output-missing");
    for (const id of ["poster-missing", "poster-ready"]) store.upsertMedia({ id: `${id}:output`, ownerId: owner.id, taskId: id, kind: "output", objectKey: `outputs/${id}.mp4`, status: "ready", fileName: "result.mp4", contentType: "video/mp4", size: 10, etag: "etag", createdAt: now, updatedAt: now });
    store.upsertMedia({ id: "poster-ready:poster", ownerId: owner.id, taskId: "poster-ready", kind: "poster", objectKey: "posters/poster-ready.webp", status: "ready", fileName: "poster.webp", contentType: "image/webp", size: 10, etag: "etag", createdAt: now, updatedAt: now });
    expect(store.recoverablePosterTasks().map((item) => item.id)).toEqual(["poster-missing"]);
    store.close();
  });

  it("selects the newest archived originals whose streaming preview still needs recovery", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-previews-")); directories.push(directory);
    const store = openStore(path.join(directory, "previews.db"));
    const owner = store.upsertFromFeishu({ openId: "ou_preview", unionId: "on_preview", tenantKey: "tenant-dokuai", email: "preview@dokuai.tv", name: "Preview", avatarUrl: "" });
    const now = Date.now();
    const saveReady = (id: string, updatedAt: number, mediaStatus: StoredTask["mediaStatus"] = "ready") => store.saveTask(task({ id, ownerId: owner.id, visibility: "private", status: "succeeded", mediaStatus, updatedAt }));
    saveReady("preview-older", now - 2000);
    saveReady("preview-newer", now - 1000, "archiving");
    saveReady("preview-ready", now - 3000);
    saveReady("original-missing", now);
    for (const id of ["preview-older", "preview-newer", "preview-ready"]) store.upsertMedia({ id: `${id}:output`, ownerId: owner.id, taskId: id, kind: "output", objectKey: `outputs/${id}.mp4`, status: "ready", fileName: "result.mp4", contentType: "video/mp4", size: 10, etag: "etag", createdAt: now, updatedAt: now });
    store.upsertMedia({ id: "preview-ready:preview", ownerId: owner.id, taskId: "preview-ready", kind: "preview", objectKey: "previews/preview-ready.mp4", status: "ready", fileName: "preview.mp4", contentType: "video/mp4", size: 5, etag: "etag", createdAt: now, updatedAt: now });
    expect(store.recoverablePreviewTasks().map((item) => item.id)).toEqual(["preview-newer", "preview-older"]);
    store.close();
  });

  it("allows only the owner or explicitly shared legacy tasks", () => {
    expect(canAccessTask(task({ ownerId: "user-a", visibility: "private" }), "user-a")).toBe(true);
    expect(canAccessTask(task({ ownerId: "user-a", visibility: "private" }), "user-b")).toBe(false);
    expect(canAccessTask(task({ visibility: "shared" }), "user-b")).toBe(true);
    expect(canAccessTask(task(), "user-b")).toBe(true);
  });

  it("isolates user asset visibility, rename, and delete operations", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-assets-")); directories.push(directory);
    const store = openStore(path.join(directory, "assets.db"));
    const owner = store.upsertFromFeishu({ openId: "ou_asset_owner", unionId: "on_asset_owner", tenantKey: "tenant-dokuai", email: "asset-owner@dokuai.tv", name: "Owner", avatarUrl: "" });
    const other = store.upsertFromFeishu({ openId: "ou_asset_other", unionId: "on_asset_other", tenantKey: "tenant-dokuai", email: "asset-other@dokuai.tv", name: "Other", avatarUrl: "" });
    const now = Date.now();
    store.upsertUserAsset({ id: "asset-owner-1", ownerId: owner.id, groupId: "group-shared-provider", uploadId: "upload-owner", name: "owner.png", assetType: "Image", status: "Active", category: "character", url: "https://example.com/owner.png", createdAt: now, updatedAt: now });
    store.upsertUserAsset({ id: "asset-other-1", ownerId: other.id, groupId: "group-shared-provider", uploadId: "upload-other", name: "other.png", assetType: "Image", status: "Active", category: "scene", createdAt: now, updatedAt: now });
    store.upsertUserAsset({ id: "asset-owner-video", ownerId: owner.id, groupId: "group-shared-provider", name: "clip.mp4", assetType: "Video", status: "Active", category: "material", createdAt: now - 1, updatedAt: now });
    expect(store.listUserAssets(owner.id).map((asset) => asset.id)).toEqual(["asset-owner-1", "asset-owner-video"]);
    expect(store.listUserAssets(other.id).map((asset) => asset.id)).toEqual(["asset-other-1"]);
    expect(store.listUserAssets(owner.id, "owner", 10, "Image").map((asset) => asset.id)).toEqual(["asset-owner-1"]);
    expect(store.listUserAssets(owner.id, "", 1, undefined, 1).map((asset) => asset.id)).toEqual(["asset-owner-video"]);
    expect(store.listUserAssets(owner.id, "", 10, "Image", 0, "character").map((asset) => asset.id)).toEqual(["asset-owner-1"]);
    expect(store.updateUserAssetCategory("asset-owner-1", other.id, "scene")).toBe(false);
    expect(store.updateUserAssetCategory("asset-owner-1", owner.id, "prop")).toBe(true);
    expect(store.readUserAsset("asset-owner-1")?.category).toBe("prop");
    store.saveTask(task({ id: "asset-running-task", ownerId: owner.id, status: "running", request: { assets: [{ assetId: "asset-owner-1" }] } }));
    expect(store.isUserAssetInActiveTask("asset-owner-1", owner.id)).toBe(true);
    expect(store.isUserAssetInActiveTask("asset-owner-1", other.id)).toBe(false);
    expect(store.renameUserAsset("asset-owner-1", other.id, "stolen.png")).toBe(false);
    expect(store.deleteUserAsset("asset-owner-1", other.id)).toBe(false);
    expect(store.renameUserAsset("asset-owner-1", owner.id, "renamed.png")).toBe(true);
    expect(store.readUserAsset("asset-owner-1")?.name).toBe("renamed.png");
    expect(store.deleteUserAsset("asset-owner-1", owner.id)).toBe(true);
    expect(store.readUserAsset("asset-owner-1")).toBeNull();
    store.close();
  });

  it("keeps the first local asset when concurrent requests reuse one upload id", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-asset-idempotency-")); directories.push(directory);
    const store = openStore(path.join(directory, "assets.db"));
    const owner = store.upsertFromFeishu({ openId: "ou_asset_race", unionId: "on_asset_race", tenantKey: "tenant-dokuai", email: "asset-race@dokuai.tv", name: "Owner", avatarUrl: "" });
    const first = { id: "asset-local-first", ownerId: owner.id, groupId: "group-1", uploadId: "upload-shared", name: "first.png", assetType: "Image" as const, status: "Processing" as const, category: "material" as const, createdAt: 1, updatedAt: 1 };
    store.upsertUserAsset(first);
    const reused = store.upsertUserAsset({ ...first, id: "asset-local-second", name: "second.png", updatedAt: 2 });
    expect(reused.id).toBe(first.id);
    expect(store.readUserAssetByUpload(owner.id, first.uploadId)?.name).toBe("first.png");
    store.close();
  });

  it("allows the owner to delete their own shared tasks (read-only for others)", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-shared-delete-")); directories.push(directory);
    const store = openStore(path.join(directory, "shared.db"));
    const owner = store.upsertFromFeishu({ openId: "ou_shared_owner", unionId: "on_shared_owner", tenantKey: "tenant-dokuai", email: "shared-owner@dokuai.tv", name: "Owner", avatarUrl: "" });
    const other = store.upsertFromFeishu({ openId: "ou_shared_other", unionId: "on_shared_other", tenantKey: "tenant-dokuai", email: "shared-other@dokuai.tv", name: "Other", avatarUrl: "" });
    store.saveTask(task({ id: "shared-task", ownerId: owner.id, visibility: "shared", status: "succeeded", mediaStatus: "ready", mediaRevision: 1 }));
    expect(store.softDeleteTask("shared-task", other.id)).toBe(false);
    expect(store.softDeleteTask("shared-task", owner.id)).toBe(true);
    expect(store.readTask("shared-task")).toBeNull();
    store.close();
  });

  it("matches active asset references structurally (no substring false positives)", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-asset-ref-")); directories.push(directory);
    const store = openStore(path.join(directory, "asset-ref.db"));
    const owner = store.upsertFromFeishu({ openId: "ou_ref_owner", unionId: "on_ref_owner", tenantKey: "tenant-dokuai", email: "ref-owner@dokuai.tv", name: "Owner", avatarUrl: "" });
    store.saveTask(task({ id: "ref-running", ownerId: owner.id, status: "running", request: { assets: [{ assetId: "asset-abcdef", name: "a.png", type: "image" }] } }));
    expect(store.isUserAssetInActiveTask("asset-abcdef", owner.id)).toBe(true);
    // 前缀重叠的 id 不再误判
    expect(store.isUserAssetInActiveTask("asset-abc", owner.id)).toBe(false);
    // uploadId 形态（尚未注册）不匹配 assetId
    expect(store.isUserAssetInActiveTask("upload-xyz", owner.id)).toBe(false);
    // 非活动任务不阻塞删除
    store.saveTask(task({ id: "ref-done", ownerId: owner.id, status: "succeeded", request: { assets: [{ assetId: "asset-done" }] } }));
    expect(store.isUserAssetInActiveTask("asset-done", owner.id)).toBe(false);
    store.close();
  });

  it("persists media trace fields and caps recovery attempts", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-trace-")); directories.push(directory);
    const databasePath = path.join(directory, "trace.db");
    let store = openStore(databasePath);
    const owner = store.upsertFromFeishu({ openId: "ou_trace", unionId: "on_trace", tenantKey: "tenant-dokuai", email: "trace@dokuai.tv", name: "Trace", avatarUrl: "" });
    const now = Date.now();
    store.saveTask(task({ id: "trace-1", ownerId: owner.id, visibility: "private", status: "succeeded", mediaStatus: "failed", sourceVideoUrl: "https://provider.example/v.mp4", sourceVideoExpiresAt: now + 3600_000, fetchTaskId: "fetch-123", mediaAttempts: 1, mediaLastError: JSON.stringify({ phase: "url_fetch", message: "boom" }), updatedAt: now }));
    store.close();
    store = openStore(databasePath);
    const loaded = store.readTask("trace-1")!;
    expect(loaded.fetchTaskId).toBe("fetch-123");
    expect(loaded.mediaAttempts).toBe(1);
    expect(JSON.parse(loaded.mediaLastError!).message).toBe("boom");
    // 达到恢复上限后不再进入可恢复集合
    const recoverable = store.recoverableMediaTasks(now + 5 * 60_000, now - 60_000, 20);
    expect(recoverable.map((item) => item.id)).toContain("trace-1");
    store.saveTask({ ...loaded, mediaAttempts: 3, updatedAt: Date.now() });
    expect(store.recoverableMediaTasks(now + 5 * 60_000, now - 60_000, 20).map((item) => item.id)).not.toContain("trace-1");
    store.close();
  });

  it("consumes OAuth state only once and keeps return paths local", async () => {
    const redis = new MemoryRedis();
    const authorization = new URL(await createFeishuAuthorization(redis as never, "//evil.example"));
    const state = authorization.searchParams.get("state")!;
    const pending = await consumeFeishuAuthorization(redis as never, state);
    expect(pending.returnTo).toBe("/studio");
    await expect(consumeFeishuAuthorization(redis as never, state)).rejects.toThrow("已过期");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("scope")).toContain("contact:user.employee:readonly");
  });
});
