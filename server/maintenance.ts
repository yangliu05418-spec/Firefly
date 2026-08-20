import { users } from "./store.js";

const retentionDays = Number(process.env.TOMBSTONE_RETENTION_DAYS ?? 30);
if (!Number.isInteger(retentionDays) || retentionDays < 30 || retentionDays > 3650) throw new Error("TOMBSTONE_RETENTION_DAYS 必须是 30 到 3650 的整数");
const apply = process.argv.includes("--apply");
const cutoff = Date.now() - retentionDays * 24 * 3600 * 1000;

try {
  const purged = users.purgeTombstones(cutoff, apply);
  console.info(JSON.stringify({ type: "maintenance_tombstones", at: new Date().toISOString(), apply, retentionDays, cutoff: new Date(cutoff).toISOString(), purged }));
} finally { users.close(); }
