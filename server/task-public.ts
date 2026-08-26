import type { StoredTask } from "./db.js";
import { classifyProviderError, providerPublicMessage } from "./provider.js";

const publicFailure = (error: string | undefined, errorCode: string | undefined) => {
  if (!error) return undefined;
  if (errorCode) return providerPublicMessage(errorCode);
  if (/Filter\.GroupType|omni_reference_task_type|task.?type|content|safety|policy|not.*activated|model.*unavailable|rate.?limit/i.test(error)) {
    return classifyProviderError(error, 400).publicMessage;
  }
  return error;
};

/**
 * 任务公开投影。
 * 媒体可用性分层：
 * - ready：稳定 Firefly 路由（TOS 已归档，长期有效）
 * - archiving / fallback / failed：稳定入口保持关闭；上游临时源仅作为显式、可选的降级预览，
 *   前端不得自动挂载或预加载；绝不在任务对象中暴露 provider 密钥字段。
 */
export const publicTask = (
  { ownerId: _ownerId, request: _request, sourceVideoUrl, sourceVideoExpiresAt, deletedAt: _deletedAt, ...task }: StoredTask,
  {
    stableOutputReady = true,
    stablePreviewReady = false,
    stablePosterReady = false,
    outputIsPreview = true,
  }: { stableOutputReady?: boolean; stablePreviewReady?: boolean; stablePosterReady?: boolean; outputIsPreview?: boolean } = {},
) => {
  const revision = task.mediaRevision ?? 0;
  const downloadable = task.status === "succeeded" && task.mediaStatus === "ready" && stableOutputReady;
  const previewable = task.status === "succeeded" && (stablePreviewReady || (outputIsPreview && downloadable));
  const posterReady = task.status === "succeeded" && stablePosterReady;
  const posterStatus = posterReady
    ? "ready" as const
    : task.status === "succeeded" && ["archiving", "ready"].includes(task.mediaStatus ?? "none")
      ? "processing" as const
      : "unavailable" as const;
  const mediaStatus = task.status === "succeeded" && task.mediaStatus === "ready" && !stableOutputReady
    ? "archiving" as const
    : task.mediaStatus;
  const temporary =
    task.status === "succeeded" &&
    Boolean(sourceVideoUrl) &&
    !previewable &&
    (!sourceVideoExpiresAt || sourceVideoExpiresAt > Date.now());
  return {
    ...task,
    error: task.status === "failed" ? publicFailure(task.error, task.errorCode) : task.error,
    mediaStatus,
    caseId: task.id,
    videoUrl: previewable ? `/api/generations/${task.id}/media?rev=${revision}` : undefined,
    downloadUrl: downloadable ? `/api/generations/${task.id}/download?rev=${revision}` : undefined,
    posterStatus,
    posterUrl: posterReady ? `/api/generations/${task.id}/poster?rev=${revision}` : undefined,
    temporaryVideoUrl: temporary ? sourceVideoUrl : undefined,
    temporaryVideoExpiresAt: temporary ? sourceVideoExpiresAt : undefined,
    mediaSource: previewable ? ("tos" as const) : undefined
  };
};
