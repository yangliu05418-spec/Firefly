import { FRAME_TOLERANCE } from '../../stores/timeline/constants';
import type { TimelineClip } from '../../types/timeline';
import { peekRuntimeFrameProvider } from '../mediaRuntime/runtimePlayback';

export interface RamPreviewTimeDeps {
  getSourceTimeForClip: (clipId: string, localTime: number) => number;
  getInterpolatedSpeed: (clipId: string, time: number) => number;
}

export function getRamPreviewClipTime(
  clip: TimelineClip,
  timelineTime: number,
  deps: RamPreviewTimeDeps
): number {
  const clipLocalTime = timelineTime - clip.startTime;
  const sourceTime = deps.getSourceTimeForClip(clip.id, clipLocalTime);
  const initialSpeed = deps.getInterpolatedSpeed(clip.id, 0);
  const startPoint = initialSpeed >= 0 ? clip.inPoint : clip.outPoint;
  return Math.max(clip.inPoint, Math.min(clip.outPoint, startPoint + sourceTime));
}

export function getNestedRamPreviewClipTime(
  compositionTime: number,
  nestedClip: TimelineClip
): number {
  const nestedLocalTime = compositionTime - nestedClip.startTime;
  return nestedClip.reversed
    ? nestedClip.outPoint - nestedLocalTime
    : nestedLocalTime + nestedClip.inPoint;
}

export function verifyRamPreviewVideoPositions(
  timelineTime: number,
  clipsAtTime: TimelineClip[],
  deps: RamPreviewTimeDeps,
  getRuntimeSource: (clip: TimelineClip) => TimelineClip['source']
): boolean {
  for (const clip of clipsAtTime) {
    if (clip.source?.type !== 'video' || !clip.source.videoElement) continue;

    const video = clip.source.videoElement;
    const runtimeProvider = peekRuntimeFrameProvider(getRuntimeSource(clip));
    const expectedTime = getRamPreviewClipTime(clip, timelineTime, deps);
    const actualTime = runtimeProvider?.isFullMode()
      ? runtimeProvider.currentTime
      : video.currentTime;

    if (Math.abs(actualTime - expectedTime) > FRAME_TOLERANCE) {
      return false;
    }
  }
  return true;
}
