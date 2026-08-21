import crypto from "node:crypto";
import { Worker, type Job } from "bullmq";
import { config } from "./config.js";
import { users } from "./store.js";
import { redis } from "./redis.js";
import { imageModelById, openRouterResolution } from "./image-models.js";
import { downloadImageBuffer, generateCanvasText, generateSingleImage } from "./openrouter.js";
import { storeGeneratedImage } from "./generated-media.js";
import { canvasProjectAssetProviderUrl } from "./canvas-project-assets.js";
import { closeWorkersWithin } from "./shutdown.js";
import { startWorkerHeartbeat } from "./worker-heartbeat.js";

type TextPayload = { instruction: string; currentText: string; context: string };
type ImagePayload = { prompt: string; model: string; ratio: string; resolution: string; referenceAssetIds: string[] };
type CanvasQueuePayload = { canvasJobId: string; kind: "text" | "image" | "character_tool"; payload: TextPayload | ImagePayload };

const publish = async (canvasId: string, value: unknown) => {
  await redis.publish(`canvas:events:${canvasId}`, JSON.stringify(value)).catch(() => undefined);
};

const processCanvasJob = async (bullJob: Job<CanvasQueuePayload>) => {
  const record = users.readCanvasJob(bullJob.data.canvasJobId);
  if (!record || record.status === "cancelled") return;
  users.updateCanvasJob(record.id, { status: "running", error: undefined });
  await publish(record.canvasId, { type: "canvas_job", job: users.readCanvasJob(record.id) });
  try {
    if (bullJob.data.kind === "text") {
      const payload = bullJob.data.payload as TextPayload;
      let lastPublishedAt = 0;
      const text = await generateCanvasText(payload, async (partialText) => {
        if (users.readCanvasJob(record.id)?.status === "cancelled") return;
        const now = Date.now();
        if (now - lastPublishedAt < 180) return;
        lastPublishedAt = now;
        const partial = users.updateCanvasJob(record.id, { status: "running", partialText, error: undefined });
        if (partial) await publish(record.canvasId, { type: "canvas_job", job: partial });
      });
      if (users.readCanvasJob(record.id)?.status === "cancelled") return;
      const completed = users.updateCanvasJob(record.id, { status: "succeeded", partialText: text, error: undefined });
      await publish(record.canvasId, { type: "canvas_job", job: completed });
      return;
    }

    const payload = bullJob.data.payload as ImagePayload;
    const spec = imageModelById(payload.model);
    if (!spec) throw new Error("图片模型不存在或已下线");
    if (!spec.resolutions.includes(payload.resolution)) throw new Error("图片模型不支持当前分辨率");
    const references = payload.referenceAssetIds.map((id) => {
      const asset = users.readCanvasProjectAsset(id);
      if (!asset || asset.canvasId !== record.canvasId || asset.ownerId !== record.ownerId) throw new Error("参考素材不存在");
      return canvasProjectAssetProviderUrl(asset);
    });
    const url = await generateSingleImage({ model: payload.model, prompt: payload.prompt, references, ratio: payload.ratio, resolution: openRouterResolution(payload.resolution) });
    if (users.readCanvasJob(record.id)?.status === "cancelled") return;
    const buffer = await downloadImageBuffer(url);
    if (users.readCanvasJob(record.id)?.status === "cancelled") return;
    const contentType = url.startsWith("data:image/webp") ? "image/webp" : url.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png";
    const media = await storeGeneratedImage({ ownerId: record.ownerId, body: buffer, contentType, fileName: `canvas-${record.nodeId}.png` });
    const now = Date.now();
    const asset = users.upsertCanvasProjectAsset({
      id: `canvas-project-asset-${crypto.randomUUID()}`,
      ownerId: record.ownerId,
      canvasId: record.canvasId,
      kind: "image",
      sourceType: "generated",
      sourceId: media.id,
      title: payload.prompt.slice(0, 80) || "生成图片",
      contentType: media.contentType,
      size: media.size,
      status: "ready",
      createdAt: now,
      updatedAt: now,
    });
    const completed = users.updateCanvasJob(record.id, { status: "succeeded", resultAssetId: asset.id, error: undefined });
    await publish(record.canvasId, { type: "canvas_job", job: completed });
  } catch (error) {
    const current = users.readCanvasJob(record.id);
    if (current?.status === "cancelled") return;
    const finalAttempt = bullJob.attemptsMade + 1 >= (bullJob.opts.attempts ?? 1);
    const next = users.updateCanvasJob(record.id, {
      status: finalAttempt ? "failed" : "running",
      error: finalAttempt ? (error instanceof Error ? error.message.slice(0, 500) : "画布任务失败") : null,
    });
    await publish(record.canvasId, { type: "canvas_job", job: next });
    throw error;
  }
};

const worker = new Worker<CanvasQueuePayload>("canvas-jobs", processCanvasJob, {
  connection: redis,
  concurrency: 2,
  lockDuration: Math.max(300_000, config.openrouterRequestTimeoutMs + 60_000),
});
await worker.waitUntilReady();
const heartbeat = await startWorkerHeartbeat(redis, "canvas");

worker.on("failed", (job, error) => console.error(JSON.stringify({ type: "canvas_job_failed", at: new Date().toISOString(), jobId: job?.id, code: (error as { code?: string }).code ?? "unknown", message: error.message })));

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await heartbeat.stop();
  const graceful = await closeWorkersWithin([worker], config.shutdownGraceMs);
  console.info(JSON.stringify({ type: "worker_shutdown", at: new Date().toISOString(), worker: "canvas", graceful }));
  await redis.quit(); users.close(); process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
