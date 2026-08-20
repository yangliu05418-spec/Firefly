import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export const CURRENT_SCHEMA_VERSION = 2;

const baseSchema = `
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
    fetch_task_id TEXT,
    media_attempts INTEGER NOT NULL DEFAULT 0,
    media_last_error TEXT,
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
    kind TEXT NOT NULL CHECK (kind IN ('input', 'output', 'preview', 'poster', 'generated')),
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
`;

const migrationTable = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at INTEGER NOT NULL
  )
`;

const assetRegistrationOperationsSchema = `
  CREATE TABLE IF NOT EXISTS asset_registration_operations (
    owner_id TEXT NOT NULL,
    upload_id TEXT NOT NULL,
    deterministic_name TEXT NOT NULL,
    group_id TEXT NOT NULL,
    provider_asset_id TEXT,
    asset_type TEXT NOT NULL CHECK (asset_type IN ('Image', 'Video', 'Audio')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'created', 'unknown', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (owner_id, upload_id),
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS asset_registration_operations_status_idx
    ON asset_registration_operations(status, updated_at);
`;

const tableExists = (database: Database.Database, name: string) => Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

export const schemaVersion = (database: Database.Database) => {
  if (!tableExists(database, "schema_migrations")) return 0;
  return Number((database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number }).version);
};

export const assertSchemaVersion = (database: Database.Database) => {
  const version = schemaVersion(database);
  if (version !== CURRENT_SCHEMA_VERSION) throw new Error(`Database schema version ${version} is not supported; expected ${CURRENT_SCHEMA_VERSION}. Run npm run db:migrate.`);
  return version;
};

const applyBaseline = (database: Database.Database) => {
  database.exec(baseSchema);
  const taskColumns = new Set((database.prepare("PRAGMA table_info(generation_tasks)").all() as { name: string }[]).map((column) => column.name));
  const addTaskColumn = (name: string, definition: string) => {
    if (!taskColumns.has(name)) database.exec(`ALTER TABLE generation_tasks ADD COLUMN ${name} ${definition}`);
  };
  addTaskColumn("fetch_task_id", "TEXT");
  addTaskColumn("media_attempts", "INTEGER NOT NULL DEFAULT 0");
  addTaskColumn("media_last_error", "TEXT");

  const mediaSchema = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'media_objects'").get() as { sql?: string } | undefined;
  if (!mediaSchema?.sql?.includes("'preview'") || !mediaSchema.sql.includes("'generated'")) {
    throw new Error("Legacy media_objects requires an offline rebuild; refusing a destructive migration during blue-green deployment");
  }
};

export const migrateDatabase = (databasePath: string) => {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  try {
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 30000");
    database.transaction(() => {
      database.exec(migrationTable);
      const version = schemaVersion(database);
      if (version > CURRENT_SCHEMA_VERSION) throw new Error(`Database schema ${version} is newer than this release (${CURRENT_SCHEMA_VERSION})`);
      if (version < 1) {
        applyBaseline(database);
        database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(1, "baseline-current-schema", Date.now());
      }
      if (schemaVersion(database) < 2) {
        database.exec(assetRegistrationOperationsSchema);
        database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(2, "asset-registration-operations", Date.now());
      }
      assertSchemaVersion(database);
    }).exclusive();
    return schemaVersion(database);
  } finally { database.close(); }
};
