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
    expect((database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count).toBe(9);
    const assetColumns = (database.prepare("PRAGMA table_info(user_assets)").all() as { name: string }[]).map((column) => column.name);
    expect(assetColumns).toEqual(expect.arrayContaining(["category", "provider_asset_id", "last_error"]));
    expect((database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='canvas_project_assets'").get() as { name: string }).name).toBe("canvas_project_assets");
    expect((database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='image_generation_tasks'").get() as { name: string }).name).toBe("image_generation_tasks");
    expect((database.prepare("PRAGMA table_info(image_generation_tasks)").all() as { name: string }[]).map((column) => column.name)).toContain("references_json");
    expect((database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='creation_sessions'").get() as { name: string }).name).toBe("creation_sessions");
    expect((database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='async_job_outbox'").get() as { name: string }).name).toBe("async_job_outbox");
    expect((database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='upload_sessions'").get() as { name: string }).name).toBe("upload_sessions");
    database.close();
  });

  it("expands a version-one asset table with a safe default category", () => {
    const target = databasePath();
    const database = new Database(target);
    database.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at INTEGER NOT NULL);
      INSERT INTO schema_migrations VALUES (1, 'baseline-current-schema', 1);
      CREATE TABLE user_assets (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, group_id TEXT NOT NULL, upload_id TEXT, name TEXT NOT NULL,
        asset_type TEXT NOT NULL, status TEXT NOT NULL, url TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
      );
      INSERT INTO user_assets VALUES ('asset-1', 'user-1', 'group-1', NULL, '旧素材', 'Image', 'Active', NULL, 1, 1, NULL);
    `);
    database.close();
    expect(migrateDatabase(target)).toBe(CURRENT_SCHEMA_VERSION);
    const migrated = new Database(target, { readonly: true });
    expect(migrated.prepare("SELECT category, provider_asset_id FROM user_assets WHERE id = 'asset-1'").get()).toMatchObject({ category: "material", provider_asset_id: "asset-1" });
    migrated.close();
  });

  it("requires an explicit migration before opening an application store", () => {
    const target = databasePath();
    expect(() => new UserStore(target)).toThrow("db:migrate");
    migrateDatabase(target);
    const store = new UserStore(target);
    expect(store.schemaVersion()).toBe(CURRENT_SCHEMA_VERSION);
    store.close();
  });

  it("upgrades schema six with the durable outbox and upload sessions", () => {
    const target = databasePath();
    migrateDatabase(target);
    const database = new Database(target);
    database.exec("DELETE FROM schema_migrations WHERE version >= 7; DROP TABLE async_job_outbox; DROP TABLE upload_sessions");
    const taskSqlBefore = (database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'generation_tasks'").get() as { sql: string }).sql;
    database.close();

    expect(migrateDatabase(target)).toBe(CURRENT_SCHEMA_VERSION);
    const upgraded = new Database(target, { readonly: true });
    expect((upgraded.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'generation_tasks'").get() as { sql: string }).sql).toBe(taskSqlBefore);
    expect(upgraded.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'async_job_outbox'").get()).toMatchObject({ name: "async_job_outbox" });
    expect(upgraded.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'upload_sessions'").get()).toMatchObject({ name: "upload_sessions" });
    upgraded.close();
  });

  it("upgrades schema seven by adding only upload sessions", () => {
    const target = databasePath();
    migrateDatabase(target);
    const database = new Database(target);
    database.exec("DELETE FROM schema_migrations WHERE version >= 8; DROP TABLE upload_sessions");
    database.close();
    expect(migrateDatabase(target)).toBe(CURRENT_SCHEMA_VERSION);
    const upgraded = new Database(target, { readonly: true });
    expect(upgraded.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='upload_sessions'").get()).toMatchObject({ name: "upload_sessions" });
    upgraded.close();
  });

  it("upgrades schema eight without changing existing image history", () => {
    const target = databasePath();
    migrateDatabase(target);
    const database = new Database(target);
    database.prepare("DELETE FROM schema_migrations WHERE version = 9").run();
    database.exec("ALTER TABLE image_generation_tasks DROP COLUMN references_json");
    database.prepare(`INSERT INTO image_generation_tasks (id, session_id, owner_id, model, model_name, ratio, resolution, prompt, requested_count, status, items_json, failures_json, created_at, updated_at) VALUES ('image-old', NULL, 'owner-1', 'model-1', 'Model', '1:1', '1024', 'Prompt', 1, 'failed', '[]', '[]', 1, 1)`).run();
    database.close();

    expect(migrateDatabase(target)).toBe(CURRENT_SCHEMA_VERSION);
    const upgraded = new Database(target, { readonly: true });
    expect(upgraded.prepare("SELECT prompt, references_json FROM image_generation_tasks WHERE id = 'image-old'").get()).toMatchObject({ prompt: "Prompt", references_json: "[]" });
    upgraded.close();
  });

  it("rejects a database newer than the rollback compatibility ceiling", () => {
    const target = databasePath();
    migrateDatabase(target);
    const database = new Database(target);
    database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (10, 'future-incompatible', ?)").run(Date.now());
    database.close();
    expect(() => migrateDatabase(target)).toThrow("newer than this release");
    const incompatible = new Database(target, { readonly: true });
    expect(() => assertSchemaVersion(incompatible)).toThrow("not supported");
    incompatible.close();
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

  it("backfills already archived generated images when upgrading from schema four", () => {
    const target = databasePath();
    migrateDatabase(target);
    const database = new Database(target);
    database.exec("DELETE FROM schema_migrations WHERE version >= 5; DROP TABLE image_generation_tasks; DROP TABLE creation_sessions");
    database.prepare(`INSERT INTO users (id, feishu_open_id, feishu_union_id, tenant_key, email, name, avatar_url, status, created_at, last_login_at) VALUES ('owner-1', 'open-1', 'union-1', 'tenant-1', 'owner@dokuai.tv', 'Owner', '', 'active', 1, 1)`).run();
    database.prepare(`INSERT INTO media_objects (id, owner_id, kind, object_key, status, file_name, content_type, size, etag, created_at, updated_at) VALUES ('gen-old', 'owner-1', 'generated', 'generated/old.png', 'ready', 'old.png', 'image/png', 100, 'etag', 2, 2)`).run();
    database.close();

    expect(migrateDatabase(target)).toBe(CURRENT_SCHEMA_VERSION);
    const migrated = new Database(target, { readonly: true });
    expect(migrated.prepare("SELECT id, owner_id, status, items_json FROM image_generation_tasks").get()).toMatchObject({
      id: "legacy-gen-old", owner_id: "owner-1", status: "succeeded", items_json: '[{"mediaId":"gen-old"}]',
    });
    expect(migrated.prepare("SELECT id, owner_id FROM creation_sessions WHERE id = 'legacy-image-legacy-gen-old'").get()).toMatchObject({ id: "legacy-image-legacy-gen-old", owner_id: "owner-1" });
    migrated.close();
  });
});
