import type { StoredTask } from "./db.js";
import { classifyProviderError, providerPublicMessage } from "./provider.js";
import type { PublicLocalMediaDescriptor } from "./local-media-public.js";

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
 * - archiving / fallback / failed：预览仍只使用稳定 TOS；临时源和 TOS 原片使用两个
 *   明确分离的受保护入口，禁止同一下载地址静默切换数据源。
 */
export const publicTask = (
  { ownerId: _ownerId, request: _request, sourceVideoUrl, sourceVideoExpiresAt, deletedAt: _deletedAt, ...task }: StoredTask,
  {
    stableOutputReady = true,
    stablePreviewReady = false,
    stablePosterReady = false,
    outputIsPreview = true,
    localMedia,
  }: { stableOutputReady?: boolean; stablePreviewReady?: boolean; stablePosterReady?: boolean; outputIsPreview?: boolean; localMedia?: { preview?: PublicLocalMediaDescriptor; poster?: PublicLocalMediaDescriptor; original?: PublicLocalMediaDescriptor } } = {},
) => {
  const revision = task.mediaRevision ?? 0;
  const downloadable = task.status === "succeeded" && task.mediaStatus === "ready" && stableOutputReady;
  const temporaryOriginalAvailable = task.status === "succeeded" && Boolean(sourceVideoUrl)
    && (!sourceVideoExpiresAt || sourceVideoExpiresAt > Date.now());
  const previewable = task.status === "succeeded" && (stablePreviewReady || (outputIsPreview && downloadable));
  const previewStatus = previewable
    ? "ready" as const
    : task.status === "succeeded" && (temporaryOriginalAvailable || downloadable || task.mediaStatus === "archiving")
      ? "processing" as const
      : "unavailable" as const;
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
    temporaryOriginalAvailable &&
    !previewable &&
    Boolean(sourceVideoUrl);
  return {
    ...task,
    error: task.status === "failed" ? publicFailure(task.error, task.errorCode) : task.error,
    mediaStatus,
    caseId: task.id,
    videoUrl: previewable ? `/api/generations/${task.id}/media?rev=${revision}` : undefined,
    downloadUrl: downloadable ? `/api/generations/${task.id}/download?rev=${revision}` : undefined,
    immediateDownloadUrl: temporaryOriginalAvailable ? `/api/generations/${task.id}/download/temporary` : undefined,
    originalDownloadStatus: downloadable ? "ready" as const : temporaryOriginalAvailable ? "archiving" as const : "unavailable" as const,
    originalArchiveStatus: downloadable ? "ready" as const : temporaryOriginalAvailable ? "archiving" as const : "unavailable" as const,
    previewStatus,
    posterStatus,
    posterUrl: posterReady ? `/api/generations/${task.id}/poster?rev=${revision}` : undefined,
    localMedia,
    temporaryVideoUrl: temporary ? sourceVideoUrl : undefined,
    temporaryVideoExpiresAt: temporary ? sourceVideoExpiresAt : undefined,
    mediaSource: previewable ? ("tos" as const) : undefined
  };
};
