import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export const CURRENT_SCHEMA_VERSION = 13;
// Compatibility release for the Atlas generation bridge. This image still
// requires schema 12, but can safely run after the expand-only schema 13
// migration. The feature image advances CURRENT to 13 only after this build is
// available as the rollback target.
export const MAX_SUPPORTED_SCHEMA_VERSION = 13;

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
    error_code TEXT,
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
  CREATE TABLE IF NOT EXISTS upload_sessions (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    tos_upload_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    media_kind TEXT NOT NULL CHECK (media_kind IN ('image', 'video', 'audio')),
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size > 0),
    part_size INTEGER NOT NULL CHECK (part_size > 0),
    part_count INTEGER NOT NULL CHECK (part_count > 0),
    state TEXT NOT NULL CHECK (state IN ('uploading', 'finalizing', 'completed', 'failed', 'cancelled')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS upload_sessions_owner_state_idx ON upload_sessions(owner_id, state, updated_at DESC);
  CREATE INDEX IF NOT EXISTS upload_sessions_expiry_idx ON upload_sessions(expires_at);
  CREATE TABLE IF NOT EXISTS user_assets (
    id TEXT PRIMARY KEY,
    provider_asset_id TEXT,
    owner_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    upload_id TEXT,
    name TEXT NOT NULL,
    asset_type TEXT NOT NULL CHECK (asset_type IN ('Image', 'Video', 'Audio')),
    status TEXT NOT NULL CHECK (status IN ('Active', 'Processing', 'Failed')),
    category TEXT NOT NULL DEFAULT 'material' CHECK (category IN ('character', 'scene', 'prop', 'material')),
    url TEXT,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS user_assets_owner_updated_idx ON user_assets(owner_id, updated_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS user_assets_provider_id_idx ON user_assets(provider_asset_id) WHERE provider_asset_id IS NOT NULL AND deleted_at IS NULL;
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

const tableExists = (database: Database.Database, name: string) => Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

export const schemaVersion = (database: Database.Database) => {
  if (!tableExists(database, "schema_migrations")) return 0;
  return Number((database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number }).version);
};

export const assertSchemaVersionRange = (
  database: Database.Database,
  minimumVersion: number,
  maximumVersion: number,
  releaseName = "application",
) => {
  if (!Number.isSafeInteger(minimumVersion) || !Number.isSafeInteger(maximumVersion) || minimumVersion < 0 || maximumVersion < minimumVersion) {
    throw new Error(`Invalid schema support range ${minimumVersion}-${maximumVersion} for ${releaseName}`);
  }
  const version = schemaVersion(database);
  if (version < minimumVersion || version > maximumVersion) {
    throw new Error(`Database schema version ${version} is not supported by ${releaseName}; expected ${minimumVersion}-${maximumVersion}. Run npm run db:migrate.`);
  }
  return version;
};

export const assertSchemaVersion = (database: Database.Database) => assertSchemaVersionRange(
  database,
  CURRENT_SCHEMA_VERSION,
  MAX_SUPPORTED_SCHEMA_VERSION,
  "this release",
);

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

const addAssetCategories = (database: Database.Database) => {
  const columns = new Set((database.prepare("PRAGMA table_info(user_assets)").all() as { name: string }[]).map((column) => column.name));
  if (!columns.has("category")) database.exec("ALTER TABLE user_assets ADD COLUMN category TEXT NOT NULL DEFAULT 'material' CHECK (category IN ('character', 'scene', 'prop', 'material'))");
  database.exec("CREATE INDEX IF NOT EXISTS user_assets_owner_category_updated_idx ON user_assets(owner_id, category, updated_at DESC)");
};

const separateProviderAssetIdentity = (database: Database.Database) => {
  const columns = new Set((database.prepare("PRAGMA table_info(user_assets)").all() as { name: string }[]).map((column) => column.name));
  if (!columns.has("provider_asset_id")) database.exec("ALTER TABLE user_assets ADD COLUMN provider_asset_id TEXT");
  if (!columns.has("last_error")) database.exec("ALTER TABLE user_assets ADD COLUMN last_error TEXT");
  database.exec("UPDATE user_assets SET provider_asset_id = id WHERE provider_asset_id IS NULL AND id LIKE 'asset-%' AND id NOT LIKE 'asset-local-%'");
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS user_assets_provider_id_idx ON user_assets(provider_asset_id) WHERE provider_asset_id IS NOT NULL AND deleted_at IS NULL");
};

const addCanvasV2Tables = (database: Database.Database) => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS canvas_project_assets (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      canvas_id TEXT NOT NULL,
      canvas_asset_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
      source_type TEXT NOT NULL CHECK (source_type IN ('canvas_asset', 'generation', 'generated', 'user_asset', 'montage')),
      source_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      width INTEGER,
      height INTEGER,
      duration_ms INTEGER,
      status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('copying', 'ready', 'failed')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (canvas_id) REFERENCES canvas_projects(id),
      FOREIGN KEY (canvas_asset_id) REFERENCES canvas_assets(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS canvas_project_assets_source_idx
      ON canvas_project_assets(canvas_id, source_type, source_id) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS canvas_project_assets_canvas_created_idx
      ON canvas_project_assets(canvas_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS canvas_jobs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      canvas_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('text', 'image', 'video', 'character_tool')),
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
      payload_json TEXT NOT NULL DEFAULT '{}',
      result_asset_id TEXT,
      provider_task_id TEXT,
      partial_text TEXT NOT NULL DEFAULT '',
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      cancelled_at INTEGER,
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (canvas_id) REFERENCES canvas_projects(id),
      FOREIGN KEY (result_asset_id) REFERENCES canvas_project_assets(id)
    );
    CREATE INDEX IF NOT EXISTS canvas_jobs_canvas_updated_idx ON canvas_jobs(canvas_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS canvas_jobs_status_updated_idx ON canvas_jobs(status, updated_at);
    CREATE INDEX IF NOT EXISTS canvas_jobs_owner_kind_status_idx ON canvas_jobs(owner_id, kind, status);

    CREATE TABLE IF NOT EXISTS canvas_montages (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      canvas_id TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      timeline_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (canvas_id) REFERENCES canvas_projects(id)
    );
    CREATE INDEX IF NOT EXISTS canvas_montages_canvas_updated_idx ON canvas_montages(canvas_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS canvas_exports (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      canvas_id TEXT NOT NULL,
      montage_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('uploading', 'verifying', 'ready', 'failed', 'cancelled')),
      object_key TEXT NOT NULL UNIQUE,
      tos_upload_id TEXT,
      parts_json TEXT NOT NULL DEFAULT '[]',
      result_asset_id TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (canvas_id) REFERENCES canvas_projects(id),
      FOREIGN KEY (montage_id) REFERENCES canvas_montages(id),
      FOREIGN KEY (result_asset_id) REFERENCES canvas_project_assets(id)
    );
    CREATE INDEX IF NOT EXISTS canvas_exports_status_updated_idx ON canvas_exports(status, updated_at);
  `);
};

const addImageGenerationHistory = (database: Database.Database) => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS image_generation_tasks (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      model TEXT NOT NULL,
      model_name TEXT NOT NULL,
      ratio TEXT NOT NULL,
      resolution TEXT NOT NULL,
      prompt TEXT NOT NULL,
      references_json TEXT NOT NULL DEFAULT '[]',
      requested_count INTEGER NOT NULL CHECK (requested_count BETWEEN 1 AND 4),
      status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
      items_json TEXT NOT NULL DEFAULT '[]',
      failures_json TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS image_generation_tasks_owner_created_idx
      ON image_generation_tasks(owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS image_generation_tasks_status_updated_idx
      ON image_generation_tasks(status, updated_at);
  `);
  if (tableExists(database, "media_objects")) database.exec(`
    INSERT OR IGNORE INTO image_generation_tasks
      (id, owner_id, model, model_name, ratio, resolution, prompt, requested_count, status, items_json, failures_json, created_at, updated_at)
    SELECT
      'legacy-' || id, owner_id, 'legacy', '历史生成', '原始比例', '', '', 1, 'succeeded',
      json_array(json_object('mediaId', id)), '[]', created_at, updated_at
    FROM media_objects
    WHERE kind = 'generated' AND status = 'ready' AND deleted_at IS NULL;
  `);
};

const addCreationSessions = (database: Database.Database) => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS creation_sessions (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS creation_sessions_owner_updated_idx
      ON creation_sessions(owner_id, updated_at DESC);
  `);

  // Before sessions existed, every sidebar item behaved like an independent
  // conversation. Preserve that mental model instead of merging unrelated work.
  // The guards also keep adoption of sparse legacy schemas non-destructive.
  const canBackfill = tableExists(database, "users");
  if (tableExists(database, "generation_tasks")) {
    const taskColumns = new Set((database.prepare("PRAGMA table_info(generation_tasks)").all() as { name: string }[]).map((column) => column.name));
    if (!taskColumns.has("session_id")) database.exec("ALTER TABLE generation_tasks ADD COLUMN session_id TEXT");
    if (canBackfill) database.exec(`
      INSERT OR IGNORE INTO creation_sessions (id, owner_id, title, created_at, updated_at)
      SELECT 'legacy-video-' || id, owner_id,
        CASE WHEN trim(prompt) = '' THEN '历史视频创作' ELSE substr(trim(prompt), 1, 40) END,
        created_at, updated_at
      FROM generation_tasks
      WHERE owner_id IS NOT NULL AND session_id IS NULL;
      UPDATE generation_tasks SET session_id = 'legacy-video-' || id
      WHERE owner_id IS NOT NULL AND session_id IS NULL;
    `);
    database.exec("CREATE INDEX IF NOT EXISTS generation_tasks_session_created_idx ON generation_tasks(session_id, created_at DESC)");
  }
  if (tableExists(database, "image_generation_tasks")) {
    const imageColumns = new Set((database.prepare("PRAGMA table_info(image_generation_tasks)").all() as { name: string }[]).map((column) => column.name));
    if (!imageColumns.has("session_id")) database.exec("ALTER TABLE image_generation_tasks ADD COLUMN session_id TEXT");
    if (canBackfill) database.exec(`
      INSERT OR IGNORE INTO creation_sessions (id, owner_id, title, created_at, updated_at)
      SELECT 'legacy-image-' || id, owner_id,
        CASE WHEN trim(prompt) = '' THEN '历史图片创作' ELSE substr(trim(prompt), 1, 40) END,
        created_at, updated_at
      FROM image_generation_tasks
      WHERE session_id IS NULL;
      UPDATE image_generation_tasks SET session_id = 'legacy-image-' || id
      WHERE session_id IS NULL;
    `);
    database.exec("CREATE INDEX IF NOT EXISTS image_generation_tasks_session_created_idx ON image_generation_tasks(session_id, created_at DESC)");
  }
};

const addAsyncJobOutbox = (database: Database.Database) => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS async_job_outbox (
      queue_name TEXT NOT NULL CHECK (queue_name IN ('generation', 'image-generation', 'canvas-jobs')),
      job_id TEXT NOT NULL,
      job_name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatched', 'complete')),
      publish_attempts INTEGER NOT NULL DEFAULT 0,
      available_at INTEGER NOT NULL,
      dispatched_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (queue_name, job_id)
    );
    CREATE INDEX IF NOT EXISTS async_job_outbox_dispatch_idx
      ON async_job_outbox(status, available_at, updated_at);
  `);
};

const addUploadSessions = (database: Database.Database) => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS upload_sessions (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      tos_upload_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      media_kind TEXT NOT NULL CHECK (media_kind IN ('image', 'video', 'audio')),
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL CHECK (size > 0),
      part_size INTEGER NOT NULL CHECK (part_size > 0),
      part_count INTEGER NOT NULL CHECK (part_count > 0),
      state TEXT NOT NULL CHECK (state IN ('uploading', 'finalizing', 'completed', 'failed', 'cancelled')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS upload_sessions_owner_state_idx ON upload_sessions(owner_id, state, updated_at DESC);
    CREATE INDEX IF NOT EXISTS upload_sessions_expiry_idx ON upload_sessions(expires_at);
  `);
};

const addImageGenerationReferences = (database: Database.Database) => {
  if (!tableExists(database, "image_generation_tasks")) return;
  const columns = new Set((database.prepare("PRAGMA table_info(image_generation_tasks)").all() as { name: string }[]).map((column) => column.name));
  if (!columns.has("references_json")) database.exec("ALTER TABLE image_generation_tasks ADD COLUMN references_json TEXT NOT NULL DEFAULT '[]'");
};

const addCreationSnapshots = (database: Database.Database) => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS creation_snapshots (
      source_type TEXT NOT NULL CHECK (source_type IN ('video', 'image')),
      source_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      session_id TEXT,
      editor_prompt TEXT NOT NULL,
      provider_prompt TEXT NOT NULL,
      parameters_json TEXT NOT NULL,
      binding_version INTEGER NOT NULL DEFAULT 1,
      recovery_quality TEXT NOT NULL CHECK (recovery_quality IN ('exact', 'partial', 'unknown')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (source_type, source_id),
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS creation_snapshots_owner_created_idx
      ON creation_snapshots(owner_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS creation_snapshot_references (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK (source_type IN ('video', 'image')),
      source_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      binding_id TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'audio')),
      role TEXT NOT NULL CHECK (role IN ('reference_image', 'reference_video', 'reference_audio', 'first_frame', 'last_frame')),
      display_name TEXT NOT NULL,
      original_upload_id TEXT,
      original_asset_id TEXT,
      provider_asset_id TEXT,
      source_object_key TEXT,
      object_key TEXT,
      content_type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      etag TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('promoting', 'ready', 'unavailable', 'delete_pending', 'deleted')),
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      UNIQUE (source_type, source_id, binding_id),
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (source_type, source_id) REFERENCES creation_snapshots(source_type, source_id)
    );
    CREATE INDEX IF NOT EXISTS creation_snapshot_references_source_idx
      ON creation_snapshot_references(source_type, source_id, position);
    CREATE INDEX IF NOT EXISTS creation_snapshot_references_status_idx
      ON creation_snapshot_references(status, updated_at);

    CREATE TABLE IF NOT EXISTS reedit_session_links (
      owner_id TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('video', 'image')),
      source_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, source_type, source_id),
      UNIQUE (session_id),
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (session_id) REFERENCES creation_sessions(id)
    );
  `);
};

const addArchiveCheckpoints = (database: Database.Database) => {
  const hasGenerationTasks = tableExists(database, "generation_tasks");
  const taskColumns = new Set((database.prepare("PRAGMA table_info(generation_tasks)").all() as { name: string }[]).map((column) => column.name));
  if (hasGenerationTasks && !taskColumns.has("error_code")) database.exec("ALTER TABLE generation_tasks ADD COLUMN error_code TEXT");
  if (!hasGenerationTasks) return;
  database.exec(`
    CREATE TABLE IF NOT EXISTS media_archive_checkpoints (
      task_id TEXT PRIMARY KEY,
      strategy TEXT NOT NULL CHECK (strategy IN ('url_fetch', 'stream_multipart')),
      fetch_task_id TEXT,
      fetch_started_at INTEGER,
      tos_upload_id TEXT,
      object_key TEXT NOT NULL,
      source_size INTEGER,
      content_type TEXT,
      part_size INTEGER NOT NULL DEFAULT 5242880,
      parts_json TEXT NOT NULL DEFAULT '[]',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES generation_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS media_archive_checkpoints_expiry_idx ON media_archive_checkpoints(expires_at);
  `);
};

const addAtlasProjectTables = (database: Database.Database) => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS atlas_projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
      latest_version_id TEXT,
      lease_token_hash TEXT,
      lease_device_id TEXT,
      lease_expires_at INTEGER,
      lease_generation INTEGER NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (latest_version_id) REFERENCES atlas_project_versions(id)
    );
    CREATE INDEX IF NOT EXISTS atlas_projects_owner_updated_idx
      ON atlas_projects(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS atlas_projects_lease_expiry_idx
      ON atlas_projects(lease_expires_at) WHERE lease_expires_at IS NOT NULL;

    CREATE TABLE IF NOT EXISTS atlas_project_versions (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      object_key TEXT NOT NULL UNIQUE,
      digest TEXT NOT NULL,
      size INTEGER NOT NULL CHECK (size > 0),
      lease_generation INTEGER NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
      status TEXT NOT NULL CHECK (status IN ('uploading', 'ready', 'failed', 'delete_pending', 'deleted')),
      error TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      UNIQUE (project_id, revision),
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (project_id) REFERENCES atlas_projects(id)
    );
    CREATE INDEX IF NOT EXISTS atlas_project_versions_project_created_idx
      ON atlas_project_versions(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS atlas_project_assets (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('local_upload', 'atlas_export', 'user_asset', 'generation', 'generated', 'canvas_project')),
      source_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
      object_key TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0),
      etag TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('uploading', 'copying', 'ready', 'failed', 'delete_pending', 'deleted')),
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (project_id) REFERENCES atlas_projects(id)
    );
    CREATE INDEX IF NOT EXISTS atlas_project_assets_project_created_idx
      ON atlas_project_assets(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS atlas_project_assets_status_updated_idx
      ON atlas_project_assets(status, updated_at);
    CREATE UNIQUE INDEX IF NOT EXISTS atlas_project_assets_source_idx
      ON atlas_project_assets(project_id, source_type, source_id)
      WHERE source_id IS NOT NULL AND deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS atlas_global_asset_outbox (
      asset_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      object_key TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL CHECK (size > 0),
      etag TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (asset_id) REFERENCES atlas_project_assets(id),
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (project_id) REFERENCES atlas_projects(id)
    );
    CREATE INDEX IF NOT EXISTS atlas_global_asset_outbox_pending_idx
      ON atlas_global_asset_outbox(status, updated_at)
      WHERE status = 'pending';

    CREATE TABLE IF NOT EXISTS atlas_transfers (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      asset_id TEXT,
      version_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('asset_upload', 'checkpoint', 'export', 'import')),
      object_key TEXT NOT NULL UNIQUE,
      tos_upload_id TEXT,
      file_name TEXT NOT NULL,
      media_kind TEXT NOT NULL CHECK (media_kind IN ('image', 'video', 'audio', 'project')),
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL CHECK (size >= 0),
      part_size INTEGER NOT NULL CHECK (part_size > 0),
      part_count INTEGER NOT NULL CHECK (part_count >= 0),
      parts_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK (status IN ('initiated', 'uploading', 'verifying', 'completed', 'failed', 'cancelled')),
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (project_id) REFERENCES atlas_projects(id),
      FOREIGN KEY (asset_id) REFERENCES atlas_project_assets(id),
      FOREIGN KEY (version_id) REFERENCES atlas_project_versions(id)
    );
    CREATE INDEX IF NOT EXISTS atlas_transfers_owner_status_idx
      ON atlas_transfers(owner_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS atlas_transfers_expiry_idx ON atlas_transfers(expires_at);

    CREATE TABLE IF NOT EXISTS atlas_agent_runs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'planning', 'awaiting_confirmation', 'ready', 'running', 'succeeded', 'failed', 'cancelled')),
      instruction TEXT NOT NULL,
      base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
      catalog_version TEXT NOT NULL,
      catalog_digest TEXT NOT NULL,
      plan_json TEXT,
      error_code TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      UNIQUE (owner_id, project_id, idempotency_key),
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (project_id) REFERENCES atlas_projects(id)
    );
    CREATE INDEX IF NOT EXISTS atlas_agent_runs_project_updated_idx
      ON atlas_agent_runs(project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS atlas_agent_runs_status_updated_idx
      ON atlas_agent_runs(status, updated_at);

    CREATE TABLE IF NOT EXISTS atlas_agent_events (
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence > 0),
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (run_id, sequence),
      UNIQUE (run_id, sequence),
      FOREIGN KEY (run_id) REFERENCES atlas_agent_runs(id)
    );

    CREATE TABLE IF NOT EXISTS atlas_agent_operations (
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence > 0),
      plan_digest TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
      risk TEXT NOT NULL CHECK (risk IN ('low', 'medium', 'destructive', 'external')),
      requires_confirmation INTEGER NOT NULL CHECK (requires_confirmation IN (0, 1)),
      result_json TEXT NOT NULL,
      before_revision INTEGER NOT NULL CHECK (before_revision >= 0),
      after_revision INTEGER NOT NULL CHECK (after_revision >= before_revision),
      history_node_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (run_id, sequence),
      UNIQUE (run_id, sequence),
      FOREIGN KEY (run_id) REFERENCES atlas_agent_runs(id)
    );
  `);
};

const addAtlasGenerationBridge = (database: Database.Database) => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS atlas_project_generation_sessions (
      owner_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, project_id),
      UNIQUE (session_id),
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (project_id) REFERENCES atlas_projects(id),
      FOREIGN KEY (session_id) REFERENCES creation_sessions(id)
    );

    CREATE TABLE IF NOT EXISTS generation_destinations (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('image', 'video')),
      source_id TEXT NOT NULL,
      output_key TEXT NOT NULL,
      output_media_id TEXT,
      atlas_asset_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'copying', 'ready', 'failed', 'skipped')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      last_error_code TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      UNIQUE (owner_id, project_id, source_type, source_id, output_key),
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (project_id) REFERENCES atlas_projects(id),
      FOREIGN KEY (session_id) REFERENCES creation_sessions(id),
      FOREIGN KEY (atlas_asset_id) REFERENCES atlas_project_assets(id)
    );
    CREATE INDEX IF NOT EXISTS generation_destinations_project_updated_idx
      ON generation_destinations(project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS generation_destinations_pending_idx
      ON generation_destinations(status, updated_at)
      WHERE status IN ('pending', 'failed');
  `);
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
      if (version > MAX_SUPPORTED_SCHEMA_VERSION) throw new Error(`Database schema ${version} is newer than this release (${MAX_SUPPORTED_SCHEMA_VERSION})`);
      if (version < 1) {
        applyBaseline(database);
        database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(1, "baseline-current-schema", Date.now());
      }
      if (version < 2) {
        addAssetCategories(database);
        database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(2, "add-user-asset-categories", Date.now());
      }
      if (version < 3) {
        separateProviderAssetIdentity(database);
        database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(3, "separate-provider-asset-identity", Date.now());
      }
      if (version < 4) {
        addCanvasV2Tables(database);
        database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(4, "add-canvas-v2", Date.now());
      }
      if (version < 5) {
        addImageGenerationHistory(database);
        database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(5, "add-image-generation-history", Date.now());
      }
      if (version < 6) {
        addCreationSessions(database);
        database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(6, "add-creation-sessions", Date.now());
      }
      if (version < 7) {
        addAsyncJobOutbox(database);
        database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(7, "add-async-job-outbox", Date.now());
      }
      if (version < 8) {
        addUploadSessions(database);
        database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(8, "add-upload-sessions", Date.now());
      }
      if (version < 9) {
        addImageGenerationReferences(database);
        database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(9, "add-image-generation-references", Date.now());
      }
      if (version < 10) {
        addCreationSnapshots(database);
        database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(10, "add-creation-snapshots", Date.now());
      }
      if (version < 11) {
        addArchiveCheckpoints(database);
        database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(11, "add-media-archive-checkpoints", Date.now());
      }
      if (version < 12) {
        addAtlasProjectTables(database);
        database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(12, "add-atlas-projects", Date.now());
      }
      if (version < 13) {
        addAtlasGenerationBridge(database);
        database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(13, "add-atlas-generation-bridge", Date.now());
      }
      assertSchemaVersion(database);
    }).exclusive();
    return schemaVersion(database);
  } finally { database.close(); }
};
