import { useCallback } from 'react';

import type { TimelineTrackFocusMode } from '../../../stores/timeline/types';

interface UseTimelineTrackFocusStepProps {
  trackFocusMode: TimelineTrackFocusMode;
  setTrackFocusMode: (mode: TimelineTrackFocusMode) => void;
}

export function useTimelineTrackFocusStep({
  trackFocusMode,
  setTrackFocusMode,
}: UseTimelineTrackFocusStepProps): (direction: 'up' | 'down') => void {
  return useCallback((direction: 'up' | 'down') => {
    const focusOrder: TimelineTrackFocusMode[] = ['audio', 'balanced', 'video'];
    const currentIndex = focusOrder.indexOf(trackFocusMode);
    const nextIndex = direction === 'up'
      ? Math.max(0, currentIndex - 1)
      : Math.min(focusOrder.length - 1, currentIndex + 1);
    setTrackFocusMode(focusOrder[nextIndex]);
  }, [setTrackFocusMode, trackFocusMode]);
}
