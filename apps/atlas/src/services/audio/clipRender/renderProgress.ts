import type { EffectRenderProgress } from '../../../engine/audio/AudioEffectRenderer';
import type { TimeStretchProgress } from '../../../engine/audio/TimeStretchProcessor';

export type ClipAudioRenderPhase =
  | 'stem-mix'
  | 'trimming'
  | 'edit-stack'
  | 'spectral-layers'
  | 'reversing'
  | 'speed'
  | 'muting'
  | 'effects'
  | 'complete';

export interface ClipAudioRenderProgress {
  phase: ClipAudioRenderPhase;
  percent: number;
  message?: string;
  speed?: TimeStretchProgress;
  effects?: EffectRenderProgress;
}

export function emitProgress(
  onProgress: ((progress: ClipAudioRenderProgress) => void) | undefined,
  progress: ClipAudioRenderProgress,
): void {
  onProgress?.(progress);
}
