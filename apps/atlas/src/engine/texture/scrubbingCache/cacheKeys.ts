export const SCRUB_CACHE_FPS = 30;

export function quantizeToFrame(time: number): string {
  return (Math.round(time * SCRUB_CACHE_FPS) / SCRUB_CACHE_FPS).toFixed(3);
}

export function frameIndexForTime(time: number): number {
  return Math.round(time * SCRUB_CACHE_FPS);
}

export function getScrubbingKey(videoSrc: string, time: number): string {
  return `${videoSrc}:${quantizeToFrame(time)}`;
}

export function getScrubbingKeyForFrame(videoSrc: string, frameIndex: number): string {
  return getScrubbingKey(videoSrc, frameIndex / SCRUB_CACHE_FPS);
}

export function getScrubbingKeyTime(key: string): number {
  const index = key.lastIndexOf(':');
  if (index === -1) {
    return 0;
  }
  const parsed = Number(key.slice(index + 1));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function quantizeTime(time: number): number {
  return Math.round(time * SCRUB_CACHE_FPS) / SCRUB_CACHE_FPS;
}
