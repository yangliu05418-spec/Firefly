import crypto from "node:crypto";
import type { ImageGenerationTask } from "./db.js";
import { imageGenerationQueue } from "./redis.js";
import { users } from "./store.js";

export class ImageGenerationCapacityError extends Error {
  constructor() { super("图片生成繁忙，请等当前生成完成后再试（每用户同时最多 2 组）"); this.name = "ImageGenerationCapacityError"; }
}

export const createImageGenerationTask = async (input: {
  ownerId: string;
  model: string;
  ratio: string;
  resolution: string;
  count: number;
  prompt: string;
  referenceUploadIds: string[];
  compatibilityLeaseToken?: string;
}) => {
  const now = Date.now();
  const task: ImageGenerationTask = {
    id: crypto.randomUUID(), ownerId: input.ownerId, status: "queued", model: input.model,
    ratio: input.ratio, resolution: input.resolution, requestedCount: input.count, prompt: input.prompt,
    referenceUploadIds: input.referenceUploadIds, items: [], failures: [], createdAt: now, updatedAt: now
  };
  if (!users.createImageGenerationTask(task, 2)) throw new ImageGenerationCapacityError();
  try {
    await imageGenerationQueue.add("generate-image", {
      taskId: task.id,
      compatibilityLease: input.compatibilityLeaseToken ? { userId: input.ownerId, token: input.compatibilityLeaseToken } : undefined
    }, { jobId: task.id, attempts: 3, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: { age: 7 * 24 * 3600 }, removeOnFail: { age: 7 * 24 * 3600 } });
  } catch (error) {
    users.updateImageGenerationTask(task.id, { status: "failed", error: "任务进入图片生成队列失败", completedAt: Date.now(), updatedAt: Date.now() });
    throw error;
  }
  return task;
};
