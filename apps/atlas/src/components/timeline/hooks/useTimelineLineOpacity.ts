import { useCallback } from 'react';

interface UseTimelineLineOpacityProps {
  timelinePointerX: number | null;
  scrollX: number;
  trackHeaderWidth: number;
  timeToPixel: (time: number) => number;
}

interface UseTimelineLineOpacityReturn {
  getTimelineLineOpacity: (lineLeft: number) => number;
  getTimelineLineOpacityForTime: (time: number | null) => number;
}

export function useTimelineLineOpacity({
  timelinePointerX,
  scrollX,
  trackHeaderWidth,
  timeToPixel,
}: UseTimelineLineOpacityProps): UseTimelineLineOpacityReturn {
  const getTimelineLineOpacity = useCallback((lineLeft: number) => {
    if (timelinePointerX === null) {
      return 0;
    }

    const distance = Math.abs(timelinePointerX - lineLeft);
    const fullOpacityDistance = 8;
    const hiddenDistance = 72;
    if (distance <= fullOpacityDistance) {
      return 1;
    }
    if (distance >= hiddenDistance) {
      return 0;
    }

    return 1 - ((distance - fullOpacityDistance) / (hiddenDistance - fullOpacityDistance));
  }, [timelinePointerX]);

  const getTimelineLineOpacityForTime = useCallback((time: number | null) => {
    if (time === null) {
      return 0;
    }
    return getTimelineLineOpacity(timeToPixel(time) - scrollX + trackHeaderWidth);
  }, [getTimelineLineOpacity, scrollX, timeToPixel, trackHeaderWidth]);

  return {
    getTimelineLineOpacity,
    getTimelineLineOpacityForTime,
  };
}
