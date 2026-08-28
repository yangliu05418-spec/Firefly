import { useCallback, useEffect, useState } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  RefObject,
} from 'react';
import { MIN_VIDEO_BAKE_DRAG_PX } from '../utils/timelineHostConstants';
import { isVideoBakeModifierPressed } from '../utils/timelineHostLayout';
import type { VideoBakeRulerDragState } from '../utils/timelineHostTypes';

interface CompositionVideoBakeSelection {
  scope: 'composition';
  startTime: number;
  endTime: number;
}

interface UseTimelineCompositionVideoBakeRulerDragProps {
  timelineRef: RefObject<HTMLDivElement | null>;
  scrollX: number;
  duration: number;
  canMarkCompositionVideoBakeRegion: boolean;
  videoBakeRegionSelection: unknown | null;
  pixelToTime: (pixel: number) => number;
  onRulerMouseDown: (event: ReactMouseEvent) => void;
  setVideoBakeRegionSelection: (selection: CompositionVideoBakeSelection) => void;
  clearVideoBakeRegionSelection: () => void;
  addCompositionVideoBakeRegion: (startTime: number, endTime: number) => void;
}

interface UseTimelineCompositionVideoBakeRulerDragReturn {
  handleTimelineRulerMouseDown: (event: ReactMouseEvent) => void;
}

export function useTimelineCompositionVideoBakeRulerDrag({
  timelineRef,
  scrollX,
  duration,
  canMarkCompositionVideoBakeRegion,
  videoBakeRegionSelection,
  pixelToTime,
  onRulerMouseDown,
  setVideoBakeRegionSelection,
  clearVideoBakeRegionSelection,
  addCompositionVideoBakeRegion,
}: UseTimelineCompositionVideoBakeRulerDragProps): UseTimelineCompositionVideoBakeRulerDragReturn {
  const [videoBakeRulerDrag, setVideoBakeRulerDrag] =
    useState<VideoBakeRulerDragState | null>(null);

  const getRulerTimeFromClientX = useCallback((clientX: number) => {
    if (!timelineRef.current) return null;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = clientX - rect.left + scrollX;
    return Math.max(0, Math.min(duration, pixelToTime(x)));
  }, [duration, pixelToTime, scrollX, timelineRef]);

  const handleTimelineRulerMouseDown = useCallback((event: ReactMouseEvent) => {
    if (
      event.button === 0 &&
      canMarkCompositionVideoBakeRegion &&
      isVideoBakeModifierPressed(event)
    ) {
      event.preventDefault();
      event.stopPropagation();
      const startTime = getRulerTimeFromClientX(event.clientX);
      if (startTime === null) return;
      setVideoBakeRulerDrag({
        startTime,
        startClientX: event.clientX,
      });
      clearVideoBakeRegionSelection();
      return;
    }

    onRulerMouseDown(event);
  }, [
    canMarkCompositionVideoBakeRegion,
    clearVideoBakeRegionSelection,
    getRulerTimeFromClientX,
    onRulerMouseDown,
  ]);

  useEffect(() => {
    if (!videoBakeRulerDrag) return;

    const handleMouseMove = (event: MouseEvent) => {
      const currentTime = getRulerTimeFromClientX(event.clientX);
      if (currentTime === null) return;
      setVideoBakeRegionSelection({
        scope: 'composition',
        startTime: videoBakeRulerDrag.startTime,
        endTime: currentTime,
      });
    };

    const handleMouseUp = (event: MouseEvent) => {
      const currentTime = getRulerTimeFromClientX(event.clientX);
      const draggedFarEnough =
        Math.abs(event.clientX - videoBakeRulerDrag.startClientX) >= MIN_VIDEO_BAKE_DRAG_PX;
      if (currentTime !== null && draggedFarEnough) {
        addCompositionVideoBakeRegion(videoBakeRulerDrag.startTime, currentTime);
      }
      clearVideoBakeRegionSelection();
      setVideoBakeRulerDrag(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp, { once: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    addCompositionVideoBakeRegion,
    clearVideoBakeRegionSelection,
    getRulerTimeFromClientX,
    setVideoBakeRegionSelection,
    videoBakeRulerDrag,
  ]);

  useEffect(() => {
    if (!videoBakeRegionSelection) return;

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.clip-video-bake-region')) return;
      if (target.closest('.timeline-video-bake-region')) return;
      if (target.closest('.timeline-ruler-video-bake-region')) return;
      if (target.closest('.time-ruler')) return;

      clearVideoBakeRegionSelection();
    };

    document.addEventListener('mousedown', handleDocumentMouseDown, true);
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown, true);
    };
  }, [clearVideoBakeRegionSelection, videoBakeRegionSelection]);

  return { handleTimelineRulerMouseDown };
}
