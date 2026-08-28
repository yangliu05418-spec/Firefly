import { playheadState } from '../../../../services/layerBuilder';
import type { CompositionSwitchOptions } from '../compositionSlice';

export function resolvePlayStartTime(options?: CompositionSwitchOptions): number {
  const requested = options?.playFromTime;
  return typeof requested === 'number' && Number.isFinite(requested)
    ? Math.max(0, requested)
    : 0;
}

export function resetPlaybackClockForCompositionStart(playStartTime: number): void {
  playheadState.position = playStartTime;
  playheadState.hasMasterAudio = false;
  playheadState.masterAudioElement = null;
  playheadState.masterAudioClock = null;
  playheadState.playbackJustStarted = true;
}
