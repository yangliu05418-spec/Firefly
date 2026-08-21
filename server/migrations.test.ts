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
    expect((database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count).toBe(5);
    const assetColumns = (database.prepare("PRAGMA table_info(user_assets)").all() as { name: string }[]).map((column) => column.name);
    expect(assetColumns).toEqual(expect.arrayContaining(["category", "provider_asset_id", "last_error"]));
    expect((database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='canvas_project_assets'").get() as { name: string }).name).toBe("canvas_project_assets");
    expect((database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='image_generation_tasks'").get() as { name: string }).name).toBe("image_generation_tasks");
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

  it("rejects a database newer than this release", () => {
    const target = databasePath();
    migrateDatabase(target);
    const database = new Database(target);
    database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (6, 'future-incompatible', ?)").run(Date.now());
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
    database.exec("DELETE FROM schema_migrations WHERE version = 5; DROP TABLE image_generation_tasks");
    database.prepare(`INSERT INTO users (id, feishu_open_id, feishu_union_id, tenant_key, email, name, avatar_url, status, created_at, last_login_at) VALUES ('owner-1', 'open-1', 'union-1', 'tenant-1', 'owner@dokuai.tv', 'Owner', '', 'active', 1, 1)`).run();
    database.prepare(`INSERT INTO media_objects (id, owner_id, kind, object_key, status, file_name, content_type, size, etag, created_at, updated_at) VALUES ('gen-old', 'owner-1', 'generated', 'generated/old.png', 'ready', 'old.png', 'image/png', 100, 'etag', 2, 2)`).run();
    database.close();

    expect(migrateDatabase(target)).toBe(5);
    const migrated = new Database(target, { readonly: true });
    expect(migrated.prepare("SELECT id, owner_id, status, items_json FROM image_generation_tasks").get()).toMatchObject({
      id: "legacy-gen-old", owner_id: "owner-1", status: "succeeded", items_json: '[{"mediaId":"gen-old"}]',
    });
    migrated.close();
  });
});
