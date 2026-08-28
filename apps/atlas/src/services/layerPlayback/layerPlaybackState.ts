import type { Composition, SlotClipEndBehavior } from '../../stores/mediaStore/types';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';

export interface LayerCompState {
  compositionId: string;
  composition: Composition;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  duration: number;
  anchorTime: number;
  anchorStartedAt: number;
  playbackState: 'playing' | 'paused' | 'stopped';
  clearRequested: boolean;
  resourceOwnership: 'layer' | 'slot-deck';
  slotIndex: number | null;
}

export interface LayerPlaybackInfo {
  compositionId: string;
  currentTime: number;
  trimIn: number;
  trimOut: number;
  endBehavior: SlotClipEndBehavior;
  playbackState: LayerCompState['playbackState'];
  shouldRender: boolean;
}

export interface PlaybackWindow {
  trimIn: number;
  trimOut: number;
  endBehavior: SlotClipEndBehavior;
}
