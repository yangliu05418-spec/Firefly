import type Database from "better-sqlite3";
import { assertSchemaVersionRange } from "./migrations.js";

// These constants model the exact startup contract of the compatibility image
// that must be published before the feature image migrates production to 13.
// Keep them explicit: widening the feature release's range must not silently
// make an older rollback image appear compatible.
export const ROLLBACK_SCHEMA_VERSION = 12;
export const ROLLBACK_MAX_SUPPORTED_SCHEMA_VERSION = 13;

export const assertRollbackSchemaCompatibility = (database: Database.Database) => assertSchemaVersionRange(
  database,
  ROLLBACK_SCHEMA_VERSION,
  ROLLBACK_MAX_SUPPORTED_SCHEMA_VERSION,
  "schema-12 compatibility release",
);
