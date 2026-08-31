import type { ImageGenerationTask } from "./db.js";
import type { PublicLocalMediaDescriptor } from "./local-media-public.js";

export const publicImageGeneration = (
  { ownerId: _ownerId, deletedAt: _deletedAt, ...task }: ImageGenerationTask,
  mediaFor?: (mediaId: string) => { thumbnail?: PublicLocalMediaDescriptor; original?: PublicLocalMediaDescriptor } | undefined,
) => ({
  id: task.id,
  sessionId: task.sessionId,
  model: task.model,
  modelName: task.modelName,
  ratio: task.ratio,
  resolution: task.resolution,
  prompt: task.prompt,
  requestedCount: task.requestedCount,
  status: task.status === "running" ? "generating" as const : task.status,
  items: task.items.map((item) => ({ ...item, localMedia: mediaFor?.(item.mediaId) })),
  failed: task.failures,
  error: task.error,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
});
