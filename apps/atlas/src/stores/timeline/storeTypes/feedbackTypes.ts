import type { MarkerMIDIBinding } from '../../../types/midi';

export type AIActionOverlayType =
  | 'split-glow'
  | 'delete-ghost'
  | 'trim-highlight'
  | 'silent-zone'
  | 'low-quality-zone';

export interface AIActionOverlay {
  id: string;
  type: AIActionOverlayType;
  trackId: string;
  timePosition: number;
  width?: number;
  clipName?: string;
  clipColor?: string;
  createdAt: number;
  duration: number;
  animationDelay?: number;
}

export interface AIMovingClip {
  clipId: string;
  fromStartTime: number;
  animationDuration: number;
  startedAt: number;
}

export interface PlaybackWarmupState {
  requestId: string;
  startedAt: number;
  targetTime: number;
  pendingVideoCount: number;
  totalVideoCount: number;
}

export interface TimelineMarker {
  id: string;
  time: number;
  label: string;
  color: string;
  stopPlayback?: boolean;
  midiBindings?: MarkerMIDIBinding[];
}
