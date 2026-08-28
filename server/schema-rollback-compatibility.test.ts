import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "./migrations.js";
import {
  assertRollbackSchemaCompatibility,
  ROLLBACK_MAX_SUPPORTED_SCHEMA_VERSION,
  ROLLBACK_SCHEMA_VERSION,
} from "./schema-rollback-compatibility.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const createDatabasePath = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-schema-rollback-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "firefly.db");
};

describe("schema 12 compatibility release rollback gate", () => {
  it("reopens a database after the feature release migrates it to schema 13", () => {
    expect(ROLLBACK_SCHEMA_VERSION).toBe(12);
    expect(ROLLBACK_MAX_SUPPORTED_SCHEMA_VERSION).toBe(13);

    const databasePath = createDatabasePath();
    expect(migrateDatabase(databasePath)).toBe(12);
    const featureDatabase = new Database(databasePath);
    featureDatabase.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (13, 'add-atlas-generation-bridge', ?)").run(Date.now());
    featureDatabase.close();

    const compatibilityProcessDatabase = new Database(databasePath, { readonly: true, fileMustExist: true });
    expect(assertRollbackSchemaCompatibility(compatibilityProcessDatabase)).toBe(13);
    compatibilityProcessDatabase.close();
  });

  it("fails closed for databases newer than the compatibility image contract", () => {
    const databasePath = createDatabasePath();
    migrateDatabase(databasePath);
    const database = new Database(databasePath);
    database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (14, 'future', ?)").run(Date.now());

    expect(() => assertRollbackSchemaCompatibility(database)).toThrow("expected 12-13");
    database.close();
  });
});
