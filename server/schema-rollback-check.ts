import Database from "better-sqlite3";
import { config } from "./config.js";
import { assertRollbackSchemaCompatibility } from "./schema-rollback-compatibility.js";

const database = new Database(config.databasePath, { readonly: true, fileMustExist: true });
try {
  const version = assertRollbackSchemaCompatibility(database);
  process.stdout.write(`${JSON.stringify({
    type: "rollback_schema_compatibility_verified",
    at: new Date().toISOString(),
    compatibilityRelease: 11,
    maximumSupportedSchema: 12,
    databaseSchema: version,
  })}\n`);
} finally {
  database.close();
}
