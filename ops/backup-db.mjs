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
  const sourceDatabase = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await sourceDatabase.backup(target);
  } finally { sourceDatabase.close(); }

  verifySqlite(target);
  const stat = await fsPromises.stat(target);
  const hash = await hashFile(target);
  let objectKey;
  let requestId;
  const tosConfigured = Boolean(process.env.TOS_ACCESS_KEY_ID && process.env.TOS_SECRET_ACCESS_KEY && process.env.TOS_BUCKET);
  if (process.env.REQUIRE_TOS_BACKUP === "true" && !tosConfigured) throw new Error("TOS backup is required but credentials are not configured");

  const restorePath = `${target}.restore-${crypto.randomUUID()}`;
  try {
    if (tosConfigured) {
      const client = new TosClient({
        accessKeyId: process.env.TOS_ACCESS_KEY_ID,
        accessKeySecret: process.env.TOS_SECRET_ACCESS_KEY,
        region: process.env.TOS_REGION || "cn-beijing",
        endpoint: process.env.TOS_ENDPOINT || "tos-cn-beijing.bytepluses.com.cn",
        requestTimeout: 60_000,
        connectionTimeout: 10_000,
        maxRetryCount: 2
      });
      const date = new Date();
      objectKey = `backups/sqlite/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${path.basename(target)}`;
      const put = await client.putObject({ bucket: process.env.TOS_BUCKET, key: objectKey, body: fs.createReadStream(target), contentType: "application/x-sqlite3", meta: { sha256: hash } });
      requestId = put.requestId;
      const head = await client.headObject({ bucket: process.env.TOS_BUCKET, key: objectKey });
      const remoteSize = Number(head.data["content-length"]);
      const remoteHash = String(head.data["x-tos-meta-sha256"] ?? "");
      if (remoteSize !== stat.size) throw new Error(`TOS Head size mismatch: expected ${stat.size}, received ${remoteSize}`);
      if (remoteHash && remoteHash !== hash) throw new Error("TOS Head SHA256 metadata mismatch");

      await client.getObjectToFile({ bucket: process.env.TOS_BUCKET, key: objectKey, filePath: restorePath });
    } else {
      await fsPromises.copyFile(target, restorePath);
    }
    verifySqlite(restorePath);
    if (await hashFile(restorePath) !== hash) throw new Error("Restored backup SHA256 mismatch");
  } finally {
    await fsPromises.rm(restorePath, { force: true });
  }

  process.stdout.write(`${JSON.stringify({ type: "database_backup_completed", at: new Date().toISOString(), path: target, objectKey, size: stat.size, sha256: hash, requestId, restoreDrill: "ok" })}\n`);
};

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ type: "database_backup_failed", at: new Date().toISOString(), message: message.slice(0, 500) })}\n`);
  try { await notifyFailure(message); }
  catch (alertError) { process.stderr.write(`${JSON.stringify({ type: "backup_alert_failed", at: new Date().toISOString(), message: String(alertError).slice(0, 300) })}\n`); }
  process.exitCode = 1;
});
