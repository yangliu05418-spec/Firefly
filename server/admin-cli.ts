import fs from "node:fs";
import path from "node:path";
import { assetQueue, generationQueue, imageGenerationQueue, mediaQueue, previewQueue, redis, saveTask } from "./redis.js";
import { users } from "./store.js";
import { config } from "./config.js";
import { tos, tosConfigured } from "./tos.js";
import { validateAdminWrite } from "./admin-confirm.js";

const argv = process.argv.slice(2);
const command = argv[0] ?? "help";
const flag = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
const taskId = flag("--task");
let operator = (process.env.FIREFLY_OPERATOR ?? "").trim();
const audit = (action: string, target: string) => console.info(JSON.stringify({ type: "admin_action", at: new Date().toISOString(), operator, action, target }));
const requireConfirmedWrite = (target?: string) => {
  const validated = validateAdminWrite({ target, confirmation: flag("--confirm"), operator });
  operator = validated.operator;
  return validated.target;
};
const outputFormatFor = (request: unknown) => (request as { outputFormat?: unknown } | undefined)?.outputFormat === "mov" ? "mov" as const : "mp4" as const;

const queueStatus = async () => {
  const queues = { generation: generationQueue, media: mediaQueue, preview: previewQueue, imageGeneration: imageGenerationQueue, assetIngest: assetQueue };
  const entries = await Promise.all(Object.entries(queues).map(async ([name, queue]) => [name, await queue.getJobCounts("wait", "active", "delayed", "completed", "failed")] as const));
  console.info(JSON.stringify({ ok: true, queues: Object.fromEntries(entries) }));
};

const backupStatus = () => {
  const directory = process.env.BACKUP_DIR ?? "/data/backups";
  const entries = fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => /^firefly-\d{8}T\d{6}Z\.db$/.test(name)).map((name) => ({ name, bytes: fs.statSync(path.join(directory, name)).size, modifiedAt: fs.statSync(path.join(directory, name)).mtime.toISOString() })).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)) : [];
  console.info(JSON.stringify({ ok: entries.length > 0, directory, latest: entries[0] ?? null, count: entries.length }));
};

const rearchiveTask = async () => {
  const id = requireConfirmedWrite(taskId);
  const task = users.readTask(id, true);
  if (!task || task.deletedAt) throw new Error("任务不存在或已删除");
  if (users.readTaskMedia(id, "output")) throw new Error("成片已经归档，无需重复归档");
  if (!task.sourceVideoUrl || !task.sourceVideoExpiresAt || task.sourceVideoExpiresAt <= Date.now() + 5 * 60_000) throw new Error("任务没有仍然有效的临时成片源");
  await saveTask({ ...task, status: "succeeded", mediaStatus: "archiving", mediaAttempts: 0, mediaLastError: undefined, error: undefined, updatedAt: Date.now() });
  await mediaQueue.add("archive-output", { taskId: id, sourceUrl: task.sourceVideoUrl, outputFormat: outputFormatFor(task.request) }, { jobId: `manual-archive-${id}-${Date.now()}`, attempts: 4, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: { age: 24 * 3600 }, removeOnFail: { age: 24 * 3600 } });
  audit("task_rearchive", id);
};

const recoverMedia = async () => {
  const id = requireConfirmedWrite(taskId);
  const kind = flag("--kind");
  if (kind !== "poster" && kind !== "preview") throw new Error("--kind 必须是 poster 或 preview");
  const task = users.readTask(id);
  if (!task || task.status !== "succeeded" || !users.readTaskMedia(id, "output")) throw new Error("任务或已归档成片不存在");
  if (users.readTaskMedia(id, kind)) throw new Error(`${kind} 已存在，无需恢复`);
  const queue = kind === "preview" ? previewQueue : mediaQueue;
  await queue.add(kind === "preview" ? "create-preview" : "create-poster", { taskId: id }, { jobId: `manual-${kind}-${id}-${Date.now()}`, attempts: kind === "preview" ? 3 : 5, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: true, removeOnFail: { age: 24 * 3600 } });
  audit(`media_recover_${kind}`, id);
};

const listPrefix = async (prefix: string, referenced: Set<string>) => {
  let continuationToken: string | undefined; let total = 0; const orphanSamples: string[] = [];
  do {
    const response = await tos.listObjectsType2({ bucket: config.tosBucket, prefix, maxKeys: 1000, ...(continuationToken ? { continuationToken } : {}) });
    for (const object of response.data.Contents ?? []) {
      if (!object.Key) continue;
      total += 1;
      if (!referenced.has(object.Key) && orphanSamples.length < 20) orphanSamples.push(object.Key);
    }
    continuationToken = response.data.IsTruncated ? response.data.NextContinuationToken : undefined;
  } while (continuationToken);
  return { prefix, total, orphanSamples };
};

const tosOrphans = async () => {
  if (!tosConfigured()) throw new Error("TOS 配置不完整");
  const referenced = users.referencedObjectKeys();
  const prefixes = [] as Awaited<ReturnType<typeof listPrefix>>[];
  for (const prefix of ["outputs/", "previews/", "posters/", "generated/", "canvas/"]) prefixes.push(await listPrefix(prefix, referenced));
  console.info(JSON.stringify({ ok: true, referenced: referenced.size, prefixes }));
};

const help = () => console.info(`Firefly admin CLI\n\nRead-only:\n  queue-status\n  backup-status\n  tos-orphans\n\nWrites (require FIREFLY_OPERATOR and exact confirmation):\n  task-rearchive --task <id> --confirm <id>\n  media-recover --task <id> --kind poster|preview --confirm <id>`);

try {
  if (command === "queue-status") await queueStatus();
  else if (command === "backup-status") backupStatus();
  else if (command === "task-rearchive") await rearchiveTask();
  else if (command === "media-recover") await recoverMedia();
  else if (command === "tos-orphans") await tosOrphans();
  else if (command === "help" || command === "--help" || command === "-h") help();
  else throw new Error(`未知命令：${command}`);
} catch (error) {
  console.error(JSON.stringify({ ok: false, command, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
} finally {
  await Promise.allSettled([generationQueue.close(), mediaQueue.close(), previewQueue.close(), imageGenerationQueue.close(), assetQueue.close()]);
  await redis.quit().catch(() => undefined);
  users.close();
}
