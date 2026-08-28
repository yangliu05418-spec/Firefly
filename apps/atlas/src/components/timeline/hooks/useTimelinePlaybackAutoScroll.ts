import { useEffect } from 'react';
import type { RefObject } from 'react';

interface UseTimelinePlaybackAutoScrollProps {
  duration: number;
  isDraggingPlayhead: boolean;
  isPlaying: boolean;
  playheadPosition: number;
  scrollX: number;
  setScrollX: (scrollX: number) => void;
  timeToPixel: (time: number) => number;
  timelineRef: RefObject<HTMLDivElement | null>;
  zoom: number;
}

export function useTimelinePlaybackAutoScroll({
  duration,
  isDraggingPlayhead,
  isPlaying,
  playheadPosition,
  scrollX,
  setScrollX,
  timeToPixel,
  timelineRef,
  zoom,
}: UseTimelinePlaybackAutoScrollProps) {
  useEffect(() => {
    if (!isPlaying || isDraggingPlayhead) return;

    const viewportWidth = timelineRef.current?.clientWidth;
    if (!viewportWidth || viewportWidth <= 0) return;

    const endPadding = 100;
    const playheadPixel = timeToPixel(playheadPosition);
    const viewportStart = scrollX;
    const viewportEnd = scrollX + viewportWidth;
    const maxScrollX = Math.max(0, duration * zoom - viewportWidth + endPadding);

    if (playheadPixel > viewportEnd) {
      const nextScrollX = Math.max(
        0,
        Math.min(maxScrollX, playheadPixel)
      );
      if (nextScrollX !== scrollX) {
        setScrollX(nextScrollX);
      }
      return;
    }

    if (playheadPixel < viewportStart) {
      const nextScrollX = Math.max(
        0,
        Math.min(maxScrollX, playheadPixel)
      );
      if (nextScrollX !== scrollX) {
        setScrollX(nextScrollX);
      }
    }
  }, [isPlaying, isDraggingPlayhead, playheadPosition, scrollX, zoom, duration, setScrollX, timeToPixel, timelineRef]);
}
