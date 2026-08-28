import type { RuntimeFrameProvider } from '../mediaRuntime/types';

const DEFAULT_REVERSE_PLAYBACK_FRAME_RATE = 30;
const REVERSE_PLAYBACK_SEEK_FRAME_FRACTION = 0.45;

export function shouldSeekReversePlaybackProvider(
  provider: RuntimeFrameProvider | null | undefined,
  targetTime: number,
): boolean {
  if (!provider) return false;

  const frameRate = provider.getFrameRate?.() ?? DEFAULT_REVERSE_PLAYBACK_FRAME_RATE;
  const frameInterval = frameRate > 0 ? 1 / frameRate : 1 / DEFAULT_REVERSE_PLAYBACK_FRAME_RATE;
  const seekThreshold = frameInterval * REVERSE_PLAYBACK_SEEK_FRAME_FRACTION;
  const pendingTarget = provider.getPendingSeekTime?.();
  if (
    typeof pendingTarget === 'number' &&
    Number.isFinite(pendingTarget) &&
    Math.abs(pendingTarget - targetTime) < seekThreshold
  ) {
    return false;
  }

  const debugFrameTime = provider.getDebugInfo?.()?.currentFrameTimestampSeconds;
  const displayedFrameTime =
    typeof debugFrameTime === 'number' && Number.isFinite(debugFrameTime)
      ? debugFrameTime
      : provider.hasFrame?.() === true
        ? provider.currentTime
        : null;
  if (
    typeof displayedFrameTime === 'number' &&
    Math.abs(displayedFrameTime - targetTime) < frameInterval * 0.5
  ) {
    return false;
  }

  return true;
}
