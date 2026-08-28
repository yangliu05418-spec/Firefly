import type { Composition } from '../../stores/mediaStore/types';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import type { LayerCompState } from './layerPlaybackState';

interface CreateActiveLayerStateInput {
  compositionId: string;
  composition: Composition;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  duration: number;
  initialTime: number;
  nowMs: number;
  resourceOwnership: LayerCompState['resourceOwnership'];
  slotIndex: number | null;
}

export function createActiveLayerState({
  compositionId,
  composition,
  clips,
  tracks,
  duration,
  initialTime,
  nowMs,
  resourceOwnership,
  slotIndex,
}: CreateActiveLayerStateInput): LayerCompState {
  return {
    compositionId,
    composition,
    clips,
    tracks,
    duration,
    anchorTime: initialTime,
    anchorStartedAt: nowMs,
    playbackState: 'playing',
    clearRequested: false,
    resourceOwnership,
    slotIndex,
  };
}
