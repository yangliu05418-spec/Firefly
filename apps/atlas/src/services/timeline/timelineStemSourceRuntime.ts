import type { TimelineClip } from '../../types';
import { audioRoutingManager } from '../audioRoutingManager';
import { clearMasterAudio, playheadState } from '../layerBuilder/PlayheadState';

export function getTimelineStemSourceAudioElement(
  clip: Pick<TimelineClip, 'source'>,
): HTMLAudioElement | HTMLVideoElement | undefined {
  return clip.source?.audioElement;
}

export function disposeTimelineStemSourceAudioElement(
  element: HTMLAudioElement | HTMLVideoElement | undefined,
): void {
  if (!element) return;
  try {
    element.pause();
  } catch {
    // Ignore media element teardown errors.
  }
  audioRoutingManager.disposeRoute(element);
  if (playheadState.masterAudioElement === element) {
    clearMasterAudio();
  }
}
