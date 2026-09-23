import crypto from "node:crypto";
import { Redis } from "ioredis";
import { config } from "./config.js";
import { users } from "./store.js";
import { transcodePreview } from "./preview-transcode.js";
import { assertPreviewDuration, probePreviewSource } from "./preview-integrity.js";
import { deleteObject, optimizePlaybackObject, signedObjectUrl } from "./tos.js";

// Targeted, auditable repair. Never calls a generation Provider or replaces the
// original. The previous preview stays readable until the new one is verified.
const taskId = process.argv[2];
const confirmed = process.argv.includes("--confirm");
if (!taskId || !/^[a-f0-9-]{36}$/.test(taskId)) throw new Error("用法: repair-preview <task UUID> [--confirm]");
const task = users.readTask(taskId);
const output = users.readTaskMedia(taskId, "output");
if (!task?.ownerId || task.status !== "succeeded" || !output) throw new Error("任务原片尚未就绪，未执行修复");
const original = await probePreviewSource(signedObjectUrl(output.objectKey, { expires: 3600 }));
const previous = users.readTaskMedia(taskId, "preview");
let needsRepair = !previous;
if (previous) {
  const preview = await probePreviewSource(signedObjectUrl(previous.objectKey, { expires: 300 }));
  try { assertPreviewDuration(original, preview); }
  catch { needsRepair = true; }
  console.info(JSON.stringify({ type: "preview_repair_audit", taskId, originalDuration: original.duration, previewDuration: preview.duration, needsRepair }));
}
if (needsRepair && confirmed) {
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 1 });
  const token = crypto.randomUUID();
  const leaseKey = `media:preview:lease:${taskId}`;
  const targetKey = `previews/${crypto.createHash("sha256").update(taskId).digest("hex").slice(0, 2)}/${task.ownerId}/${taskId}/preview-verified-${token}.mp4`;
  let acquired = false;
  let committed = false;
  const startedAt = Date.now();
  try {
    acquired = Boolean(await redis.set(leaseKey, token, "PX", config.tosTranscodeDeadlineMs + config.tosSourceStreamTimeoutMs + 120_000, "NX"));
    if (!acquired) throw new Error("该任务已有预览处理操作，未执行并行修复");
    await transcodePreview(output.objectKey, targetKey);
    const head = await optimizePlaybackObject(targetKey, { contentType: "video/mp4", fileName: "preview.mp4", cacheSeconds: config.tosPreviewTtlSeconds });
    const data = head.data as unknown as { contentLength?: number; etag?: string };
    const headers = head.headers as Record<string, string | undefined>;
    const now = Date.now();
    const result = users.commitTaskMediaIfActive(taskId, {
      id: `${taskId}:preview`, ownerId: task.ownerId, taskId, kind: "preview", status: "ready",
      objectKey: targetKey, fileName: "preview.mp4", contentType: "video/mp4",
      size: Number(data.contentLength ?? headers["content-length"]), etag: String(data.etag ?? headers.etag ?? "").replace(/^"|"$/g, ""),
      createdAt: previous?.createdAt ?? now, updatedAt: now,
    });
    if (!result) throw new Error("任务已删除，未发布修复预览");
    committed = true;
    console.info(JSON.stringify({ type: "preview_repair_completed", taskId, revision: result.mediaRevision, elapsedMs: Date.now() - startedAt, originalRetained: true, previousPreviewRetained: Boolean(previous) }));
  } finally {
    if (acquired && !committed) await deleteObject(targetKey).catch(() => undefined);
    if (acquired) await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, leaseKey, token).catch(() => undefined);
    await redis.quit();
  }
}
