import { useCallback, useMemo } from 'react';

import type { TimelineTrack as TimelineTrackType } from '../../../types';
import { isAudioSectionTrackType } from '../utils/trackSection';

interface UseTimelineTrackVisibilityStateProps {
  tracks: TimelineTrackType[];
  timelineViewTracks: TimelineTrackType[];
}

interface UseTimelineTrackVisibilityStateReturn {
  videoTracks: TimelineTrackType[];
  audioTracks: TimelineTrackType[];
  anyViewVideoSolo: boolean;
  anyViewAudioSolo: boolean;
  isVideoTrackVisible: (track: TimelineTrackType) => boolean;
  isAudioTrackMuted: (track: TimelineTrackType) => boolean;
}

export function useTimelineTrackVisibilityState({
  tracks,
  timelineViewTracks,
}: UseTimelineTrackVisibilityStateProps): UseTimelineTrackVisibilityStateReturn {
  const { videoTracks, audioTracks, anyVideoSolo, anyAudioSolo } = useMemo(() => {
    const nextVideoTracks = tracks.filter(track => track.type === 'video');
    const nextAudioTracks = tracks.filter(track => isAudioSectionTrackType(track.type));

    return {
      videoTracks: nextVideoTracks,
      audioTracks: nextAudioTracks,
      anyVideoSolo: nextVideoTracks.some(track => track.solo),
      anyAudioSolo: nextAudioTracks.some(track => track.solo),
    };
  }, [tracks]);

  const { anyViewVideoSolo, anyViewAudioSolo } = useMemo(() => {
    const viewVideoTracks = timelineViewTracks.filter(track => track.type === 'video');
    const viewAudioTracks = timelineViewTracks.filter(track => isAudioSectionTrackType(track.type));

    return {
      anyViewVideoSolo: viewVideoTracks.some(track => track.solo),
      anyViewAudioSolo: viewAudioTracks.some(track => track.solo),
    };
  }, [timelineViewTracks]);

  const isVideoTrackVisible = useCallback((track: TimelineTrackType) => {
    if (!track.visible) return false;
    if (anyVideoSolo) return track.solo;
    return true;
  }, [anyVideoSolo]);

  const isAudioTrackMuted = useCallback((track: TimelineTrackType) => {
    if (track.muted) return true;
    if (anyAudioSolo) return !track.solo;
    return false;
  }, [anyAudioSolo]);

  return {
    videoTracks,
    audioTracks,
    anyViewVideoSolo,
    anyViewAudioSolo,
    isVideoTrackVisible,
    isAudioTrackMuted,
  };
}
