import { useCallback } from 'react';
import type { DragEvent, RefObject } from 'react';

import type { TimelineTrack } from '../../../types';

interface UseTimelineCombinedDragHandlersProps {
  isExporting: boolean;
  trackMap: Map<string, TimelineTrack>;
  timelineRef: RefObject<HTMLDivElement | null>;
  scrollX: number;
  pixelToTime: (pixel: number) => number;
  isTransitionDrag: (event: DragEvent) => boolean;
  onTransitionDragOver: (event: DragEvent, trackId: string, mouseTime: number) => void;
  onTransitionDrop: (event: DragEvent, trackId: string, mouseTime: number) => void;
  onTransitionDragLeave: () => void;
  onTrackDragOver: (event: DragEvent, trackId: string) => void;
  onTrackDrop: (event: DragEvent, trackId: string) => void | Promise<void>;
  onTrackDragLeave: (event: DragEvent) => void;
}

interface UseTimelineCombinedDragHandlersReturn {
  handleCombinedDragOver: (event: DragEvent, trackId: string) => void;
  handleCombinedDrop: (event: DragEvent, trackId: string) => void;
  handleCombinedDragLeave: (event: DragEvent) => void;
}

function blockTrackDrop(event: DragEvent): void {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'none';
}

export function useTimelineCombinedDragHandlers({
  isExporting,
  trackMap,
  timelineRef,
  scrollX,
  pixelToTime,
  isTransitionDrag,
  onTransitionDragOver,
  onTransitionDrop,
  onTransitionDragLeave,
  onTrackDragOver,
  onTrackDrop,
  onTrackDragLeave,
}: UseTimelineCombinedDragHandlersProps): UseTimelineCombinedDragHandlersReturn {
  const getTransitionDropTime = useCallback((event: DragEvent) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return null;

    return pixelToTime(event.clientX - rect.left + scrollX);
  }, [pixelToTime, scrollX, timelineRef]);

  const isTrackDropBlocked = useCallback((event: DragEvent, trackId: string) => {
    if (isExporting || trackMap.get(trackId)?.locked) {
      blockTrackDrop(event);
      return true;
    }

    return false;
  }, [isExporting, trackMap]);

  const handleCombinedDragOver = useCallback((event: DragEvent, trackId: string) => {
    if (isTrackDropBlocked(event, trackId)) return;

    if (isTransitionDrag(event)) {
      const mouseTime = getTransitionDropTime(event);
      if (mouseTime !== null) {
        onTransitionDragOver(event, trackId, mouseTime);
      }
      return;
    }

    onTrackDragOver(event, trackId);
  }, [getTransitionDropTime, isTrackDropBlocked, isTransitionDrag, onTrackDragOver, onTransitionDragOver]);

  const handleCombinedDrop = useCallback((event: DragEvent, trackId: string) => {
    if (isTrackDropBlocked(event, trackId)) return;

    if (isTransitionDrag(event)) {
      const mouseTime = getTransitionDropTime(event);
      if (mouseTime !== null) {
        onTransitionDrop(event, trackId, mouseTime);
      }
      return;
    }

    void onTrackDrop(event, trackId);
  }, [getTransitionDropTime, isTrackDropBlocked, isTransitionDrag, onTrackDrop, onTransitionDrop]);

  const handleCombinedDragLeave = useCallback((event: DragEvent) => {
    onTransitionDragLeave();
    onTrackDragLeave(event);
  }, [onTrackDragLeave, onTransitionDragLeave]);

  return {
    handleCombinedDragOver,
    handleCombinedDrop,
    handleCombinedDragLeave,
  };
}
