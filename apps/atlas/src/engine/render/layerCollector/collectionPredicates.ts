import type { Layer } from '../../core/types';

export type WebCodecsFrameProvider = NonNullable<
  NonNullable<Layer['source']>['webCodecsPlayer']
>;

export function isCollectableLayer(layer: Layer | null | undefined): layer is Layer {
  return !!layer?.visible && !!layer.source && layer.opacity !== 0;
}

export function getLayerReuseKey(layer: Layer): string {
  return layer.sourceClipId ? `${layer.id}:${layer.sourceClipId}` : layer.id;
}

export function isPendingWebCodecsFrameStable(
  provider: WebCodecsFrameProvider | undefined
): boolean {
  if (!provider) {
    return true;
  }

  const pendingTarget = provider.getPendingSeekTime?.();
  if (pendingTarget == null) {
    return true;
  }

  const fps = provider.getFrameRate?.() ?? 30;
  const tolerance = Math.max(1.5 / Math.max(fps, 1), 0.05);
  return Math.abs(pendingTarget - provider.currentTime) <= tolerance;
}

export function isFrameNearTarget(
  frame: { mediaTime?: number } | null | undefined,
  targetTime: number,
  maxDeltaSeconds: number = 0.35
): boolean {
  return (
    typeof frame?.mediaTime === 'number' &&
    Number.isFinite(frame.mediaTime) &&
    Math.abs(frame.mediaTime - targetTime) <= maxDeltaSeconds
  );
}

export function getTargetVideoTime(layer: Layer, video: HTMLVideoElement): number {
  return layer.source?.mediaTime ?? video.currentTime;
}

export function getFrameTimestampSeconds(
  timestamp: unknown,
  fallback?: number
): number | undefined {
  return typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? timestamp / 1_000_000
    : fallback;
}

export function isPlaybackStartupWarmupActive(
  provider: WebCodecsFrameProvider | null | undefined
): boolean {
  return (
    !!provider &&
    'isPlaybackStartupWarmupActive' in provider &&
    typeof provider.isPlaybackStartupWarmupActive === 'function' &&
    provider.isPlaybackStartupWarmupActive() === true
  );
}

export function getWebCodecsFrameToleranceSeconds(
  provider: WebCodecsFrameProvider | null,
  isPlaying: boolean,
  isDragging: boolean
): number {
  const startupWarmupActive =
    isPlaying &&
    isPlaybackStartupWarmupActive(provider);
  const frameRate = provider?.getFrameRate?.() ?? 30;
  const frameWindow = isDragging ? 12 : startupWarmupActive ? 18 : isPlaying ? 8 : 4;
  const minTolerance = isDragging ? 0.2 : startupWarmupActive ? 0.2 : isPlaying ? 0.12 : 0.06;
  const maxTolerance = isDragging ? 1.2 : startupWarmupActive ? 0.65 : isPlaying ? 0.35 : 0.18;

  return Math.max(
    minTolerance,
    Math.min(maxTolerance, frameWindow / Math.max(frameRate, 1))
  );
}

export function isAcceptableWebCodecsFrame(
  displayedMediaTime: number | undefined,
  targetMediaTime: number | undefined,
  provider: WebCodecsFrameProvider | null,
  options: {
    isPlaying: boolean;
    isDragging: boolean;
  }
): boolean {
  if (
    typeof displayedMediaTime !== 'number' ||
    !Number.isFinite(displayedMediaTime) ||
    typeof targetMediaTime !== 'number' ||
    !Number.isFinite(targetMediaTime)
  ) {
    return true;
  }

  const tolerance = getWebCodecsFrameToleranceSeconds(
    provider,
    options.isPlaying,
    options.isDragging
  );
  return Math.abs(displayedMediaTime - targetMediaTime) <= tolerance;
}

export function isSeverelyStaleForCurrentTarget(
  displayedMediaTime: number | undefined,
  targetMediaTime: number | undefined,
  isDragging: boolean
): boolean {
  return (
    !isDragging &&
    typeof displayedMediaTime === 'number' &&
    typeof targetMediaTime === 'number' &&
    Number.isFinite(displayedMediaTime) &&
    Number.isFinite(targetMediaTime) &&
    Math.abs(displayedMediaTime - targetMediaTime) > 2
  );
}

export function isPlaybackHtmlLiveFrameUsable(
  layer: Layer,
  video: HTMLVideoElement
): boolean {
  const targetTime = layer.source?.mediaTime;
  if (
    typeof targetTime !== 'number' ||
    !Number.isFinite(targetTime) ||
    !Number.isFinite(video.currentTime) ||
    video.videoWidth <= 0 ||
    video.videoHeight <= 0
  ) {
    return false;
  }

  const maxDrift = video.paused ? 0.12 : 0.35;
  return Math.abs(video.currentTime - targetTime) <= maxDrift;
}
