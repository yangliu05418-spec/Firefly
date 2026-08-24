import type { StoredTask } from "./db.js";

/**
 * 任务公开投影。
 * 媒体可用性分层：
 * - ready：稳定 Firefly 路由（TOS 已归档，长期有效）
 * - archiving / fallback / failed：稳定入口保持关闭；上游临时源仅作为显式、可选的降级预览，
 *   前端不得自动挂载或预加载；绝不在任务对象中暴露 provider 密钥字段。
 */
export const publicTask = (
  { ownerId: _ownerId, request: _request, sourceVideoUrl, sourceVideoExpiresAt, deletedAt: _deletedAt, ...task }: StoredTask,
  { stableMediaReady = true, stablePreviewReady = false }: { stableMediaReady?: boolean; stablePreviewReady?: boolean } = {},
) => {
  const revision = task.mediaRevision ?? 0;
  const downloadable = task.status === "succeeded" && task.mediaStatus === "ready" && stableMediaReady;
  const previewable = task.status === "succeeded" && (downloadable || stablePreviewReady);
  const mediaStatus = task.status === "succeeded" && task.mediaStatus === "ready" && !stableMediaReady
    ? "archiving" as const
    : task.mediaStatus;
  const temporary =
    task.status === "succeeded" &&
    Boolean(sourceVideoUrl) &&
    !previewable &&
    (!sourceVideoExpiresAt || sourceVideoExpiresAt > Date.now());
  return {
    ...task,
    mediaStatus,
    caseId: task.id,
    videoUrl: previewable ? `/api/generations/${task.id}/media?rev=${revision}` : undefined,
    downloadUrl: downloadable ? `/api/generations/${task.id}/download?rev=${revision}` : undefined,
    posterUrl: downloadable ? `/api/generations/${task.id}/poster?rev=${revision}` : undefined,
    temporaryVideoUrl: temporary ? sourceVideoUrl : undefined,
    temporaryVideoExpiresAt: temporary ? sourceVideoExpiresAt : undefined,
    mediaSource: previewable ? ("tos" as const) : undefined
  };
};
