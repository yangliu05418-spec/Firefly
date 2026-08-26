import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { TosClient } from "@volcengine/tos-sdk";

const hashFile = async (filePath) => {
  const digest = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
};

const verifySqlite = (filePath) => {
  const database = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const result = database.pragma("integrity_check", { simple: true });
    if (result !== "ok") throw new Error(`SQLite integrity check failed: ${result}`);
  } finally { database.close(); }
};

const logStage = (stage, details = {}) => process.stdout.write(`${JSON.stringify({ type: "database_backup_stage", at: new Date().toISOString(), stage, ...details })}\n`);

const notifyFailure = async (message) => {
  if (!process.env.FEISHU_WEBHOOK_URL) return;
  const response = await fetch(process.env.FEISHU_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ msg_type: "text", content: { text: `Firefly backup failed\n${message.slice(0, 500)}` } }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Feishu alert returned HTTP ${response.status}`);
};

const main = async () => {
  const source = process.env.DATABASE_PATH || "/data/firefly.db";
  const target = process.env.BACKUP_PATH;
  if (!target) throw new Error("BACKUP_PATH is required");

  await fsPromises.mkdir(path.dirname(target), { recursive: true });
  logStage("sqlite_copy_started");
  const sourceDatabase = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await sourceDatabase.backup(target);
  } finally { sourceDatabase.close(); }

  verifySqlite(target);
  const stat = await fsPromises.stat(target);
  const hash = await hashFile(target);
  logStage("sqlite_copy_verified", { size: stat.size, sha256: hash });
  let objectKey;
  let requestId;
  let offsite = false;
  const tosConfigured = Boolean(process.env.TOS_ACCESS_KEY_ID && process.env.TOS_SECRET_ACCESS_KEY && process.env.TOS_BUCKET);
  const allowLocalFallback = process.env.ALLOW_LOCAL_BACKUP_FALLBACK === "true";
  if (process.env.REQUIRE_TOS_BACKUP === "true" && !tosConfigured) throw new Error("TOS backup is required but credentials are not configured");

  const restorePath = `${target}.restore-${crypto.randomUUID()}`;
  try {
    if (tosConfigured) {
      const configuredTimeout = Number(process.env.TOS_BACKUP_REQUEST_TIMEOUT_MS || 300_000);
      const requestTimeout = Number.isFinite(configuredTimeout) && configuredTimeout >= 60_000 ? configuredTimeout : 300_000;
      const client = new TosClient({
        accessKeyId: process.env.TOS_ACCESS_KEY_ID,
        accessKeySecret: process.env.TOS_SECRET_ACCESS_KEY,
        region: process.env.TOS_REGION || "cn-beijing",
        endpoint: process.env.TOS_ENDPOINT || "tos-cn-beijing.bytepluses.com.cn",
        requestTimeout,
        connectionTimeout: 15_000,
        // A pre-deploy backup has an outer availability deadline. Let the
        // scheduled strict backup retain SDK retries, but fail fast enough for
        // deploys to use their verified local restore point.
        maxRetryCount: allowLocalFallback ? 0 : 3
      });
      const date = new Date();
      objectKey = `backups/sqlite/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${path.basename(target)}`;
      logStage("tos_upload_started", { objectKey, size: stat.size, requestTimeout });
      const put = await client.uploadFile({ bucket: process.env.TOS_BUCKET, key: objectKey, file: target, partSize: 16 * 1024 * 1024, taskNum: 2, contentType: "application/x-sqlite3", meta: { sha256: hash } });
      requestId = put.requestId;
      logStage("tos_upload_completed", { objectKey, requestId });
      const head = await client.headObject({ bucket: process.env.TOS_BUCKET, key: objectKey });
      const remoteSize = Number(head.data["content-length"]);
      const remoteHash = String(head.data["x-tos-meta-sha256"] ?? "");
      if (remoteSize !== stat.size) throw new Error(`TOS Head size mismatch: expected ${stat.size}, received ${remoteSize}`);
      if (remoteHash && remoteHash !== hash) throw new Error("TOS Head SHA256 metadata mismatch");

      logStage("restore_download_started", { objectKey, size: stat.size });
      await client.getObjectToFile({ bucket: process.env.TOS_BUCKET, key: objectKey, filePath: restorePath });
      logStage("restore_download_completed", { objectKey });
      offsite = true;
    } else {
      await fsPromises.copyFile(target, restorePath);
    }
    verifySqlite(restorePath);
    if (await hashFile(restorePath) !== hash) throw new Error("Restored backup SHA256 mismatch");
  } catch (error) {
    if (!allowLocalFallback || !tosConfigured) throw error;
    const failure = error ?? {};
    logStage("tos_backup_deferred", {
      code: failure.code ?? "TOS_BACKUP_DEFERRED",
      statusCode: failure.statusCode,
      requestId: failure.requestId,
    });
    objectKey = undefined;
    requestId = undefined;
    await fsPromises.rm(restorePath, { force: true });
    await fsPromises.copyFile(target, restorePath);
    verifySqlite(restorePath);
    if (await hashFile(restorePath) !== hash) throw new Error("Restored backup SHA256 mismatch");
  } finally {
    await fsPromises.rm(restorePath, { force: true });
  }

  process.stdout.write(`${JSON.stringify({ type: "database_backup_completed", at: new Date().toISOString(), path: target, objectKey, size: stat.size, sha256: hash, requestId, restoreDrill: "ok", offsite })}\n`);
};

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ type: "database_backup_failed", at: new Date().toISOString(), message: message.slice(0, 500) })}\n`);
  try { await notifyFailure(message); }
  catch (alertError) { process.stderr.write(`${JSON.stringify({ type: "backup_alert_failed", at: new Date().toISOString(), message: String(alertError).slice(0, 300) })}\n`); }
  process.exitCode = 1;
});
