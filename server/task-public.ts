import type { StoredTask } from "./db.js";

/**
 * 任务公开投影。
 * 媒体可用性分层：
 * - ready：稳定 Firefly 路由（TOS 已归档，长期有效）
 * - archiving / fallback / failed：暴露上游临时源（可播放但非最终态），附带过期时间，
 *   前端据此展示"临时源预览/正在归档/归档待恢复"等状态；绝不在任务对象中暴露 provider 密钥字段。
 */
export const publicTask = ({ ownerId: _ownerId, request: _request, sourceVideoUrl, sourceVideoExpiresAt, deletedAt: _deletedAt, ...task }: StoredTask) => {
  const revision = task.mediaRevision ?? 0;
  const stable = task.status === "succeeded" && task.mediaStatus === "ready";
  const temporary =
    task.status === "succeeded" &&
    Boolean(sourceVideoUrl) &&
    (task.mediaStatus === "archiving" || task.mediaStatus === "fallback" || task.mediaStatus === "failed") &&
    (!sourceVideoExpiresAt || sourceVideoExpiresAt > Date.now());
  return {
    ...task,
    caseId: task.id,
    videoUrl: stable ? `/api/generations/${task.id}/media?rev=${revision}` : temporary ? sourceVideoUrl : undefined,
    downloadUrl: stable ? `/api/generations/${task.id}/download?rev=${revision}` : undefined,
    posterUrl: stable ? `/api/generations/${task.id}/poster?rev=${revision}` : undefined,
    videoExpiresAt: temporary ? sourceVideoExpiresAt : undefined,
    mediaSource: stable ? ("tos" as const) : temporary ? ("upstream" as const) : undefined
  };
};
