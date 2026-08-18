export const shouldRecoverArchiveHandoff = (
  task: { sourceVideoUrl?: string; sourceVideoExpiresAt?: number },
  mediaStorageBackend: string,
  now = Date.now()
) => mediaStorageBackend === "tos"
  && Boolean(task.sourceVideoUrl)
  && Boolean(task.sourceVideoExpiresAt && task.sourceVideoExpiresAt > now + 5 * 60 * 1000);
