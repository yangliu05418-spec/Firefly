// Legacy timeline facade for mediaRuntime-owned media element and WebCodecs helpers.

import {
  createRuntimeAudioElement,
  createRuntimeVideoElement,
  releaseRuntimeMediaElement,
} from '../../../services/mediaRuntime/mediaElementLeases';
export {
  hasWebCodecsSupport,
  initWebCodecsPlayer,
  warmUpVideoDecoder,
  waitForVideoMetadata,
  waitForVideoReady,
} from '../../../services/mediaRuntime/webCodecsPlayback';

/**
 * Create a video element with standard settings for timeline clips.
 */
export function createVideoElement(file: File): HTMLVideoElement {
  return createRuntimeVideoElement(file);
}

/**
 * Create an audio element with standard settings for timeline clips.
 */
export function createAudioElement(file: File): HTMLAudioElement {
  return createRuntimeAudioElement(file);
}

export function releaseTemporaryMediaElement(element: HTMLMediaElement): void {
  releaseRuntimeMediaElement(element);
}
