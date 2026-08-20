import type { ImageGenerationTask } from "./db.js";
import { imageModelById } from "./image-models.js";

export const publicImageGenerationTask = (task: ImageGenerationTask) => ({
  id: task.id,
  status: task.status,
  model: task.model,
  modelName: imageModelById(task.model)?.name ?? task.model,
  ratio: task.ratio,
  resolution: task.resolution,
  count: task.requestedCount,
  prompt: task.prompt,
  Items: task.items.map(({ mediaId, width, height }) => ({ mediaId, width, height })),
  Failed: task.failures,
  error: task.error,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
  completedAt: task.completedAt
});

export const accessibleImageGenerationTask = (task: ImageGenerationTask | null, ownerId: string) =>
  task?.ownerId === ownerId ? task : null;
