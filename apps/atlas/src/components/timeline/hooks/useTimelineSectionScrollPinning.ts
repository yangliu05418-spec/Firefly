import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type { TimelineTrackFocusMode } from '../../../stores/timeline/types';
import { clampScrollY } from '../utils/timelineHostLayout';

interface UseTimelineSectionScrollPinningProps {
  activeTrackResizeId: string | null;
  audioScrollableContentHeight: number;
  audioViewportHeight: number;
  expandedVideoSectionContentHeight: number;
  forceVideoBottomScroll: boolean;
  isAudioSectionCollapsed: boolean;
  isVideoSectionCollapsed: boolean;
  splitDragPinVideoBottom: boolean;
  splitDragVideoHeight: number | null;
  trackFocusMode: TimelineTrackFocusMode;
  trackResizePinsVideoBottom: boolean;
  videoSectionContentHeight: number;
  videoSectionHeight: number;
  videoViewportHeight: number;
  setAudioScrollY: Dispatch<SetStateAction<number>>;
  setForceVideoBottomScroll: Dispatch<SetStateAction<boolean>>;
  setVideoScrollY: Dispatch<SetStateAction<number>>;
}

export function useTimelineSectionScrollPinning({
  activeTrackResizeId,
  audioScrollableContentHeight,
  audioViewportHeight,
  expandedVideoSectionContentHeight,
  forceVideoBottomScroll,
  isAudioSectionCollapsed,
  isVideoSectionCollapsed,
  splitDragPinVideoBottom,
  splitDragVideoHeight,
  trackFocusMode,
  trackResizePinsVideoBottom,
  videoSectionContentHeight,
  videoSectionHeight,
  videoViewportHeight,
  setAudioScrollY,
  setForceVideoBottomScroll,
  setVideoScrollY,
}: UseTimelineSectionScrollPinningProps): void {
  useEffect(() => {
    const resizeReclampKey = activeTrackResizeId;
    void resizeReclampKey;

    setVideoScrollY((current) => {
      const pinVideoBottomForTrackResize = trackResizePinsVideoBottom;
      if (splitDragPinVideoBottom || forceVideoBottomScroll || pinVideoBottomForTrackResize) {
        const viewportHeight = Math.max(0, splitDragVideoHeight ?? videoSectionHeight ?? videoViewportHeight);
        const contentHeight = pinVideoBottomForTrackResize && !splitDragPinVideoBottom && !forceVideoBottomScroll
          ? videoSectionContentHeight
          : expandedVideoSectionContentHeight;
        return clampScrollY(
          contentHeight - viewportHeight,
          contentHeight,
          viewportHeight,
        );
      }

      if (isVideoSectionCollapsed) return 0;

      return clampScrollY(current, videoSectionContentHeight, videoViewportHeight);
    });
  }, [
    activeTrackResizeId,
    expandedVideoSectionContentHeight,
    forceVideoBottomScroll,
    isVideoSectionCollapsed,
    splitDragPinVideoBottom,
    splitDragVideoHeight,
    setVideoScrollY,
    trackResizePinsVideoBottom,
    videoSectionContentHeight,
    videoSectionHeight,
    videoViewportHeight,
  ]);

  useEffect(() => {
    setAudioScrollY((current) => isAudioSectionCollapsed
      ? 0
      : clampScrollY(current, audioScrollableContentHeight, audioViewportHeight));
  }, [audioScrollableContentHeight, audioViewportHeight, isAudioSectionCollapsed, setAudioScrollY]);

  useEffect(() => {
    if (trackFocusMode === 'audio' && splitDragVideoHeight === null) {
      setForceVideoBottomScroll(false);
    }
  }, [setForceVideoBottomScroll, splitDragVideoHeight, trackFocusMode]);
}
