import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { assertSchemaVersion } from "./migrations.js";

const CHECKPOINT_RESET_CLAIM_TTL_MS = 10 * 60_000;

export type AtlasProject = {
  id: string;
  ownerId: string;
  title: string;
  revision: number;
  latestVersionId?: string;
  leaseDeviceId?: string;
  leaseExpiresAt?: number;
  leaseGeneration: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type AtlasProjectVersion = {
  id: string;
  ownerId: string;
  projectId: string;
  revision: number;
  objectKey: string;
  digest: string;
  size: number;
  leaseGeneration: number;
  status: "uploading" | "ready" | "failed" | "delete_pending" | "deleted";
  error?: string;
  createdAt: number;
  completedAt?: number;
};

export type AtlasAssetSourceType = "local_upload" | "atlas_export" | "user_asset" | "generation" | "generated" | "canvas_project";
export type AtlasMediaKind = "image" | "video" | "audio";
export type AtlasProjectAsset = {
  id: string;
  ownerId: string;
  projectId: string;
  sourceType: AtlasAssetSourceType;
  sourceId?: string;
  kind: AtlasMediaKind;
  objectKey: string;
  fileName: string;
  contentType: string;
  size: number;
  etag: string;
  status: "uploading" | "copying" | "ready" | "failed" | "delete_pending" | "deleted";
  error?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type AtlasGlobalAssetRegistration = {
  assetId: string;
  ownerId: string;
  projectId: string;
  name: string;
  objectKey: string;
  contentType: string;
  size: number;
  etag: string;
  status: "pending" | "completed";
  attemptCount: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};

export type AtlasTransferPart = { partNumber: number; etag: string };
export type AtlasTransfer = {
  id: string;
  ownerId: string;
  projectId: string;
  assetId?: string;
  versionId?: string;
  kind: "asset_upload" | "checkpoint" | "export" | "import";
  objectKey: string;
  tosUploadId?: string;
  fileName: string;
  mediaKind: AtlasMediaKind | "project";
  contentType: string;
  size: number;
  partSize: number;
  partCount: number;
  parts: AtlasTransferPart[];
  status: "initiated" | "uploading" | "verifying" | "completed" | "failed" | "cancelled";
  error?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

type ProjectRow = {
  id: string; owner_id: string; title: string; revision: number; latest_version_id: string | null;
  lease_token_hash: string | null; lease_device_id: string | null; lease_expires_at: number | null;
  lease_generation: number;
  created_at: number; updated_at: number; deleted_at: number | null;
};
type VersionRow = {
  id: string; owner_id: string; project_id: string; revision: number; object_key: string; digest: string;
  size: number; lease_generation: number; status: AtlasProjectVersion["status"]; error: string | null; created_at: number; completed_at: number | null;
};
type AssetRow = {
  id: string; owner_id: string; project_id: string; source_type: AtlasAssetSourceType; source_id: string | null;
  kind: AtlasMediaKind; object_key: string; file_name: string; content_type: string; size: number; etag: string;
  status: AtlasProjectAsset["status"]; error: string | null; created_at: number; updated_at: number; deleted_at: number | null;
};
type GlobalAssetOutboxRow = {
  asset_id: string; owner_id: string; project_id: string; name: string; object_key: string;
  content_type: string; size: number; etag: string; status: AtlasGlobalAssetRegistration["status"];
  attempt_count: number; last_error: string | null; created_at: number; updated_at: number; completed_at: number | null;
};
type TransferRow = {
  id: string; owner_id: string; project_id: string; asset_id: string | null; version_id: string | null;
  kind: AtlasTransfer["kind"]; object_key: string; tos_upload_id: string | null; file_name: string;
  media_kind: AtlasTransfer["mediaKind"]; content_type: string; size: number; part_size: number; part_count: number;
  parts_json: string; status: AtlasTransfer["status"]; error: string | null; created_at: number; updated_at: number; expires_at: number;
};

const projectFromRow = (row?: ProjectRow): AtlasProject | null => row ? ({
  id: row.id, ownerId: row.owner_id, title: row.title, revision: row.revision,
  latestVersionId: row.latest_version_id ?? undefined, leaseDeviceId: row.lease_device_id ?? undefined,
  leaseExpiresAt: row.lease_expires_at ?? undefined, leaseGeneration: row.lease_generation,
  createdAt: row.created_at, updatedAt: row.updated_at,
  deletedAt: row.deleted_at ?? undefined,
}) : null;
const versionFromRow = (row?: VersionRow): AtlasProjectVersion | null => row ? ({
  id: row.id, ownerId: row.owner_id, projectId: row.project_id, revision: row.revision,
  objectKey: row.object_key, digest: row.digest, size: row.size, leaseGeneration: row.lease_generation, status: row.status,
  error: row.error ?? undefined, createdAt: row.created_at, completedAt: row.completed_at ?? undefined,
}) : null;
const assetFromRow = (row?: AssetRow): AtlasProjectAsset | null => row ? ({
  id: row.id, ownerId: row.owner_id, projectId: row.project_id, sourceType: row.source_type,
  sourceId: row.source_id ?? undefined, kind: row.kind, objectKey: row.object_key, fileName: row.file_name,
  contentType: row.content_type, size: row.size, etag: row.etag, status: row.status,
  error: row.error ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at,
  deletedAt: row.deleted_at ?? undefined,
}) : null;
const globalAssetRegistrationFromRow = (row?: GlobalAssetOutboxRow): AtlasGlobalAssetRegistration | null => row ? ({
  assetId: row.asset_id, ownerId: row.owner_id, projectId: row.project_id, name: row.name,
  objectKey: row.object_key, contentType: row.content_type, size: row.size, etag: row.etag,
  status: row.status, attemptCount: row.attempt_count, lastError: row.last_error ?? undefined,
  createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at ?? undefined,
}) : null;
const transferFromRow = (row?: TransferRow): AtlasTransfer | null => row ? ({
  id: row.id, ownerId: row.owner_id, projectId: row.project_id, assetId: row.asset_id ?? undefined,
  versionId: row.version_id ?? undefined, kind: row.kind, objectKey: row.object_key,
  tosUploadId: row.tos_upload_id ?? undefined, fileName: row.file_name, mediaKind: row.media_kind,
  contentType: row.content_type, size: row.size, partSize: row.part_size, partCount: row.part_count,
  parts: JSON.parse(row.parts_json) as AtlasTransferPart[], status: row.status, error: row.error ?? undefined,
  createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at,
}) : null;

export type AtlasWriteResult = { status: "ok"; project: AtlasProject } | { status: "conflict"; currentRevision: number } | { status: "missing" };
export type AtlasLeaseResult = { status: "ok"; project: AtlasProject } | { status: "locked"; deviceId?: string; expiresAt: number } | { status: "missing" };

export class AtlasStore {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("busy_timeout = 5000");
    try { assertSchemaVersion(this.database); }
    catch (error) { this.database.close(); throw error; }
  }

  createProject(input: { id: string; ownerId: string; title: string; now: number }) {
    this.database.prepare(`
      INSERT INTO atlas_projects (id, owner_id, title, revision, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `).run(input.id, input.ownerId, input.title, input.now, input.now);
    return this.readProject(input.id, input.ownerId)!;
  }

  readProject(id: string, ownerId: string) {
    return projectFromRow(this.database.prepare("SELECT * FROM atlas_projects WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").get(id, ownerId) as ProjectRow | undefined);
  }

  listProjects(ownerId: string, limit = 50, offset = 0) {
    return (this.database.prepare(`
      SELECT * FROM atlas_projects WHERE owner_id = ? AND deleted_at IS NULL
      ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?
    `).all(ownerId, limit, offset) as ProjectRow[]).map((row) => projectFromRow(row)!);
  }

  updateProject(id: string, ownerId: string, expectedRevision: number, title: string, now: number): AtlasWriteResult {
    const project = this.readProject(id, ownerId);
    if (!project) return { status: "missing" };
    if (project.revision !== expectedRevision) return { status: "conflict", currentRevision: project.revision };
    this.database.prepare("UPDATE atlas_projects SET title = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL")
      .run(title, now, id, ownerId);
    return { status: "ok", project: this.readProject(id, ownerId)! };
  }

  softDeleteProject(id: string, ownerId: string, now: number) {
    return this.database.transaction(() => {
      const project = this.readProject(id, ownerId);
      if (!project) return null;
      const objects = (this.database.prepare(`
        SELECT object_key AS objectKey FROM atlas_project_assets
        WHERE project_id = ? AND owner_id = ? AND deleted_at IS NULL
          AND NOT (source_type = 'atlas_export' AND status = 'ready')
        UNION SELECT object_key AS objectKey FROM atlas_project_versions
        WHERE project_id = ? AND owner_id = ? AND status != 'deleted'
      `).all(id, ownerId, id, ownerId) as { objectKey: string }[]).map((row) => row.objectKey);
      const uploads = (this.database.prepare(`
        SELECT id, owner_id AS ownerId, object_key AS objectKey, tos_upload_id AS uploadId FROM atlas_transfers
        WHERE project_id = ? AND owner_id = ? AND status IN ('initiated', 'uploading', 'verifying') AND tos_upload_id IS NOT NULL
      `).all(id, ownerId) as { id: string; ownerId: string; objectKey: string; uploadId: string }[]);
      this.database.prepare("UPDATE atlas_projects SET deleted_at = ?, updated_at = ?, lease_token_hash = NULL, lease_device_id = NULL, lease_expires_at = NULL WHERE id = ? AND owner_id = ?")
        .run(now, now, id, ownerId);
      this.database.prepare(`
        UPDATE atlas_project_assets
        SET status = CASE WHEN source_type = 'atlas_export' AND status = 'ready' THEN 'deleted' ELSE 'delete_pending' END,
            deleted_at = ?, updated_at = ?
        WHERE project_id = ? AND owner_id = ? AND deleted_at IS NULL
      `)
        .run(now, now, id, ownerId);
      this.database.prepare("UPDATE atlas_project_versions SET status = 'delete_pending', error = NULL WHERE project_id = ? AND owner_id = ? AND status != 'deleted'")
        .run(id, ownerId);
      this.database.prepare(`
        UPDATE atlas_transfers
        SET status = CASE WHEN tos_upload_id IS NULL THEN 'cancelled' ELSE 'failed' END,
            error = CASE WHEN tos_upload_id IS NULL THEN NULL ELSE 'ABORT_PENDING' END,
            updated_at = ?
        WHERE project_id = ? AND owner_id = ? AND status IN ('initiated', 'uploading', 'verifying')
      `).run(now, id, ownerId);
      return { objects, uploads };
    })();
  }

  acquireLease(id: string, ownerId: string, deviceId: string, tokenHash: string, now: number, ttlMs: number, takeover: boolean): AtlasLeaseResult {
    return this.database.transaction(() => {
      const row = this.database.prepare("SELECT * FROM atlas_projects WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").get(id, ownerId) as ProjectRow | undefined;
      if (!row) return { status: "missing" } as const;
      // deviceId is diagnostic only. Browser storage can be copied into a
      // duplicated tab, so treating an equal deviceId as proof of ownership
      // would let the second tab silently rotate the first tab's lease.
      if (!takeover && row.lease_token_hash && (row.lease_expires_at ?? 0) > now) {
        return { status: "locked", deviceId: row.lease_device_id ?? undefined, expiresAt: row.lease_expires_at! } as const;
      }
      this.database.prepare(`
        UPDATE atlas_projects SET lease_token_hash = ?, lease_device_id = ?, lease_expires_at = ?,
          lease_generation = lease_generation + 1, updated_at = ?
        WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
      `).run(tokenHash, deviceId, now + ttlMs, now, id, ownerId);
      return { status: "ok", project: this.readProject(id, ownerId)! } as const;
    })();
  }

  renewLease(id: string, ownerId: string, tokenHash: string, now: number, ttlMs: number) {
    const result = this.database.prepare(`
      UPDATE atlas_projects SET lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND lease_token_hash = ? AND lease_expires_at > ?
    `).run(now + ttlMs, now, id, ownerId, tokenHash, now);
    return result.changes > 0 ? this.readProject(id, ownerId) : null;
  }

  releaseLease(id: string, ownerId: string, tokenHash: string, now: number) {
    return this.database.prepare(`
      UPDATE atlas_projects SET lease_token_hash = NULL, lease_device_id = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND lease_token_hash = ?
    `).run(now, id, ownerId, tokenHash).changes > 0;
  }

  hasLease(id: string, ownerId: string, tokenHash: string, now: number) {
    return Boolean(this.database.prepare(`
      SELECT 1 FROM atlas_projects
      WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND lease_token_hash = ? AND lease_expires_at > ?
    `).get(id, ownerId, tokenHash, now));
  }

  reserveCheckpoint(input: {
    id: string; transferId: string; ownerId: string; projectId: string; expectedRevision: number;
    objectKey: string; digest: string; size: number; partSize: number; partCount: number; now: number; expiresAt: number;
    leaseTokenHash?: string;
  }) {
    return this.database.transaction(() => {
      const project = this.readProject(input.projectId, input.ownerId);
      if (!project) return { status: "missing" } as const;
      if (input.leaseTokenHash && !this.database.prepare(`
        SELECT 1 FROM atlas_projects
        WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND lease_token_hash = ? AND lease_expires_at > ?
      `).get(input.projectId, input.ownerId, input.leaseTokenHash, input.now)) return { status: "lease_lost" } as const;
      const existing = versionFromRow(this.database.prepare("SELECT * FROM atlas_project_versions WHERE project_id = ? AND revision = ?")
        .get(input.projectId, input.expectedRevision + 1) as VersionRow | undefined);
      if (existing) {
        const transfer = transferFromRow(this.database.prepare("SELECT * FROM atlas_transfers WHERE version_id = ?").get(existing.id) as TransferRow | undefined);
        const terminal = existing.status === "failed" && Boolean(transfer && ["failed", "cancelled"].includes(transfer.status));
        if (terminal && transfer?.error?.startsWith("RESETTING:")
          && transfer.updatedAt + CHECKPOINT_RESET_CLAIM_TTL_MS > input.now) {
          return { status: "resetting", version: existing, transfer } as const;
        }
        if (terminal && project.revision === input.expectedRevision) {
          return { status: "recoverable", version: existing, transfer: transfer! } as const;
        }
        if (existing.ownerId !== input.ownerId || existing.digest !== input.digest || existing.size !== input.size) {
          return { status: "conflict", currentRevision: project.revision } as const;
        }
        return { status: "existing", version: existing, transfer } as const;
      }
      if (project.revision !== input.expectedRevision) return { status: "conflict", currentRevision: project.revision } as const;
      const revision = input.expectedRevision + 1;
      this.database.prepare(`
        INSERT INTO atlas_project_versions
          (id, owner_id, project_id, revision, object_key, digest, size, lease_generation, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?)
      `).run(input.id, input.ownerId, input.projectId, revision, input.objectKey, input.digest, input.size, project.leaseGeneration, input.now);
      this.database.prepare(`
        INSERT INTO atlas_transfers
          (id, owner_id, project_id, version_id, kind, object_key, file_name, media_kind, content_type,
           size, part_size, part_count, status, created_at, updated_at, expires_at)
        VALUES (?, ?, ?, ?, 'checkpoint', ?, ?, 'project', 'application/gzip', ?, ?, ?, 'initiated', ?, ?, ?)
      `).run(input.transferId, input.ownerId, input.projectId, input.id, input.objectKey, `${revision}.json.gz`, input.size,
        input.partSize, input.partCount, input.now, input.now, input.expiresAt);
      return {
        status: "created", version: this.readVersion(input.id, input.ownerId)!,
        transfer: this.readTransfer(input.transferId, input.ownerId)!,
      } as const;
    })();
  }

  claimFailedCheckpointReset(input: {
    versionId: string; transferId: string; ownerId: string; projectId: string; expectedRevision: number;
    now: number; leaseTokenHash: string; claimToken: string;
  }) {
    return this.database.transaction(() => {
      const project = this.readProject(input.projectId, input.ownerId);
      if (!project) return { status: "missing" } as const;
      if (project.revision !== input.expectedRevision) return { status: "conflict", currentRevision: project.revision } as const;
      if (!this.hasLease(input.projectId, input.ownerId, input.leaseTokenHash, input.now)) return { status: "lease_lost" } as const;
      const version = this.readVersion(input.versionId, input.ownerId);
      const transfer = this.readTransfer(input.transferId, input.ownerId);
      if (!version || !transfer || version.projectId !== input.projectId || transfer.versionId !== version.id
        || version.revision !== input.expectedRevision + 1 || version.status !== "failed"
        || !["failed", "cancelled"].includes(transfer.status)
        || (transfer.error?.startsWith("RESETTING:")
          && transfer.updatedAt + CHECKPOINT_RESET_CLAIM_TTL_MS > input.now)) return { status: "state_changed" } as const;
      const marker = `RESETTING:${input.claimToken}`;
      const claimed = this.database.prepare(`
        UPDATE atlas_transfers SET status = 'failed', error = ?, updated_at = ?
        WHERE id = ? AND owner_id = ? AND status IN ('failed', 'cancelled')
          AND (error IS NULL OR error NOT LIKE 'RESETTING:%' OR updated_at <= ?)
      `).run(marker, input.now, transfer.id, input.ownerId, input.now - CHECKPOINT_RESET_CLAIM_TTL_MS).changes;
      if (!claimed) return { status: "state_changed" } as const;
      this.database.prepare("UPDATE atlas_project_versions SET error = ? WHERE id = ? AND owner_id = ? AND status = 'failed'")
        .run(marker, version.id, input.ownerId);
      return {
        status: "ok", version: this.readVersion(version.id, input.ownerId)!, transfer: this.readTransfer(transfer.id, input.ownerId)!,
        previousTransfer: transfer,
      } as const;
    })();
  }

  finishFailedCheckpointReset(input: {
    versionId: string; transferId: string; ownerId: string; projectId: string; expectedRevision: number;
    digest: string; size: number; partSize: number; partCount: number; now: number; expiresAt: number;
    leaseTokenHash: string; claimToken: string;
  }) {
    return this.database.transaction(() => {
      const project = this.readProject(input.projectId, input.ownerId);
      if (!project) return { status: "missing" } as const;
      if (project.revision !== input.expectedRevision) return { status: "conflict", currentRevision: project.revision } as const;
      if (!this.hasLease(input.projectId, input.ownerId, input.leaseTokenHash, input.now)) return { status: "lease_lost" } as const;
      const marker = `RESETTING:${input.claimToken}`;
      const transfer = this.readTransfer(input.transferId, input.ownerId);
      const version = this.readVersion(input.versionId, input.ownerId);
      if (!transfer || !version || transfer.error !== marker || version.error !== marker || transfer.status !== "failed" || version.status !== "failed") {
        return { status: "state_changed" } as const;
      }
      this.database.prepare(`
        UPDATE atlas_project_versions
        SET digest = ?, size = ?, lease_generation = ?, status = 'uploading', error = NULL, created_at = ?, completed_at = NULL
        WHERE id = ? AND owner_id = ?
      `).run(input.digest, input.size, project.leaseGeneration, input.now, version.id, input.ownerId);
      this.database.prepare(`
        UPDATE atlas_transfers
        SET tos_upload_id = NULL, size = ?, part_size = ?, part_count = ?, parts_json = '[]',
            status = 'initiated', error = NULL, updated_at = ?, expires_at = ?
        WHERE id = ? AND owner_id = ?
      `).run(input.size, input.partSize, input.partCount, input.now, input.expiresAt, transfer.id, input.ownerId);
      return { status: "ok", version: this.readVersion(version.id, input.ownerId)!, transfer: this.readTransfer(transfer.id, input.ownerId)! } as const;
    })();
  }

  refreshFailedCheckpointResetClaim(transferId: string, ownerId: string, claimToken: string, now: number) {
    return this.database.prepare(`
      UPDATE atlas_transfers SET updated_at = ?
      WHERE id = ? AND owner_id = ? AND status = 'failed' AND error = ?
    `).run(now, transferId, ownerId, `RESETTING:${claimToken}`).changes > 0;
  }

  releaseFailedCheckpointReset(versionId: string, transferId: string, ownerId: string, claimToken: string, error: string, now: number) {
    return this.database.transaction(() => {
      const marker = `RESETTING:${claimToken}`;
      const changed = this.database.prepare(`
        UPDATE atlas_transfers SET error = ?, updated_at = ?
        WHERE id = ? AND owner_id = ? AND status = 'failed' AND error = ?
      `).run(error.slice(0, 1000), now, transferId, ownerId, marker).changes;
      if (!changed) return false;
      this.database.prepare(`
        UPDATE atlas_project_versions SET error = ?
        WHERE id = ? AND owner_id = ? AND status = 'failed' AND error = ?
      `).run(error.slice(0, 1000), versionId, ownerId, marker);
      return true;
    })();
  }

  readVersion(id: string, ownerId: string) {
    return versionFromRow(this.database.prepare("SELECT * FROM atlas_project_versions WHERE id = ? AND owner_id = ?").get(id, ownerId) as VersionRow | undefined);
  }

  readLatestVersion(projectId: string, ownerId: string) {
    return versionFromRow(this.database.prepare(`
      SELECT v.* FROM atlas_project_versions v
      JOIN atlas_projects p ON p.latest_version_id = v.id
      WHERE p.id = ? AND p.owner_id = ? AND p.deleted_at IS NULL AND v.status = 'ready'
    `).get(projectId, ownerId) as VersionRow | undefined);
  }

  activateTransfer(id: string, ownerId: string, tosUploadId: string, now: number) {
    this.database.prepare(`
      UPDATE atlas_transfers SET tos_upload_id = ?, status = 'uploading', error = NULL, updated_at = ?
      WHERE id = ? AND owner_id = ? AND status = 'initiated'
    `).run(tosUploadId, now, id, ownerId);
    return this.readTransfer(id, ownerId);
  }

  claimTransferUploadId(id: string, ownerId: string, tosUploadId: string, now: number) {
    return this.database.transaction(() => {
      const changed = this.database.prepare(`
        UPDATE atlas_transfers SET tos_upload_id = ?, status = 'uploading', error = NULL, updated_at = ?
        WHERE id = ? AND owner_id = ? AND status = 'initiated' AND tos_upload_id IS NULL
      `).run(tosUploadId, now, id, ownerId).changes;
      const transfer = this.readTransfer(id, ownerId);
      if (!transfer) return { status: "missing" } as const;
      return changed > 0
        ? { status: "won", transfer } as const
        : { status: "existing", transfer } as const;
    })();
  }

  readTransfer(id: string, ownerId: string) {
    return transferFromRow(this.database.prepare("SELECT * FROM atlas_transfers WHERE id = ? AND owner_id = ?").get(id, ownerId) as TransferRow | undefined);
  }

  readTransferForVersion(versionId: string, ownerId: string) {
    return transferFromRow(this.database.prepare("SELECT * FROM atlas_transfers WHERE version_id = ? AND owner_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(versionId, ownerId) as TransferRow | undefined);
  }

  markTransferVerifying(id: string, ownerId: string, parts: AtlasTransferPart[], now: number) {
    return this.database.prepare(`
      UPDATE atlas_transfers SET parts_json = ?, status = 'verifying', error = NULL, updated_at = ?
      WHERE id = ? AND owner_id = ? AND status IN ('uploading', 'verifying')
    `).run(JSON.stringify(parts), now, id, ownerId).changes > 0;
  }

  recordTransferParts(id: string, ownerId: string, parts: AtlasTransferPart[], now: number) {
    this.database.prepare(`
      UPDATE atlas_transfers SET parts_json = ?, updated_at = ?
      WHERE id = ? AND owner_id = ? AND status IN ('uploading', 'verifying')
    `).run(JSON.stringify(parts), now, id, ownerId);
    return this.readTransfer(id, ownerId);
  }

  finalizeStreamingTransfer(id: string, ownerId: string, totalSize: number, partCount: number, now: number) {
    return this.database.transaction(() => {
      const changed = this.database.prepare(`
        UPDATE atlas_transfers SET size = ?, part_count = ?, updated_at = ?
        WHERE id = ? AND owner_id = ? AND kind = 'export' AND size = 0 AND part_count = 0
          AND status IN ('uploading', 'verifying')
      `).run(totalSize, partCount, now, id, ownerId).changes;
      const transfer = this.readTransfer(id, ownerId);
      if (!transfer || (!changed && (transfer.size !== totalSize || transfer.partCount !== partCount))) return null;
      if (transfer.assetId) this.database.prepare(`
        UPDATE atlas_project_assets SET size = ?, updated_at = ?
        WHERE id = ? AND owner_id = ? AND status = 'uploading'
      `).run(totalSize, now, transfer.assetId, ownerId);
      return this.readTransfer(id, ownerId);
    })();
  }

  recordTransferError(id: string, ownerId: string, error: string, now: number, terminal = false) {
    this.database.prepare(`
      UPDATE atlas_transfers SET status = CASE WHEN ? THEN 'failed' ELSE status END, error = ?, updated_at = ?
      WHERE id = ? AND owner_id = ? AND status NOT IN ('completed', 'cancelled')
    `).run(terminal ? 1 : 0, error.slice(0, 1000), now, id, ownerId);
  }

  completeCheckpoint(versionId: string, ownerId: string, now: number, leaseTokenHash?: string) {
    return this.database.transaction(() => {
      const version = this.readVersion(versionId, ownerId);
      if (!version) return { status: "missing" } as const;
      const project = this.readProject(version.projectId, ownerId);
      if (!project) return { status: "missing" } as const;
      if (version.leaseGeneration !== project.leaseGeneration) return { status: "lease_lost" } as const;
      if (leaseTokenHash && !this.hasLease(version.projectId, ownerId, leaseTokenHash, now)) return { status: "lease_lost" } as const;
      if (version.status === "ready" && project.revision === version.revision) return { status: "ok", project, version } as const;
      if (project.revision !== version.revision - 1) return { status: "conflict", currentRevision: project.revision } as const;
      this.database.prepare("UPDATE atlas_project_versions SET status = 'ready', error = NULL, completed_at = ? WHERE id = ? AND owner_id = ?")
        .run(now, versionId, ownerId);
      this.database.prepare("UPDATE atlas_transfers SET status = 'completed', error = NULL, updated_at = ? WHERE version_id = ? AND owner_id = ?")
        .run(now, versionId, ownerId);
      this.database.prepare("UPDATE atlas_projects SET revision = ?, latest_version_id = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL")
        .run(version.revision, versionId, now, version.projectId, ownerId);
      const completed = this.readVersion(versionId, ownerId)!;
      return { status: "ok", project: this.readProject(version.projectId, ownerId)!, version: completed } as const;
    })();
  }

  reserveUploadedAsset(input: {
    asset: Omit<AtlasProjectAsset, "status" | "etag" | "createdAt" | "updatedAt">;
    transfer: Pick<AtlasTransfer, "id" | "size" | "partSize" | "partCount" | "expiresAt"> & { kind?: "asset_upload" | "export" };
    now: number; maxActiveTransfers?: number;
  }) {
    return this.database.transaction(() => {
      if (!this.readProject(input.asset.projectId, input.asset.ownerId)) return { status: "missing" } as const;
      const existingTransfer = this.readTransfer(input.transfer.id, input.asset.ownerId);
      if (existingTransfer) {
        const existingAsset = existingTransfer.assetId ? this.readAsset(existingTransfer.assetId, input.asset.ownerId) : null;
        const exact = existingAsset?.projectId === input.asset.projectId
          && existingTransfer.projectId === input.asset.projectId
          && existingAsset.objectKey === input.asset.objectKey
          && existingAsset.fileName === input.asset.fileName
          && existingAsset.contentType === input.asset.contentType
          && existingAsset.kind === input.asset.kind
          && existingAsset.sourceType === input.asset.sourceType
          && existingAsset.size === input.asset.size
          && existingTransfer.kind === (input.transfer.kind ?? "asset_upload")
          && existingTransfer.size === input.transfer.size
          && existingTransfer.partSize === input.transfer.partSize
          && existingTransfer.partCount === input.transfer.partCount;
        return exact && existingAsset
          ? { status: "existing", asset: existingAsset, transfer: existingTransfer } as const
          : { status: "idempotency_conflict" } as const;
      }
      const activeCount = Number((this.database.prepare(`
        SELECT COUNT(*) AS count FROM atlas_transfers
        WHERE owner_id = ? AND status IN ('initiated', 'uploading', 'verifying') AND expires_at > ?
      `).get(input.asset.ownerId, input.now) as { count: number }).count);
      if (activeCount >= (input.maxActiveTransfers ?? 8)) return { status: "limit", activeCount } as const;
      this.database.prepare(`
        INSERT INTO atlas_project_assets
          (id, owner_id, project_id, source_type, source_id, kind, object_key, file_name, content_type, size, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?)
      `).run(input.asset.id, input.asset.ownerId, input.asset.projectId, input.asset.sourceType, input.asset.sourceId ?? null,
        input.asset.kind, input.asset.objectKey, input.asset.fileName, input.asset.contentType, input.asset.size, input.now, input.now);
      this.database.prepare(`
        INSERT INTO atlas_transfers
          (id, owner_id, project_id, asset_id, kind, object_key, file_name, media_kind, content_type,
           size, part_size, part_count, status, created_at, updated_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'initiated', ?, ?, ?)
      `).run(input.transfer.id, input.asset.ownerId, input.asset.projectId, input.asset.id, input.transfer.kind ?? "asset_upload", input.asset.objectKey,
        input.asset.fileName, input.asset.kind, input.asset.contentType, input.transfer.size, input.transfer.partSize,
        input.transfer.partCount, input.now, input.now, input.transfer.expiresAt);
      return { status: "created", asset: this.readAsset(input.asset.id, input.asset.ownerId)!, transfer: this.readTransfer(input.transfer.id, input.asset.ownerId)! } as const;
    }).immediate();
  }

  createImportedAsset(input: Omit<AtlasProjectAsset, "status" | "etag" | "createdAt" | "updatedAt"> & { now: number }) {
    return this.database.transaction(() => {
      if (!this.readProject(input.projectId, input.ownerId)) return { status: "missing" } as const;
      if (input.sourceId) {
        const existing = assetFromRow(this.database.prepare(`
          SELECT * FROM atlas_project_assets
          WHERE project_id = ? AND owner_id = ? AND source_type = ? AND source_id = ? AND deleted_at IS NULL
        `).get(input.projectId, input.ownerId, input.sourceType, input.sourceId) as AssetRow | undefined);
        if (existing) return { status: "existing", asset: existing } as const;
      }
      this.database.prepare(`
        INSERT INTO atlas_project_assets
          (id, owner_id, project_id, source_type, source_id, kind, object_key, file_name, content_type, size, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'copying', ?, ?)
      `).run(input.id, input.ownerId, input.projectId, input.sourceType, input.sourceId ?? null, input.kind,
        input.objectKey, input.fileName, input.contentType, input.size, input.now, input.now);
      return { status: "created", asset: this.readAsset(input.id, input.ownerId)! } as const;
    })();
  }

  prepareImportedAssetRetry(id: string, ownerId: string, now: number) {
    this.database.prepare(`
      UPDATE atlas_project_assets SET status = 'copying', error = NULL, updated_at = ?
      WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND status IN ('copying', 'failed')
    `).run(now, id, ownerId);
    return this.readAsset(id, ownerId);
  }

  readAsset(id: string, ownerId: string) {
    return assetFromRow(this.database.prepare("SELECT * FROM atlas_project_assets WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").get(id, ownerId) as AssetRow | undefined);
  }

  listAssets(projectId: string, ownerId: string, limit = 100, offset = 0) {
    if (!this.readProject(projectId, ownerId)) return null;
    return (this.database.prepare(`
      SELECT * FROM atlas_project_assets
      WHERE project_id = ? AND owner_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?
    `).all(projectId, ownerId, limit, offset) as AssetRow[]).map((row) => assetFromRow(row)!);
  }

  markAssetReady(id: string, ownerId: string, metadata: { size: number; etag: string; contentType: string }, now: number) {
    return this.database.transaction(() => {
      const changed = this.database.prepare(`
        UPDATE atlas_project_assets SET status = 'ready', size = ?, etag = ?, content_type = ?, error = NULL, updated_at = ?
        WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND status IN ('uploading', 'copying', 'ready')
      `).run(metadata.size, metadata.etag, metadata.contentType, now, id, ownerId).changes;
      if (!changed) return null;
      this.database.prepare("UPDATE atlas_transfers SET status = 'completed', error = NULL, updated_at = ? WHERE asset_id = ? AND owner_id = ?")
        .run(now, id, ownerId);
      return this.readAsset(id, ownerId);
    })();
  }

  markExportReadyWithOutbox(id: string, ownerId: string, metadata: { size: number; etag: string; contentType: string }, now: number) {
    return this.database.transaction(() => {
      const asset = this.readAsset(id, ownerId);
      if (!asset || asset.sourceType !== "atlas_export" || !["uploading", "ready"].includes(asset.status)) return null;
      const changed = this.database.prepare(`
        UPDATE atlas_project_assets SET status = 'ready', size = ?, etag = ?, content_type = ?, error = NULL, updated_at = ?
        WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND source_type = 'atlas_export' AND status IN ('uploading', 'ready')
      `).run(metadata.size, metadata.etag, metadata.contentType, now, id, ownerId).changes;
      if (!changed) return null;
      this.database.prepare("UPDATE atlas_transfers SET status = 'completed', error = NULL, updated_at = ? WHERE asset_id = ? AND owner_id = ?")
        .run(now, id, ownerId);
      const ready = this.readAsset(id, ownerId)!;
      this.database.prepare(`
        INSERT INTO atlas_global_asset_outbox
          (asset_id, owner_id, project_id, name, object_key, content_type, size, etag, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        ON CONFLICT(asset_id) DO NOTHING
      `).run(ready.id, ready.ownerId, ready.projectId, ready.fileName, ready.objectKey, ready.contentType,
        ready.size, ready.etag, now, now);
      return {
        asset: ready,
        registration: this.readGlobalAssetRegistration(ready.id, ownerId)!,
      };
    })();
  }

  readGlobalAssetRegistration(assetId: string, ownerId: string) {
    return globalAssetRegistrationFromRow(this.database.prepare(`
      SELECT * FROM atlas_global_asset_outbox WHERE asset_id = ? AND owner_id = ?
    `).get(assetId, ownerId) as GlobalAssetOutboxRow | undefined);
  }

  listPendingGlobalAssetRegistrations(limit = 100) {
    return (this.database.prepare(`
      SELECT * FROM atlas_global_asset_outbox WHERE status = 'pending'
      ORDER BY updated_at ASC, asset_id ASC LIMIT ?
    `).all(Math.max(1, Math.min(1000, limit))) as GlobalAssetOutboxRow[])
      .map((row) => globalAssetRegistrationFromRow(row)!);
  }

  markGlobalAssetRegistrationCompleted(assetId: string, ownerId: string, now: number) {
    return this.database.prepare(`
      UPDATE atlas_global_asset_outbox
      SET status = 'completed', last_error = NULL, updated_at = ?, completed_at = ?
      WHERE asset_id = ? AND owner_id = ? AND status = 'pending'
    `).run(now, now, assetId, ownerId).changes > 0;
  }

  recordGlobalAssetRegistrationError(assetId: string, ownerId: string, error: string, now: number) {
    return this.database.prepare(`
      UPDATE atlas_global_asset_outbox
      SET attempt_count = attempt_count + 1, last_error = ?, updated_at = ?
      WHERE asset_id = ? AND owner_id = ? AND status = 'pending'
    `).run(error.slice(0, 1000), now, assetId, ownerId).changes > 0;
  }

  markAssetFailed(id: string, ownerId: string, error: string, now: number) {
    this.database.prepare(`
      UPDATE atlas_project_assets SET status = 'failed', error = ?, updated_at = ?
      WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND status IN ('uploading', 'copying')
    `).run(error.slice(0, 1000), now, id, ownerId);
  }

  softDeleteAsset(id: string, ownerId: string, now: number) {
    return this.database.transaction(() => {
      const asset = this.readAsset(id, ownerId);
      if (!asset) return null;
      const transfer = transferFromRow(this.database.prepare(`
        SELECT * FROM atlas_transfers WHERE asset_id = ? AND owner_id = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(id, ownerId) as TransferRow | undefined);
      const retained = asset.sourceType === "atlas_export" && asset.status === "ready";
      this.database.prepare(`
        UPDATE atlas_project_assets SET status = ?, deleted_at = ?, updated_at = ?
        WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
      `).run(retained ? "deleted" : "delete_pending", now, now, id, ownerId);
      if (transfer && ["initiated", "uploading", "verifying"].includes(transfer.status)) {
        this.database.prepare(`
          UPDATE atlas_transfers
          SET status = CASE WHEN tos_upload_id IS NULL THEN 'cancelled' ELSE 'failed' END,
              error = CASE WHEN tos_upload_id IS NULL THEN NULL ELSE 'ABORT_PENDING' END,
              updated_at = ?
          WHERE id = ? AND owner_id = ?
        `).run(now, transfer.id, ownerId);
      }
      return { asset, transfer, retained };
    })();
  }

  listDeletePendingAssets(limit = 100) {
    return (this.database.prepare(`
      SELECT * FROM atlas_project_assets WHERE status = 'delete_pending'
      ORDER BY updated_at ASC, id ASC LIMIT ?
    `).all(Math.max(1, Math.min(1000, limit))) as AssetRow[]).map((row) => assetFromRow(row)!);
  }

  markAssetDeleted(id: string, ownerId: string, now: number) {
    return this.database.prepare(`
      UPDATE atlas_project_assets SET status = 'deleted', error = NULL, deleted_at = COALESCE(deleted_at, ?), updated_at = ?
      WHERE id = ? AND owner_id = ? AND status = 'delete_pending'
    `).run(now, now, id, ownerId).changes > 0;
  }

  listDeletePendingVersions(limit = 100) {
    return (this.database.prepare(`
      SELECT * FROM atlas_project_versions WHERE status = 'delete_pending'
      ORDER BY created_at ASC, id ASC LIMIT ?
    `).all(Math.max(1, Math.min(1000, limit))) as VersionRow[]).map((row) => versionFromRow(row)!);
  }

  markVersionDeleted(id: string, ownerId: string) {
    return this.database.prepare(`
      UPDATE atlas_project_versions SET status = 'deleted', error = NULL
      WHERE id = ? AND owner_id = ? AND status = 'delete_pending'
    `).run(id, ownerId).changes > 0;
  }

  listExpiredTransfers(now: number, limit = 100) {
    return (this.database.prepare(`
      SELECT * FROM atlas_transfers
      WHERE expires_at <= ? AND status IN ('initiated', 'uploading', 'verifying')
      ORDER BY expires_at ASC, id ASC LIMIT ?
    `).all(now, Math.max(1, Math.min(1000, limit))) as TransferRow[]).map((row) => transferFromRow(row)!);
  }

  listAbortPendingTransfers(limit = 100) {
    return (this.database.prepare(`
      SELECT * FROM atlas_transfers
      WHERE status = 'failed' AND error = 'ABORT_PENDING' AND tos_upload_id IS NOT NULL
      ORDER BY updated_at ASC, id ASC LIMIT ?
    `).all(Math.max(1, Math.min(1000, limit))) as TransferRow[]).map((row) => transferFromRow(row)!);
  }

  markTransferAborted(id: string, ownerId: string, now: number) {
    return this.database.prepare(`
      UPDATE atlas_transfers SET status = 'cancelled', error = NULL, updated_at = ?
      WHERE id = ? AND owner_id = ? AND status = 'failed' AND error = 'ABORT_PENDING'
    `).run(now, id, ownerId).changes > 0;
  }

  markTransferCancelled(id: string, ownerId: string, now: number) {
    return this.database.transaction(() => {
      const transfer = this.readTransfer(id, ownerId);
      if (!transfer || !["initiated", "uploading", "verifying"].includes(transfer.status)) return false;
      this.database.prepare("UPDATE atlas_transfers SET status = 'cancelled', error = 'UPLOAD_EXPIRED', updated_at = ? WHERE id = ? AND owner_id = ?")
        .run(now, id, ownerId);
      if (transfer.assetId) this.database.prepare(`
        UPDATE atlas_project_assets SET status = 'failed', error = 'UPLOAD_EXPIRED', updated_at = ?
        WHERE id = ? AND owner_id = ? AND status = 'uploading'
      `).run(now, transfer.assetId, ownerId);
      if (transfer.versionId) this.database.prepare(`
        UPDATE atlas_project_versions SET status = 'failed', error = 'UPLOAD_EXPIRED'
        WHERE id = ? AND owner_id = ? AND status = 'uploading'
      `).run(transfer.versionId, ownerId);
      return true;
    })();
  }

  close() { this.database.close(); }
}
