import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { AtlasStore } from "./atlas-store.js";
import { UserStore } from "./db.js";
import { migrateDatabase } from "./migrations.js";

describe("Atlas durable project store", () => {
  const directories: string[] = [];
  const stores: AtlasStore[] = [];
  afterEach(() => {
    stores.splice(0).forEach((store) => store.close());
    directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
  });

  const fresh = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-atlas-store-"));
    directories.push(directory);
    const databasePath = path.join(directory, "firefly.db");
    migrateDatabase(databasePath);
    const users = new UserStore(databasePath);
    const owner = users.upsertFromFeishu({ openId: "atlas-owner", unionId: "union-owner", tenantKey: "tenant", email: "atlas-owner@dokuai.tv", name: "Owner", avatarUrl: "" });
    const other = users.upsertFromFeishu({ openId: "atlas-other", unionId: "union-other", tenantKey: "tenant", email: "atlas-other@dokuai.tv", name: "Other", avatarUrl: "" });
    users.close();
    const store = new AtlasStore(databasePath);
    stores.push(store);
    return { store, owner, other, databasePath };
  };

  it("isolates project CRUD and rejects stale revisions", () => {
    const { store, owner, other } = fresh();
    const project = store.createProject({ id: "project-1", ownerId: owner.id, title: "第一支片", now: 10 });
    expect(project.revision).toBe(0);
    expect(store.listProjects(owner.id)).toHaveLength(1);
    expect(store.listProjects(other.id)).toEqual([]);
    expect(store.readProject(project.id, other.id)).toBeNull();

    expect(store.updateProject(project.id, other.id, 0, "越权", 11)).toEqual({ status: "missing" });
    expect(store.updateProject(project.id, owner.id, 1, "过期", 11)).toEqual({ status: "conflict", currentRevision: 0 });
    expect(store.updateProject(project.id, owner.id, 0, "新片名", 12)).toMatchObject({ status: "ok", project: { title: "新片名" } });

    expect(store.softDeleteProject(project.id, other.id, 13)).toBeNull();
    expect(store.softDeleteProject(project.id, owner.id, 13)).toEqual({ objects: [], uploads: [] });
    expect(store.readProject(project.id, owner.id)).toBeNull();
  });

  it("enforces a renewable, explicitly takeable edit lease", () => {
    const { store, owner } = fresh();
    store.createProject({ id: "lease-project", ownerId: owner.id, title: "租约", now: 100 });
    expect(store.acquireLease("lease-project", owner.id, "device-a", "hash-a", 100, 45_000, false)).toMatchObject({ status: "ok" });
    expect(store.acquireLease("lease-project", owner.id, "device-a", "hash-cloned-tab", 150, 45_000, false)).toMatchObject({ status: "locked", deviceId: "device-a" });
    expect(store.acquireLease("lease-project", owner.id, "device-b", "hash-b", 200, 45_000, false)).toMatchObject({ status: "locked", deviceId: "device-a", expiresAt: 45_100 });
    expect(store.hasLease("lease-project", owner.id, "hash-a", 201)).toBe(true);
    expect(store.renewLease("lease-project", owner.id, "bad-hash", 202, 45_000)).toBeNull();
    expect(store.renewLease("lease-project", owner.id, "hash-a", 202, 45_000)?.leaseExpiresAt).toBe(45_202);
    expect(store.acquireLease("lease-project", owner.id, "device-b", "hash-b", 203, 45_000, true)).toMatchObject({ status: "ok", project: { leaseDeviceId: "device-b" } });
    expect(store.releaseLease("lease-project", owner.id, "hash-a", 204)).toBe(false);
    expect(store.releaseLease("lease-project", owner.id, "hash-b", 204)).toBe(true);
  });

  it("rechecks the active lease in the checkpoint commit transaction", () => {
    const { store, owner } = fresh();
    store.createProject({ id: "lease-checkpoint", ownerId: owner.id, title: "租约检查点", now: 1 });
    store.acquireLease("lease-checkpoint", owner.id, "tab-a", "lease-a", 2, 45_000, false);
    store.reserveCheckpoint({
      id: "lease-version", transferId: "lease-transfer", ownerId: owner.id, projectId: "lease-checkpoint",
      expectedRevision: 0, objectKey: "atlas/checkpoints/lease/1.json.gz", digest: "a".repeat(64), size: 10,
      partSize: 10, partCount: 1, now: 3, expiresAt: 100, leaseTokenHash: "lease-a",
    });
    store.acquireLease("lease-checkpoint", owner.id, "tab-b", "lease-b", 4, 45_000, true);
    expect(store.completeCheckpoint("lease-version", owner.id, 5, "lease-a")).toEqual({ status: "lease_lost" });
    expect(store.readProject("lease-checkpoint", owner.id)?.revision).toBe(0);
    expect(store.completeCheckpoint("lease-version", owner.id, 6, "lease-b")).toEqual({ status: "lease_lost" });
    expect(store.readProject("lease-checkpoint", owner.id)?.revision).toBe(0);
  });

  it("commits an immutable checkpoint exactly once and advances revision atomically", () => {
    const { store, owner } = fresh();
    store.createProject({ id: "checkpoint-project", ownerId: owner.id, title: "检查点", now: 1 });
    const reserved = store.reserveCheckpoint({
      id: "version-1", transferId: "transfer-1", ownerId: owner.id, projectId: "checkpoint-project",
      expectedRevision: 0, objectKey: "atlas/checkpoints/1.gz", digest: "a".repeat(64), size: 20,
      partSize: 10, partCount: 2, now: 2, expiresAt: 100,
    });
    expect(reserved).toMatchObject({ status: "created", version: { revision: 1 }, transfer: { status: "initiated" } });
    expect(store.activateTransfer("transfer-1", owner.id, "tos-upload-1", 3)).toMatchObject({ status: "uploading" });
    expect(store.markTransferVerifying("transfer-1", owner.id, [{ partNumber: 1, etag: "one" }, { partNumber: 2, etag: "two" }], 4)).toBe(true);
    expect(store.completeCheckpoint("version-1", owner.id, 5)).toMatchObject({ status: "ok", project: { revision: 1 }, version: { status: "ready" } });
    expect(store.readLatestVersion("checkpoint-project", owner.id)).toMatchObject({ id: "version-1", revision: 1 });
    expect(store.completeCheckpoint("version-1", owner.id, 6)).toMatchObject({ status: "ok", project: { revision: 1 } });

    expect(store.reserveCheckpoint({
      id: "version-stale", transferId: "transfer-stale", ownerId: owner.id, projectId: "checkpoint-project",
      expectedRevision: 0, objectKey: "atlas/checkpoints/stale.gz", digest: "b".repeat(64), size: 20,
      partSize: 10, partCount: 2, now: 7, expiresAt: 100,
    })).toEqual({ status: "conflict", currentRevision: 1 });
    store.softDeleteProject("checkpoint-project", owner.id, 8);
    expect(store.listDeletePendingVersions()).toMatchObject([{ id: "version-1", status: "delete_pending" }]);
    expect(store.markVersionDeleted("version-1", owner.id)).toBe(true);
    expect(store.listDeletePendingVersions()).toEqual([]);
  });

  it("restarts an expired checkpoint revision without permanently blocking cloud saves", () => {
    const { store, owner } = fresh();
    store.createProject({ id: "checkpoint-retry", ownerId: owner.id, title: "恢复", now: 1 });
    store.acquireLease("checkpoint-retry", owner.id, "tab-a", "lease-hash", 2, 45_000, false);
    store.reserveCheckpoint({
      id: "failed-version", transferId: "failed-transfer", ownerId: owner.id, projectId: "checkpoint-retry",
      expectedRevision: 0, objectKey: "atlas/checkpoints/retry/1.json.gz", digest: "a".repeat(64), size: 20,
      partSize: 10, partCount: 2, now: 3, expiresAt: 50, leaseTokenHash: "lease-hash",
    });
    store.activateTransfer("failed-transfer", owner.id, "expired-upload", 4);
    expect(store.markTransferCancelled("failed-transfer", owner.id, 51)).toBe(true);
    const recoverable = store.reserveCheckpoint({
      id: "unused-version", transferId: "unused-transfer", ownerId: owner.id, projectId: "checkpoint-retry",
      expectedRevision: 0, objectKey: "atlas/checkpoints/retry/1.json.gz", digest: "b".repeat(64), size: 30,
      partSize: 10, partCount: 3, now: 52, expiresAt: 100, leaseTokenHash: "lease-hash",
    });
    expect(recoverable).toMatchObject({ status: "recoverable", version: { id: "failed-version", status: "failed" }, transfer: { id: "failed-transfer", status: "cancelled" } });
    const claimed = store.claimFailedCheckpointReset({
      versionId: "failed-version", transferId: "failed-transfer", ownerId: owner.id, projectId: "checkpoint-retry",
      expectedRevision: 0, now: 53, leaseTokenHash: "lease-hash", claimToken: "reset-claim",
    });
    expect(claimed).toMatchObject({ status: "ok", transfer: { status: "failed", error: "RESETTING:reset-claim" } });
    expect(store.reserveCheckpoint({
      id: "other-version", transferId: "other-transfer", ownerId: owner.id, projectId: "checkpoint-retry",
      expectedRevision: 0, objectKey: "atlas/checkpoints/retry/1.json.gz", digest: "b".repeat(64), size: 30,
      partSize: 10, partCount: 3, now: 53, expiresAt: 100, leaseTokenHash: "lease-hash",
    })).toMatchObject({ status: "resetting" });
    const restarted = store.finishFailedCheckpointReset({
      versionId: "failed-version", transferId: "failed-transfer", ownerId: owner.id, projectId: "checkpoint-retry",
      expectedRevision: 0, digest: "b".repeat(64), size: 30, partSize: 10, partCount: 3,
      now: 53, expiresAt: 100, leaseTokenHash: "lease-hash", claimToken: "reset-claim",
    });
    expect(restarted).toMatchObject({ status: "ok", version: { digest: "b".repeat(64), size: 30, status: "uploading" }, transfer: { status: "initiated", tosUploadId: undefined, partCount: 3 } });
    store.activateTransfer("failed-transfer", owner.id, "new-upload", 54);
    store.markTransferVerifying("failed-transfer", owner.id, [
      { partNumber: 1, etag: "one" }, { partNumber: 2, etag: "two" }, { partNumber: 3, etag: "three" },
    ], 55);
    expect(store.completeCheckpoint("failed-version", owner.id, 56)).toMatchObject({ status: "ok", project: { revision: 1 } });
  });

  it("fences an errored checkpoint from an old lease generation into claimed recovery", () => {
    const { store, owner } = fresh();
    store.createProject({ id: "production-stale", ownerId: owner.id, title: "生产恢复", now: 1 });
    store.acquireLease("production-stale", owner.id, "tab-old", "lease-old", 2, 45_000, false);
    store.reserveCheckpoint({
      id: "stale-version", transferId: "stale-transfer", ownerId: owner.id, projectId: "production-stale",
      expectedRevision: 0, objectKey: "atlas/checkpoints/stale/1.json.gz", digest: "a".repeat(64), size: 8,
      partSize: 8, partCount: 1, now: 3, expiresAt: 86_403, leaseTokenHash: "lease-old",
    });
    store.activateTransfer("stale-transfer", owner.id, "stale-upload", 4);
    store.recordTransferError("stale-transfer", owner.id, "SignatureDoesNotMatch", 5);
    store.acquireLease("production-stale", owner.id, "tab-new", "lease-new", 6, 45_000, true);

    const retry = () => store.reserveCheckpoint({
      id: "unused-version", transferId: "unused-transfer", ownerId: owner.id, projectId: "production-stale",
      expectedRevision: 0, objectKey: "atlas/checkpoints/stale/1.json.gz", digest: "b".repeat(64), size: 9,
      partSize: 9, partCount: 1, now: 7, expiresAt: 86_407, leaseTokenHash: "lease-new",
    });
    expect(retry()).toMatchObject({
      status: "recoverable",
      version: { id: "stale-version", status: "failed", leaseGeneration: 1 },
      transfer: { id: "stale-transfer", status: "failed", tosUploadId: "stale-upload" },
    });
    expect(retry()).toMatchObject({ status: "recoverable" });
    expect(store.claimFailedCheckpointReset({
      versionId: "stale-version", transferId: "stale-transfer", ownerId: owner.id, projectId: "production-stale",
      expectedRevision: 0, now: 8, leaseTokenHash: "lease-new", claimToken: "winner",
    })).toMatchObject({ status: "ok", previousTransfer: { tosUploadId: "stale-upload" } });
    store.recordTransferError("stale-transfer", owner.id, "late-old-request", 8);
    expect(store.readTransfer("stale-transfer", owner.id)?.error).toBe("RESETTING:winner");
    expect(store.claimFailedCheckpointReset({
      versionId: "stale-version", transferId: "stale-transfer", ownerId: owner.id, projectId: "production-stale",
      expectedRevision: 0, now: 8, leaseTokenHash: "lease-new", claimToken: "loser",
    })).toEqual({ status: "state_changed" });
    expect(store.finishFailedCheckpointReset({
      versionId: "stale-version", transferId: "stale-transfer", ownerId: owner.id, projectId: "production-stale",
      expectedRevision: 0, digest: "b".repeat(64), size: 9, partSize: 9, partCount: 1,
      now: 9, expiresAt: 86_409, leaseTokenHash: "lease-new", claimToken: "winner",
    })).toMatchObject({ status: "ok", version: { status: "uploading", leaseGeneration: 2, digest: "b".repeat(64) } });
  });

  it("recovers a stale checkpoint after the takeover grace window without waiting for the 24 hour upload expiry", () => {
    const { store, owner } = fresh();
    store.createProject({ id: "stale-timeout", ownerId: owner.id, title: "超时恢复", now: 1 });
    store.acquireLease("stale-timeout", owner.id, "tab-old", "lease-old", 2, 45_000, false);
    store.reserveCheckpoint({
      id: "stale-timeout-version", transferId: "stale-timeout-transfer", ownerId: owner.id, projectId: "stale-timeout",
      expectedRevision: 0, objectKey: "atlas/checkpoints/stale-timeout/1.json.gz", digest: "a".repeat(64), size: 8,
      partSize: 8, partCount: 1, now: 3, expiresAt: 86_403, leaseTokenHash: "lease-old",
    });
    store.activateTransfer("stale-timeout-transfer", owner.id, "stale-timeout-upload", 4);
    store.acquireLease("stale-timeout", owner.id, "tab-new", "lease-new", 6, 500_000, true);

    const reserve = (now: number) => store.reserveCheckpoint({
      id: "unused-version", transferId: "unused-transfer", ownerId: owner.id, projectId: "stale-timeout",
      expectedRevision: 0, objectKey: "atlas/checkpoints/stale-timeout/1.json.gz", digest: "b".repeat(64), size: 9,
      partSize: 9, partCount: 1, now, expiresAt: now + 86_400_000, leaseTokenHash: "lease-new",
    });

    expect(reserve(120_003)).toMatchObject({ status: "stale_in_flight" });
    expect(reserve(120_004)).toMatchObject({
      status: "recoverable",
      version: { id: "stale-timeout-version", status: "failed", error: "ABANDONED_LEASE_GENERATION" },
      transfer: { id: "stale-timeout-transfer", status: "failed", error: "ABANDONED_LEASE_GENERATION" },
    });
  });

  it("fails closed when a checkpoint generation is impossibly ahead of its project", () => {
    const { store, owner, databasePath } = fresh();
    store.createProject({ id: "future-generation", ownerId: owner.id, title: "异常代次", now: 1 });
    store.acquireLease("future-generation", owner.id, "tab", "lease", 2, 45_000, false);
    store.reserveCheckpoint({
      id: "future-version", transferId: "future-transfer", ownerId: owner.id, projectId: "future-generation",
      expectedRevision: 0, objectKey: "atlas/checkpoints/future/1.json.gz", digest: "a".repeat(64), size: 8,
      partSize: 8, partCount: 1, now: 3, expiresAt: 100, leaseTokenHash: "lease",
    });
    const database = new Database(databasePath);
    database.prepare("UPDATE atlas_projects SET lease_generation = 0 WHERE id = ?").run("future-generation");
    database.close();
    expect(store.reserveCheckpoint({
      id: "unused", transferId: "unused", ownerId: owner.id, projectId: "future-generation",
      expectedRevision: 0, objectKey: "atlas/checkpoints/future/1.json.gz", digest: "a".repeat(64), size: 8,
      partSize: 8, partCount: 1, now: 4, expiresAt: 100,
    })).toEqual({ status: "generation_invalid" });
  });

  it("keeps a healthy same-generation checkpoint idempotent", () => {
    const { store, owner } = fresh();
    store.createProject({ id: "healthy-upload", ownerId: owner.id, title: "正常上传", now: 1 });
    store.acquireLease("healthy-upload", owner.id, "tab", "lease", 2, 45_000, false);
    const input = {
      id: "healthy-version", transferId: "healthy-transfer", ownerId: owner.id, projectId: "healthy-upload",
      expectedRevision: 0, objectKey: "atlas/checkpoints/healthy/1.json.gz", digest: "a".repeat(64), size: 8,
      partSize: 8, partCount: 1, now: 3, expiresAt: 100, leaseTokenHash: "lease",
    };
    expect(store.reserveCheckpoint(input)).toMatchObject({ status: "created" });
    store.activateTransfer("healthy-transfer", owner.id, "healthy-upload-id", 4);
    expect(store.reserveCheckpoint({ ...input, id: "unused", transferId: "unused", now: 5 })).toMatchObject({
      status: "existing", version: { status: "uploading" }, transfer: { status: "uploading", tosUploadId: "healthy-upload-id" },
    });
    store.recordTransferError("healthy-transfer", owner.id, "SignatureDoesNotMatch", 6);
    expect(store.reserveCheckpoint({ ...input, id: "unused-after-error", transferId: "unused-after-error", now: 7 })).toMatchObject({
      status: "existing", version: { status: "uploading" }, transfer: { status: "uploading", tosUploadId: "healthy-upload-id" },
    });
    expect(store.reserveCheckpoint({
      ...input, id: "unused-2", transferId: "unused-2", digest: "b".repeat(64), now: 8,
    })).toMatchObject({
      status: "recoverable", version: { status: "failed", leaseGeneration: 1 }, transfer: { status: "failed" },
    });
  });

  it("allows a crashed checkpoint reset claim to be reclaimed after its bounded lease", () => {
    const { store, owner } = fresh();
    store.createProject({ id: "reset-crash", ownerId: owner.id, title: "重置恢复", now: 1 });
    store.acquireLease("reset-crash", owner.id, "tab-a", "lease-a", 2, 1_000_000, false);
    store.reserveCheckpoint({
      id: "reset-version", transferId: "reset-transfer", ownerId: owner.id, projectId: "reset-crash",
      expectedRevision: 0, objectKey: "atlas/checkpoints/reset/1.json.gz", digest: "a".repeat(64), size: 10,
      partSize: 10, partCount: 1, now: 3, expiresAt: 10, leaseTokenHash: "lease-a",
    });
    store.activateTransfer("reset-transfer", owner.id, "old-upload", 4);
    store.markTransferCancelled("reset-transfer", owner.id, 11);
    expect(store.claimFailedCheckpointReset({
      versionId: "reset-version", transferId: "reset-transfer", ownerId: owner.id, projectId: "reset-crash",
      expectedRevision: 0, now: 12, leaseTokenHash: "lease-a", claimToken: "crashed-claim",
    })).toMatchObject({ status: "ok" });
    expect(store.reserveCheckpoint({
      id: "unused", transferId: "unused", ownerId: owner.id, projectId: "reset-crash", expectedRevision: 0,
      objectKey: "atlas/checkpoints/reset/1.json.gz", digest: "b".repeat(64), size: 20, partSize: 10,
      partCount: 2, now: 600_011, expiresAt: 900_000, leaseTokenHash: "lease-a",
    })).toMatchObject({ status: "resetting" });
    expect(store.reserveCheckpoint({
      id: "unused", transferId: "unused", ownerId: owner.id, projectId: "reset-crash", expectedRevision: 0,
      objectKey: "atlas/checkpoints/reset/1.json.gz", digest: "b".repeat(64), size: 20, partSize: 10,
      partCount: 2, now: 600_013, expiresAt: 900_000, leaseTokenHash: "lease-a",
    })).toMatchObject({ status: "recoverable" });
    expect(store.claimFailedCheckpointReset({
      versionId: "reset-version", transferId: "reset-transfer", ownerId: owner.id, projectId: "reset-crash",
      expectedRevision: 0, now: 600_013, leaseTokenHash: "lease-a", claimToken: "replacement-claim",
    })).toMatchObject({ status: "ok", transfer: { error: "RESETTING:replacement-claim" } });
    expect(store.finishFailedCheckpointReset({
      versionId: "reset-version", transferId: "reset-transfer", ownerId: owner.id, projectId: "reset-crash",
      expectedRevision: 0, digest: "b".repeat(64), size: 20, partSize: 10, partCount: 2,
      now: 600_014, expiresAt: 900_000, leaseTokenHash: "lease-a", claimToken: "crashed-claim",
    })).toEqual({ status: "state_changed" });
    expect(store.finishFailedCheckpointReset({
      versionId: "reset-version", transferId: "reset-transfer", ownerId: owner.id, projectId: "reset-crash",
      expectedRevision: 0, digest: "b".repeat(64), size: 20, partSize: 10, partCount: 2,
      now: 600_014, expiresAt: 900_000, leaseTokenHash: "lease-a", claimToken: "replacement-claim",
    })).toMatchObject({ status: "ok", transfer: { status: "initiated" } });
  });

  it("tracks resumable uploads, imported assets and project cleanup", () => {
    const { store, owner, other } = fresh();
    store.createProject({ id: "asset-project", ownerId: owner.id, title: "素材", now: 1 });
    const reserved = store.reserveUploadedAsset({
      asset: { id: "asset-upload", ownerId: owner.id, projectId: "asset-project", sourceType: "local_upload", kind: "video", objectKey: "atlas/assets/upload.mp4", fileName: "upload.mp4", contentType: "video/mp4", size: 20 },
      transfer: { id: "upload-1", size: 20, partSize: 10, partCount: 2, expiresAt: 100 }, now: 2,
    });
    expect(reserved).toMatchObject({ asset: { status: "uploading" }, transfer: { status: "initiated" } });
    store.activateTransfer("upload-1", owner.id, "tos-upload-1", 3);
    expect(store.readTransfer("upload-1", other.id)).toBeNull();
    expect(store.markAssetReady("asset-upload", owner.id, { size: 20, etag: "etag", contentType: "video/mp4" }, 4)).toMatchObject({ status: "ready" });

    expect(store.createImportedAsset({
      id: "asset-copy", ownerId: owner.id, projectId: "asset-project", sourceType: "generation", sourceId: "generation-1",
      kind: "video", objectKey: "atlas/assets/copy.mp4", fileName: "copy.mp4", contentType: "video/mp4", size: 9, now: 5,
    })).toMatchObject({ status: "created", asset: { status: "copying" } });
    expect(store.createImportedAsset({
      id: "asset-copy-again", ownerId: owner.id, projectId: "asset-project", sourceType: "generation", sourceId: "generation-1",
      kind: "video", objectKey: "atlas/assets/unused.mp4", fileName: "copy.mp4", contentType: "video/mp4", size: 9, now: 6,
    })).toMatchObject({ status: "existing", asset: { id: "asset-copy" } });
    expect(store.listAssets("asset-project", other.id)).toBeNull();
    expect(store.listAssets("asset-project", owner.id)).toHaveLength(2);

    const deleted = store.softDeleteProject("asset-project", owner.id, 7)!;
    expect(deleted.objects).toEqual(expect.arrayContaining(["atlas/assets/upload.mp4", "atlas/assets/copy.mp4"]));
    expect(store.listAssets("asset-project", owner.id)).toBeNull();
  });

  it("commits an Atlas export and its global registration outbox atomically", () => {
    const { store, owner } = fresh();
    store.createProject({ id: "export-project", ownerId: owner.id, title: "导出", now: 1 });
    store.reserveUploadedAsset({
      asset: {
        id: "export-asset", ownerId: owner.id, projectId: "export-project", sourceType: "atlas_export",
        kind: "video", objectKey: "atlas/exports/aa/export.mp4", fileName: "result.mp4",
        contentType: "video/mp4", size: 20,
      },
      transfer: { id: "export-transfer", kind: "export", size: 20, partSize: 10, partCount: 2, expiresAt: 100 },
      now: 2,
    });
    store.activateTransfer("export-transfer", owner.id, "tos-export", 3);

    const committed = store.markExportReadyWithOutbox(
      "export-asset", owner.id, { size: 20, etag: "export-etag", contentType: "video/mp4" }, 4,
    );
    expect(committed).toMatchObject({
      asset: { status: "ready" }, registration: { assetId: "export-asset", status: "pending", attemptCount: 0 },
    });
    expect(store.readTransfer("export-transfer", owner.id)).toMatchObject({ status: "completed" });
    expect(store.listPendingGlobalAssetRegistrations()).toMatchObject([{ assetId: "export-asset" }]);
    expect(store.recordGlobalAssetRegistrationError("export-asset", owner.id, "temporary", 5)).toBe(true);
    expect(store.readGlobalAssetRegistration("export-asset", owner.id)).toMatchObject({ attemptCount: 1, lastError: "temporary" });
    expect(store.markGlobalAssetRegistrationCompleted("export-asset", owner.id, 6)).toBe(true);
    expect(store.listPendingGlobalAssetRegistrations()).toEqual([]);
    expect(store.softDeleteAsset("export-asset", owner.id, 7)).toMatchObject({ retained: true });
  });

  it("exposes durable compensation scans for pending deletes and expired multiparts", () => {
    const { store, owner } = fresh();
    store.createProject({ id: "cleanup-project", ownerId: owner.id, title: "清理", now: 1 });
    store.reserveUploadedAsset({
      asset: { id: "cleanup-asset", ownerId: owner.id, projectId: "cleanup-project", sourceType: "local_upload", kind: "video", objectKey: "atlas/assets/cleanup.mp4", fileName: "cleanup.mp4", contentType: "video/mp4", size: 20 },
      transfer: { id: "cleanup-upload", size: 20, partSize: 10, partCount: 2, expiresAt: 50 }, now: 2,
    });
    store.activateTransfer("cleanup-upload", owner.id, "tos-cleanup", 3);
    expect(store.listExpiredTransfers(49)).toEqual([]);
    expect(store.listExpiredTransfers(50)).toMatchObject([{ id: "cleanup-upload", tosUploadId: "tos-cleanup" }]);
    expect(store.markTransferCancelled("cleanup-upload", owner.id, 51)).toBe(true);
    expect(store.readTransfer("cleanup-upload", owner.id)?.status).toBe("cancelled");
    expect(store.readAsset("cleanup-asset", owner.id)).toMatchObject({ status: "failed", error: "UPLOAD_EXPIRED" });

    expect(store.softDeleteAsset("cleanup-asset", owner.id, 52)).toMatchObject({ retained: false });
    expect(store.listDeletePendingAssets()).toMatchObject([{ id: "cleanup-asset" }]);
    expect(store.markAssetDeleted("cleanup-asset", owner.id, 53)).toBe(true);
    expect(store.listDeletePendingAssets()).toEqual([]);

    store.createProject({ id: "abort-project", ownerId: owner.id, title: "中止", now: 60 });
    store.reserveUploadedAsset({
      asset: { id: "abort-asset", ownerId: owner.id, projectId: "abort-project", sourceType: "local_upload", kind: "video", objectKey: "atlas/assets/abort.mp4", fileName: "abort.mp4", contentType: "video/mp4", size: 20 },
      transfer: { id: "abort-upload", size: 20, partSize: 10, partCount: 2, expiresAt: 500 }, now: 61,
    });
    store.activateTransfer("abort-upload", owner.id, "tos-abort", 62);
    store.softDeleteAsset("abort-asset", owner.id, 63);
    expect(store.listAbortPendingTransfers()).toMatchObject([{ id: "abort-upload", error: "ABORT_PENDING" }]);
    expect(store.markTransferAborted("abort-upload", owner.id, 64)).toBe(true);
    expect(store.listAbortPendingTransfers()).toEqual([]);
  });
});
