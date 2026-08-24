export const shouldRecoverArchiveHandoff = (
  task: { sourceVideoUrl?: string; sourceVideoExpiresAt?: number },
  mediaStorageBackend: string,
  now = Date.now()
) => mediaStorageBackend === "tos"
  && Boolean(task.sourceVideoUrl)
  && Boolean(task.sourceVideoExpiresAt && task.sourceVideoExpiresAt > now + 5 * 60 * 1000);

export type ArchiveTransferStrategy = "existing_object" | "url_fetch" | "stream_multipart";

export const archiveTransferStrategy = (attempt: number, existingObjectOnly = false): ArchiveTransferStrategy => {
  if (existingObjectOnly) return "existing_object";
  return attempt <= 1 ? "url_fetch" : "stream_multipart";
};
