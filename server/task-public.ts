import type { StoredTask } from "./db.js";

export const publicTask = ({ ownerId: _ownerId, request: _request, sourceVideoUrl: _sourceVideoUrl, sourceVideoExpiresAt: _sourceVideoExpiresAt, deletedAt: _deletedAt, ...task }: StoredTask) => {
  const hasMedia = task.status === "succeeded" && task.mediaStatus === "ready";
  const revision = task.mediaRevision ?? 0;
  return {
    ...task,
    caseId: task.id,
    videoUrl: hasMedia ? `/api/generations/${task.id}/media?rev=${revision}` : undefined,
    downloadUrl: hasMedia ? `/api/generations/${task.id}/download?rev=${revision}` : undefined,
    posterUrl: hasMedia ? `/api/generations/${task.id}/poster?rev=${revision}` : undefined,
    videoExpiresAt: undefined
  };
};
