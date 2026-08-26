import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";
import { assertSchemaVersion } from "./migrations.js";
import { tosHealth } from "./tos.js";
import { readWorkerHealth, type WorkerHealthSnapshot } from "./worker-heartbeat.js";
import { readJourneySlos, type JourneySlo } from "./journey-observability.js";

const backupDirectory = process.env.BACKUP_DIR ?? "/data/backups";
const maximumBackupAgeMs = 8 * 3600 * 1000;

const latestBackupAge = () => {
  const entries = fs.existsSync(backupDirectory) ? fs.readdirSync(backupDirectory).filter((name) => /^firefly-\d{8}T\d{6}Z\.db$/.test(name)) : [];
  const newest = entries.reduce((latest, name) => Math.max(latest, fs.statSync(path.join(backupDirectory, name)).mtimeMs), 0);
  return newest ? Date.now() - newest : Number.POSITIVE_INFINITY;
};

const main = async () => {
  const reasons: string[] = [];
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 5000, commandTimeout: 5000 });
  const generation = new Queue("generation", { connection: redis });
  const media = new Queue("media", { connection: redis });
  const preview = new Queue("preview", { connection: redis });
  const assets = new Queue("asset-ingest", { connection: redis });
  const images = new Queue("image-generation", { connection: redis });
  const canvas = new Queue("canvas-jobs", { connection: redis });
  const uploads = new Queue("upload-finalization", { connection: redis });
  let database: Database.Database | undefined;
  let queueCounts: Record<string, unknown> = {};
  let outboxCounts = { pending: 0, stalled: 0 };
  let backupAgeMs = Number.POSITIVE_INFINITY;
  let tos = { configured: false, reachable: false };
  let workerHealth: WorkerHealthSnapshot | undefined;
  let creationReferences = { promoting: 0, stalled: 0, failedRecent: 0 };
  let reeditMetrics = { started: 0, failed: 0, failureRate: 0 };
  let journeySlos: JourneySlo[] = [];
  try {
    await redis.ping().catch(() => { reasons.push("redis_unavailable"); });
    try {
      database = new Database(config.databasePath, { readonly: true, fileMustExist: true });
      assertSchemaVersion(database);
      if (database.pragma("quick_check", { simple: true }) !== "ok") reasons.push("sqlite_integrity_failed");
      const outbox = database.prepare(`
        SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'pending' AND available_at < ? THEN 1 ELSE 0 END) AS stalled
        FROM async_job_outbox
      `).get(Date.now() - 2 * 60_000) as { pending: number | null; stalled: number | null };
      outboxCounts = { pending: outbox.pending ?? 0, stalled: outbox.stalled ?? 0 };
      if (outboxCounts.stalled > 0) reasons.push("async_outbox_stalled");
      const references = database.prepare(`
        SELECT
          SUM(CASE WHEN references.status = 'promoting' THEN 1 ELSE 0 END) AS promoting,
          SUM(CASE WHEN references.status = 'promoting' AND references.updated_at < ? THEN 1 ELSE 0 END) AS stalled,
          SUM(CASE WHEN references.status = 'unavailable' AND references.updated_at >= ? THEN 1 ELSE 0 END) AS failed_recent
        FROM creation_snapshot_references AS references
        JOIN creation_snapshots AS snapshots
          ON snapshots.source_type = references.source_type AND snapshots.source_id = references.source_id
        WHERE references.status != 'unavailable' OR snapshots.recovery_quality = 'exact'
      `).get(Date.now() - 30 * 60_000, Date.now() - 24 * 60 * 60_000) as { promoting: number | null; stalled: number | null; failed_recent: number | null };
      creationReferences = { promoting: references.promoting ?? 0, stalled: references.stalled ?? 0, failedRecent: references.failed_recent ?? 0 };
      if (creationReferences.stalled > 0) reasons.push("creation_reference_archive_stalled");
      if (creationReferences.failedRecent > 0) reasons.push("creation_reference_archive_failed");
    } catch { reasons.push("sqlite_unavailable"); }
    try {
      const minutes = Array.from({ length: 5 }, (_, index) => Math.floor(Date.now() / 60_000) - index);
      const metricValues = await redis.mget(...minutes.flatMap((minute) => [`metrics:reedit:${minute}:started`, `metrics:reedit:${minute}:failed`]));
      reeditMetrics.started = metricValues.filter((_value, index) => index % 2 === 0).reduce((sum, value) => sum + Number(value ?? 0), 0);
      reeditMetrics.failed = metricValues.filter((_value, index) => index % 2 === 1).reduce((sum, value) => sum + Number(value ?? 0), 0);
      reeditMetrics.failureRate = reeditMetrics.started ? Number((reeditMetrics.failed / reeditMetrics.started).toFixed(4)) : 0;
      if (reeditMetrics.started > 0 && reeditMetrics.failureRate > 0.05) reasons.push("reedit_failure_rate_high");
      journeySlos = await readJourneySlos(redis, 15);
      for (const slo of journeySlos) if (slo.sampleStatus === "breached") reasons.push(`slo_${slo.journey}_breached`);
      const [generationCounts, mediaCounts, previewCounts, assetCounts, imageCounts, canvasCounts, uploadCounts] = await Promise.all([
        generation.getJobCounts("wait", "active", "failed"), media.getJobCounts("wait", "active", "failed"), preview.getJobCounts("wait", "active", "failed"), assets.getJobCounts("wait", "active", "failed"), images.getJobCounts("wait", "active", "failed"), canvas.getJobCounts("wait", "active", "failed"), uploads.getJobCounts("wait", "active", "failed")
      ]);
      queueCounts = { generation: generationCounts, media: mediaCounts, preview: previewCounts, assets: assetCounts, images: imageCounts, canvas: canvasCounts, uploads: uploadCounts };
      if ((generationCounts.failed ?? 0) + (mediaCounts.failed ?? 0) + (previewCounts.failed ?? 0) + (assetCounts.failed ?? 0) + (imageCounts.failed ?? 0) + (canvasCounts.failed ?? 0) + (uploadCounts.failed ?? 0) > 0) reasons.push("failed_jobs_present");
    } catch { reasons.push("queues_unavailable"); }
    try {
      workerHealth = await readWorkerHealth(redis);
      if (!workerHealth.ready) reasons.push("workers_unavailable");
    } catch { reasons.push("workers_unavailable"); }
    backupAgeMs = latestBackupAge();
    if (backupAgeMs > maximumBackupAgeMs) reasons.push("backup_stale");
    if (config.mediaStorageBackend === "tos") {
      tos = await tosHealth().catch(() => ({ configured: true, reachable: false }));
      if (!tos.configured || !tos.reachable) reasons.push("tos_unavailable");
    }
  } finally {
    database?.close();
    await Promise.allSettled([generation.close(), media.close(), preview.close(), assets.close(), images.close(), canvas.close(), uploads.close()]);
    redis.disconnect();
  }
  const blockingReasons = reasons;
  const result = { type: "health_audit", at: new Date().toISOString(), ok: blockingReasons.length === 0, state: blockingReasons.sort().join(",") || "ok", warnings: [], backupAgeSeconds: Number.isFinite(backupAgeMs) ? Math.round(backupAgeMs / 1000) : null, queueCounts, outboxCounts, creationReferences, reeditMetrics, journeySlos, workerHealth, tos, revision: config.revision, imageDigest: config.imageDigest };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
};

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ type: "health_audit_crashed", at: new Date().toISOString(), message: String(error).slice(0, 300) })}\n`);
  process.exitCode = 1;
});
