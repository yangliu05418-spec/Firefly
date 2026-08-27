export const shouldRecoverArchiveHandoff = (
  task: { sourceVideoUrl?: string; sourceVideoExpiresAt?: number },
  mediaStorageBackend: string,
  now = Date.now()
) => mediaStorageBackend === "tos"
  && Boolean(task.sourceVideoUrl)
  && Boolean(task.sourceVideoExpiresAt && task.sourceVideoExpiresAt > now + 5 * 60 * 1000);

export type ArchiveTransferStrategy = "existing_object" | "url_fetch" | "stream_multipart";

export const archiveTransferStrategy = (
  checkpoint: { strategy?: "url_fetch" | "stream_multipart"; fetchStartedAt?: number } | null,
  existingObjectOnly = false,
  now = Date.now(),
  fetchMaxWaitMs = 300_000,
  urlFetchEnabled = true,
): ArchiveTransferStrategy => {
  if (existingObjectOnly) return "existing_object";
  if (checkpoint?.strategy === "stream_multipart") return "stream_multipart";
  if (!urlFetchEnabled) return "stream_multipart";
  if (checkpoint?.fetchStartedAt && now - checkpoint.fetchStartedAt >= fetchMaxWaitMs) return "stream_multipart";
  return "url_fetch";
};
