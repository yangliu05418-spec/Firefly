import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { TosClient } from "@volcengine/tos-sdk";

const source = process.env.DATABASE_PATH || "/data/firefly.db";
const target = process.env.BACKUP_PATH;
if (!target) throw new Error("BACKUP_PATH is required");

await fsPromises.mkdir(path.dirname(target), { recursive: true });
const database = new Database(source, { readonly: true, fileMustExist: true });
try {
  await database.backup(target);
} finally { database.close(); }

const backup = new Database(target, { readonly: true, fileMustExist: true });
try {
  const result = backup.pragma("integrity_check", { simple: true });
  if (result !== "ok") throw new Error(`SQLite backup integrity check failed: ${result}`);
} finally { backup.close(); }

const digest = crypto.createHash("sha256");
for await (const chunk of fs.createReadStream(target)) digest.update(chunk);
const stat = await fsPromises.stat(target);
const hash = digest.digest("hex");
let objectKey;

if (process.env.TOS_ACCESS_KEY_ID && process.env.TOS_SECRET_ACCESS_KEY && process.env.TOS_BUCKET) {
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
  await client.putObject({ bucket: process.env.TOS_BUCKET, key: objectKey, body: fs.createReadStream(target), contentType: "application/x-sqlite3", meta: { sha256: hash } });
}

process.stdout.write(`${JSON.stringify({ type: "database_backup_completed", at: new Date().toISOString(), path: target, objectKey, size: stat.size, sha256: hash })}\n`);
