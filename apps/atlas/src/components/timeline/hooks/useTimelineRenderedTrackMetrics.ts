import { useCallback, useMemo } from 'react';

import type { AnimatableProperty, Keyframe, TimelineClip, TimelineTrack } from '../../../types';
import type { TimelineAudioDisplayMode } from '../../../stores/timeline/types';
import { getTimelineTrackBaseHeight } from '../utils/timelineAudioLayout';

interface UseTimelineRenderedTrackMetricsParams {
  audioDisplayMode: TimelineAudioDisplayMode;
  audioFocusMode: boolean;
  clipKeyframes: Map<string, Keyframe[]>;
  clips: TimelineClip[];
  expandedCurveProperties: Map<string, Set<AnimatableProperty>>;
  getExpandedTrackHeight: (trackId: string, baseHeight: number) => number;
  isTrackExpandedForRender: (trackId: string) => boolean;
  selectedClipIds: Set<string>;
  timelineViewTracks: TimelineTrack[];
  tracks: TimelineTrack[];
}

export function useTimelineRenderedTrackMetrics({
  audioDisplayMode,
  audioFocusMode,
  clipKeyframes,
  clips,
  expandedCurveProperties,
  getExpandedTrackHeight,
  isTrackExpandedForRender,
  selectedClipIds,
  timelineViewTracks,
  tracks,
}: UseTimelineRenderedTrackMetricsParams) {
  const clipMap = useMemo(() => new Map(clips.map((clip) => [clip.id, clip])), [clips]);
  const trackMap = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  const timelineViewTrackMap = useMemo(
    () => new Map(timelineViewTracks.map((track) => [track.id, track])),
    [timelineViewTracks],
  );
  const keyframeLayoutInputs = useMemo(
    () => ({
      selectedClipIds,
      clipKeyframes,
      expandedCurveProperties,
    }),
    [clipKeyframes, expandedCurveProperties, selectedClipIds],
  );
  const getRenderedTrackBaseHeight = useCallback(
    (track: TimelineTrack) => getTimelineTrackBaseHeight(track, audioDisplayMode, audioFocusMode),
    [audioDisplayMode, audioFocusMode],
  );
  const getRenderedTrackHeight = useCallback(
    (trackId: string, fallbackBaseHeight: number) => {
      // getExpandedTrackHeight reads keyframe UI state from the store; this keeps memoized layout users fresh.
      void keyframeLayoutInputs;
      const track = timelineViewTrackMap.get(trackId) ?? trackMap.get(trackId);
      const baseHeight = track ? getRenderedTrackBaseHeight(track) : fallbackBaseHeight;
      return isTrackExpandedForRender(trackId)
        ? getExpandedTrackHeight(trackId, baseHeight)
        : baseHeight;
    },
    [timelineViewTrackMap, trackMap, getRenderedTrackBaseHeight, isTrackExpandedForRender, getExpandedTrackHeight, keyframeLayoutInputs],
  );
  const getRenderedTrackHeightForTrack = useCallback(
    (track: TimelineTrack) => getRenderedTrackHeight(track.id, track.height),
    [getRenderedTrackHeight],
  );
  const isClipLocked = useCallback((clipId: string) => {
    const clip = clipMap.get(clipId);
    return !!clip && trackMap.get(clip.trackId)?.locked === true;
  }, [clipMap, trackMap]);

  return {
    clipMap,
    getRenderedTrackBaseHeight,
    getRenderedTrackHeight,
    getRenderedTrackHeightForTrack,
    isClipLocked,
    keyframeLayoutInputs,
    timelineViewTrackMap,
    trackMap,
  };
}
