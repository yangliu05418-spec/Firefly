import { useMemo } from 'react';
import type { MediaFile } from '../../../stores/mediaStore/types';
import { isProxyFrameCountComplete } from '../../../stores/mediaStore/helpers/proxyCompleteness';

interface TimelineProxyBatchStatus {
  readyCount: number;
  totalCount: number;
  generatingIndex: number;
}

export function useTimelineProxyBatchStatus(
  mediaFiles: readonly MediaFile[],
  currentlyGeneratingProxyId: string | null,
): TimelineProxyBatchStatus {
  return useMemo(() => {
    const proxyableFiles = mediaFiles.filter((file) => file.type === 'video' && Boolean(file.file));
    const readyCount = proxyableFiles.filter((file) =>
      file.proxyStatus === 'ready' &&
      isProxyFrameCountComplete(file.proxyFrameCount, file.duration, file.proxyFps ?? file.fps)
    ).length;
    const generatingIndex = currentlyGeneratingProxyId
      ? proxyableFiles.findIndex((file) => file.id === currentlyGeneratingProxyId) + 1
      : 0;

    return {
      readyCount,
      totalCount: proxyableFiles.length,
      generatingIndex: generatingIndex > 0 ? generatingIndex : 0,
    };
  }, [currentlyGeneratingProxyId, mediaFiles]);
}
