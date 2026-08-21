import type { ImageGenerationTask } from "./db.js";

export const publicImageGeneration = ({ ownerId: _ownerId, deletedAt: _deletedAt, ...task }: ImageGenerationTask) => ({
  id: task.id,
  model: task.model,
  modelName: task.modelName,
  ratio: task.ratio,
  resolution: task.resolution,
  prompt: task.prompt,
  requestedCount: task.requestedCount,
  status: task.status === "running" ? "generating" as const : task.status,
  items: task.items,
  failed: task.failures,
  error: task.error,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
});
