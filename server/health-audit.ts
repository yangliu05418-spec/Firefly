import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";
import { assertSchemaVersion } from "./migrations.js";
import { tosHealth } from "./tos.js";

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
  let database: Database.Database | undefined;
  let queueCounts: Record<string, unknown> = {};
  let backupAgeMs = Number.POSITIVE_INFINITY;
  let tos = { configured: false, reachable: false };
  try {
    await redis.ping().catch(() => { reasons.push("redis_unavailable"); });
    try {
      database = new Database(config.databasePath, { readonly: true, fileMustExist: true });
      assertSchemaVersion(database);
      if (database.pragma("quick_check", { simple: true }) !== "ok") reasons.push("sqlite_integrity_failed");
    } catch { reasons.push("sqlite_unavailable"); }
    try {
      const [generationCounts, mediaCounts, previewCounts, assetCounts] = await Promise.all([
        generation.getJobCounts("wait", "active", "failed"), media.getJobCounts("wait", "active", "failed"), preview.getJobCounts("wait", "active", "failed"), assets.getJobCounts("wait", "active", "failed")
      ]);
      queueCounts = { generation: generationCounts, media: mediaCounts, preview: previewCounts, assets: assetCounts };
      if ((generationCounts.failed ?? 0) + (mediaCounts.failed ?? 0) + (previewCounts.failed ?? 0) + (assetCounts.failed ?? 0) > 0) reasons.push("failed_jobs_present");
    } catch { reasons.push("queues_unavailable"); }
    backupAgeMs = latestBackupAge();
    if (backupAgeMs > maximumBackupAgeMs) reasons.push("backup_stale");
    if (config.mediaStorageBackend === "tos") {
      tos = await tosHealth().catch(() => ({ configured: true, reachable: false }));
      if (!tos.configured || !tos.reachable) reasons.push("tos_unavailable");
    }
  } finally {
    database?.close();
    await Promise.allSettled([generation.close(), media.close(), preview.close(), assets.close()]);
    redis.disconnect();
  }
  const blockingReasons = reasons;
  const result = { type: "health_audit", at: new Date().toISOString(), ok: blockingReasons.length === 0, state: blockingReasons.sort().join(",") || "ok", warnings: [], backupAgeSeconds: Number.isFinite(backupAgeMs) ? Math.round(backupAgeMs / 1000) : null, queueCounts, tos, revision: config.revision, imageDigest: config.imageDigest };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
};

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ type: "health_audit_crashed", at: new Date().toISOString(), message: String(error).slice(0, 300) })}\n`);
  process.exitCode = 1;
});
