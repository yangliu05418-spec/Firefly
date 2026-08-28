import { useMemo } from 'react';

interface PreviewSize {
  width: number;
  height: number;
}

interface PlaybackWarmupSnapshot {
  pendingVideoCount?: number;
}

interface UsePreviewPlaybackDisplayOptions {
  canvasSize: PreviewSize;
  containerSize: PreviewSize;
  exportPreviewFrame: ImageBitmap | null;
  isEngineReady: boolean;
  playbackWarmup: PlaybackWarmupSnapshot | null;
  sourceMonitorActive: boolean;
}

interface PreviewPlaybackDisplayState {
  exportPreviewDisplaySize: PreviewSize;
  playbackWaiterVideoCount: number;
  showPlaybackWaiter: boolean;
}

export function usePreviewPlaybackDisplay({
  canvasSize,
  containerSize,
  exportPreviewFrame,
  isEngineReady,
  playbackWarmup,
  sourceMonitorActive,
}: UsePreviewPlaybackDisplayOptions): PreviewPlaybackDisplayState {
  const exportPreviewDisplaySize = useMemo(() => {
    if (!exportPreviewFrame || containerSize.width <= 0 || containerSize.height <= 0) {
      return canvasSize;
    }

    const frameAspect = exportPreviewFrame.width / Math.max(1, exportPreviewFrame.height);
    const containerAspect = containerSize.width / Math.max(1, containerSize.height);
    if (containerAspect > frameAspect) {
      const height = containerSize.height;
      return { width: Math.floor(height * frameAspect), height: Math.floor(height) };
    }

    const width = containerSize.width;
    return { width: Math.floor(width), height: Math.floor(width / frameAspect) };
  }, [
    canvasSize,
    containerSize.height,
    containerSize.width,
    exportPreviewFrame,
  ]);

  const showPlaybackWaiter = Boolean(
    isEngineReady &&
    !sourceMonitorActive &&
    playbackWarmup
  );
  const playbackWaiterVideoCount = playbackWarmup?.pendingVideoCount ?? 0;

  return {
    exportPreviewDisplaySize,
    playbackWaiterVideoCount,
    showPlaybackWaiter,
  };
}
