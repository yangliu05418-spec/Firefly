import type { TimelineClip, TimelineTrack } from '../../types';
import { applyClipDragPreview } from '../../stores/timeline/clipDragPreview';

type ClipDragPreviewInput = Parameters<typeof applyClipDragPreview>[1];

function getVisibleVideoTrackIds(tracks: readonly TimelineTrack[] = []): Set<string> {
  const videoTracks = tracks.filter(track => track.type === 'video' && track.visible !== false);
  const hasSolo = videoTracks.some(track => track.solo);

  return new Set(
    videoTracks
      .filter(track => !hasSolo || track.solo)
      .map(track => track.id)
  );
}

export function hasActiveTimelineVisualClip(
  clips: readonly TimelineClip[] = [],
  tracks: readonly TimelineTrack[] = [],
  playheadPosition: number
): boolean {
  const visibleVideoTrackIds = getVisibleVideoTrackIds(tracks);
  if (visibleVideoTrackIds.size === 0) return false;

  const epsilon = 1e-6;
  return clips.some(clip =>
    visibleVideoTrackIds.has(clip.trackId) &&
    playheadPosition + epsilon >= clip.startTime &&
    playheadPosition < clip.startTime + clip.duration
  );
}

export function hasTimelineVisualRenderDemand(input: {
  clips?: readonly TimelineClip[];
  tracks?: readonly TimelineTrack[];
  playheadPosition: number;
  clipDragPreview?: ClipDragPreviewInput | null;
}): boolean {
  const inputClips = input.clips ?? [];
  const clips = input.clipDragPreview
    ? applyClipDragPreview(inputClips as TimelineClip[], input.clipDragPreview)
    : inputClips;

  return hasActiveTimelineVisualClip(clips, input.tracks ?? [], input.playheadPosition);
}
