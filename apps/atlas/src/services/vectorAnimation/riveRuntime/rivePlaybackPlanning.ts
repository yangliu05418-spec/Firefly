// rivePlaybackPlanning - Pure timeline-time → Rive animation-time planning.
// Moved from RiveRuntimeManager; no runtime handles, no Rive player access.

import type { TimelineClip } from '../../../types';
import {
  isVectorAnimationBounceMode,
  isVectorAnimationReverseStartMode,
  shouldLoopVectorAnimation,
  type VectorAnimationClipSettings,
} from '../../../types/vectorAnimation';

const FRAME_EPSILON = 1 / 120;

function getSourceDuration(clip: TimelineClip, duration: number): number {
  if (Number.isFinite(duration) && duration > 0) {
    return duration;
  }
  if (Number.isFinite(clip.source?.naturalDuration) && (clip.source?.naturalDuration ?? 0) > 0) {
    return clip.source!.naturalDuration!;
  }
  return Math.max(clip.duration, FRAME_EPSILON);
}

function normalizeModulo(value: number, divisor: number): number {
  if (!Number.isFinite(divisor) || divisor <= 0) {
    return 0;
  }
  const result = value % divisor;
  return result < 0 ? result + divisor : result;
}

export function resolveAnimationTime(
  clip: TimelineClip,
  animationDuration: number,
  settings: VectorAnimationClipSettings,
  timelineTime: number,
): number | null {
  const clipLocalTime = Math.max(0, timelineTime - clip.startTime);
  const sourceDuration = getSourceDuration(clip, animationDuration);
  const sourceMaxTime = Math.max(0, sourceDuration - FRAME_EPSILON);
  const sourceInPoint = Math.max(0, Math.min(clip.inPoint, sourceMaxTime));
  const rawSourceOutPoint =
    Number.isFinite(clip.outPoint) && clip.outPoint > sourceInPoint
      ? clip.outPoint
      : sourceDuration;
  const sourceOutPoint = Math.max(
    sourceInPoint + FRAME_EPSILON,
    Math.min(rawSourceOutPoint, sourceDuration),
  );
  const sourceWindowDuration = Math.max(sourceOutPoint - sourceInPoint, FRAME_EPSILON);
  const shouldLoop = shouldLoopVectorAnimation(settings);
  const isBounceMode = isVectorAnimationBounceMode(settings.playbackMode);
  const cycleDuration = isBounceMode
    ? sourceWindowDuration * 2
    : sourceWindowDuration;

  if (!shouldLoop && settings.endBehavior === 'clear' && clipLocalTime >= cycleDuration) {
    return null;
  }

  const wrappedLocalTime = shouldLoop
    ? normalizeModulo(clipLocalTime, cycleDuration)
    : Math.max(0, Math.min(clipLocalTime, Math.max(0, cycleDuration - FRAME_EPSILON)));
  const sourceWindowLocalTime = isBounceMode && wrappedLocalTime > sourceWindowDuration
    ? cycleDuration - wrappedLocalTime
    : Math.min(wrappedLocalTime, sourceWindowDuration - FRAME_EPSILON);
  const startsReverse = isVectorAnimationReverseStartMode(settings.playbackMode);
  const reversePlayback = Boolean(clip.reversed) !== startsReverse;

  const sourceTime = reversePlayback
    ? sourceOutPoint - sourceWindowLocalTime
    : sourceInPoint + sourceWindowLocalTime;

  const maxTime = Math.max(0, animationDuration - FRAME_EPSILON);
  return Math.max(0, Math.min(sourceTime, maxTime));
}
