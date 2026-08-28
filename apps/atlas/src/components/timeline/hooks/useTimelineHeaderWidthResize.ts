import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  MIN_TRACK_HEADER_WIDTH,
  MAX_TRACK_HEADER_WIDTH,
} from '../../../stores/timeline/constants';
import type { TrackHeaderWidthDragState } from '../utils/timelineHostTypes';

interface UseTimelineHeaderWidthResizeProps {
  trackHeaderWidth: number;
  setTrackHeaderWidth: (width: number) => void;
}

interface UseTimelineHeaderWidthResizeReturn {
  isTrackHeaderWidthResizing: boolean;
  handleTrackHeaderWidthResizeStart: (e: ReactPointerEvent) => void;
}

export function useTimelineHeaderWidthResize({
  trackHeaderWidth,
  setTrackHeaderWidth,
}: UseTimelineHeaderWidthResizeProps): UseTimelineHeaderWidthResizeReturn {
  const trackHeaderWidthDragRef = useRef<TrackHeaderWidthDragState | null>(null);
  const trackHeaderWidthFrameRef = useRef<number | null>(null);
  const trackHeaderWidthPendingClientXRef = useRef<number | null>(null);
  const [isTrackHeaderWidthResizing, setIsTrackHeaderWidthResizing] = useState(false);

  const handleTrackHeaderWidthResizeStart = useCallback((e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    trackHeaderWidthDragRef.current = {
      startX: e.clientX,
      startWidth: trackHeaderWidth,
    };
    setIsTrackHeaderWidthResizing(true);
  }, [trackHeaderWidth]);

  useEffect(() => {
    if (!isTrackHeaderWidthResizing) return undefined;

    const applyTrackHeaderWidth = (clientX: number) => {
      const drag = trackHeaderWidthDragRef.current;
      if (!drag) return;

      setTrackHeaderWidth(Math.max(
        MIN_TRACK_HEADER_WIDTH,
        Math.min(MAX_TRACK_HEADER_WIDTH, drag.startWidth + clientX - drag.startX),
      ));
    };

    const handlePointerMove = (event: PointerEvent) => {
      trackHeaderWidthPendingClientXRef.current = event.clientX;
      if (trackHeaderWidthFrameRef.current !== null) return;

      trackHeaderWidthFrameRef.current = window.requestAnimationFrame(() => {
        trackHeaderWidthFrameRef.current = null;
        const pendingClientX = trackHeaderWidthPendingClientXRef.current;
        trackHeaderWidthPendingClientXRef.current = null;
        if (pendingClientX !== null) {
          applyTrackHeaderWidth(pendingClientX);
        }
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (Number.isFinite(event.clientX)) {
        applyTrackHeaderWidth(event.clientX);
      }
      if (trackHeaderWidthFrameRef.current !== null) {
        window.cancelAnimationFrame(trackHeaderWidthFrameRef.current);
        trackHeaderWidthFrameRef.current = null;
      }
      trackHeaderWidthPendingClientXRef.current = null;
      trackHeaderWidthDragRef.current = null;
      setIsTrackHeaderWidthResizing(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
    window.addEventListener('pointercancel', handlePointerUp, { once: true });

    return () => {
      if (trackHeaderWidthFrameRef.current !== null) {
        window.cancelAnimationFrame(trackHeaderWidthFrameRef.current);
        trackHeaderWidthFrameRef.current = null;
      }
      trackHeaderWidthPendingClientXRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isTrackHeaderWidthResizing, setTrackHeaderWidth]);

  return {
    isTrackHeaderWidthResizing,
    handleTrackHeaderWidthResizeStart,
  };
}
