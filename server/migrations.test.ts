import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { UserStore } from "./db.js";
import { assertSchemaVersion, CURRENT_SCHEMA_VERSION, migrateDatabase, schemaVersion } from "./migrations.js";

describe("versioned database migrations", () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

  const databasePath = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-migration-"));
    directories.push(directory);
    return path.join(directory, "firefly.db");
  };

  it("creates a fresh schema and can be run repeatedly", () => {
    const target = databasePath();
    expect(migrateDatabase(target)).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrateDatabase(target)).toBe(CURRENT_SCHEMA_VERSION);
    const database = new Database(target, { readonly: true });
    expect(schemaVersion(database)).toBe(CURRENT_SCHEMA_VERSION);
    expect(assertSchemaVersion(database)).toBe(CURRENT_SCHEMA_VERSION);
    expect((database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count).toBe(3);
    expect((database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='asset_registration_operations'").get() as { count: number }).count).toBe(1);
    expect((database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='image_generation_tasks'").get() as { count: number }).count).toBe(1);
    database.close();
  });

  it("requires an explicit migration before opening an application store", () => {
    const target = databasePath();
    expect(() => new UserStore(target)).toThrow("db:migrate");
    migrateDatabase(target);
    const store = new UserStore(target);
    expect(store.schemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
    store.close();
  });

  it("adopts the current production schema without rebuilding tables", () => {
    const target = databasePath();
    migrateDatabase(target);
    const database = new Database(target);
    database.exec("DROP TABLE schema_migrations");
    const mediaSqlBefore = (database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='media_objects'").get() as { sql: string }).sql;
    database.close();
    expect(migrateDatabase(target)).toBe(CURRENT_SCHEMA_VERSION);
    const migrated = new Database(target, { readonly: true });
    const mediaSqlAfter = (migrated.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='media_objects'").get() as { sql: string }).sql;
    expect(mediaSqlAfter).toBe(mediaSqlBefore);
    migrated.close();
  });

  it("upgrades a version-one database with an expand-only operation table", () => {
    const target = databasePath();
    migrateDatabase(target);
    const database = new Database(target);
    database.exec("DROP TABLE image_generation_tasks; DROP TABLE asset_registration_operations; DELETE FROM schema_migrations WHERE version >= 2");
    const mediaSqlBefore = (database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='media_objects'").get() as { sql: string }).sql;
    database.close();
    expect(migrateDatabase(target)).toBe(CURRENT_SCHEMA_VERSION);
    const upgraded = new Database(target, { readonly: true });
    expect(schemaVersion(upgraded)).toBe(3);
    expect((upgraded.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='media_objects'").get() as { sql: string }).sql).toBe(mediaSqlBefore);
    expect((upgraded.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='asset_registration_operations'").get() as { count: number }).count).toBe(1);
    upgraded.close();
  });

  it("upgrades a version-two database with an expand-only image task table", () => {
    const target = databasePath();
    migrateDatabase(target);
    const database = new Database(target);
    database.exec("DROP TABLE image_generation_tasks; DELETE FROM schema_migrations WHERE version = 3");
    database.close();
    expect(migrateDatabase(target)).toBe(3);
    const upgraded = new Database(target, { readonly: true });
    expect((upgraded.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='image_generation_tasks'").get() as { count: number }).count).toBe(1);
    upgraded.close();
  });

  it("stores one operation per owner/upload and allows only one retry claimant", () => {
    const target = databasePath();
    migrateDatabase(target);
    const store = new UserStore(target);
    const owner = store.upsertFromFeishu({ openId: "ou-operation", unionId: "on-operation", tenantKey: "tenant", email: "operation@dokuai.tv", name: "Operation", avatarUrl: "" });
    const seed = { ownerId: owner.id, uploadId: "upload-operation-1234567890", deterministicName: "ff-name", groupId: "group-1", assetType: "Image" as const, createdAt: 10, updatedAt: 10 };
    expect(store.createAssetRegistrationOperation(seed).inserted).toBe(true);
    expect(store.createAssetRegistrationOperation(seed).inserted).toBe(false);
    store.updateAssetRegistrationOperation(owner.id, seed.uploadId, { status: "unknown", updatedAt: 20 });
    expect(store.claimAssetRegistrationRetry(owner.id, seed.uploadId, 20, 30)?.attemptCount).toBe(2);
    expect(store.claimAssetRegistrationRetry(owner.id, seed.uploadId, 20, 31)).toBeNull();
    store.close();
  });

  it("atomically enforces two active image tasks per user across web instances", () => {
    const target = databasePath();
    migrateDatabase(target);
    const first = new UserStore(target);
    const owner = first.upsertFromFeishu({ openId: "ou-image-owner", unionId: "on-image-owner", tenantKey: "tenant", email: "images@dokuai.tv", name: "Images", avatarUrl: "" });
    const other = first.upsertFromFeishu({ openId: "ou-image-other", unionId: "on-image-other", tenantKey: "tenant", email: "other-images@dokuai.tv", name: "Other", avatarUrl: "" });
    const second = new UserStore(target);
    const imageTask = (id: string, ownerId = owner.id) => ({ id, ownerId, status: "queued" as const, model: "model", ratio: "1:1", resolution: "1024", requestedCount: 1, prompt: "prompt", referenceUploadIds: [], items: [], failures: [], createdAt: Date.now(), updatedAt: Date.now() });
    expect(first.createImageGenerationTask(imageTask("image-1"))).not.toBeNull();
    expect(second.createImageGenerationTask(imageTask("image-2"))).not.toBeNull();
    expect(first.createImageGenerationTask(imageTask("image-3"))).toBeNull();
    expect(second.listImageGenerationTasks(other.id)).toEqual([]);
    first.updateImageGenerationTask("image-1", { status: "succeeded", items: [{ index: 0, mediaId: "media-1" }], completedAt: Date.now() });
    expect(second.createImageGenerationTask(imageTask("image-3"))).not.toBeNull();
    expect(new Set(second.listImageGenerationTasks(owner.id).map((task) => task.id))).toEqual(new Set(["image-1", "image-2", "image-3"]));
    second.close(); first.close();
  });
});
