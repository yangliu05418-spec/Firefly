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
    expect((database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count).toBe(2);
    expect((database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='asset_registration_operations'").get() as { count: number }).count).toBe(1);
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
    database.exec("DROP TABLE asset_registration_operations; DELETE FROM schema_migrations WHERE version = 2");
    const mediaSqlBefore = (database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='media_objects'").get() as { sql: string }).sql;
    database.close();
    expect(migrateDatabase(target)).toBe(CURRENT_SCHEMA_VERSION);
    const upgraded = new Database(target, { readonly: true });
    expect(schemaVersion(upgraded)).toBe(2);
    expect((upgraded.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='media_objects'").get() as { sql: string }).sql).toBe(mediaSqlBefore);
    expect((upgraded.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='asset_registration_operations'").get() as { count: number }).count).toBe(1);
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
});
