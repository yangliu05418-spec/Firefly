import type { Keyframe, TimelineClip } from '../../../types';
import { uniqueIds } from './editOperationResults';

const FADE_DURATION_EPSILON = 0.01;
const FADE_TIME_TOLERANCE = 0.01;

function nearlyEquals(left: number, right: number, tolerance = FADE_TIME_TOLERANCE): boolean {
  return Math.abs(left - right) <= tolerance;
}

function clampFadeDuration(duration: number, clipDuration: number): number {
  return Math.max(0, Math.min(duration, clipDuration * 0.5));
}

function sanitizeKeyframeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function createStableFadeKeyframeId(
  operationId: string,
  clipId: string,
  edge: 'left' | 'right',
  point: 'zero' | 'one',
  existingIds: Set<string>,
): string {
  const base = `kf_fade_${sanitizeKeyframeIdPart(clipId)}_${edge}_${point}_${sanitizeKeyframeIdPart(operationId)}`;
  if (!existingIds.has(base)) return base;

  let index = 1;
  while (existingIds.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

function findFadePair(
  keyframes: readonly Keyframe[],
  property: string,
  edge: 'left' | 'right',
  clipDuration: number,
): { zeroKeyframe?: Keyframe; oneKeyframe?: Keyframe } {
  const propertyKeyframes = keyframes
    .filter(keyframe => keyframe.property === property)
    .toSorted((left, right) => left.time - right.time);

  if (edge === 'left') {
    const zeroKeyframe = propertyKeyframes.find(keyframe =>
      nearlyEquals(keyframe.time, 0) && nearlyEquals(keyframe.value, 0)
    );
    const oneKeyframe = propertyKeyframes.find(keyframe =>
      keyframe.value >= 0.99 &&
      keyframe.time > FADE_TIME_TOLERANCE &&
      keyframe.time <= Math.max(clipDuration * 0.5, FADE_TIME_TOLERANCE)
    );
    return { zeroKeyframe, oneKeyframe };
  }

  const zeroKeyframe = propertyKeyframes.find(keyframe =>
    nearlyEquals(keyframe.time, clipDuration) && nearlyEquals(keyframe.value, 0)
  );
  const oneKeyframe = propertyKeyframes.findLast(keyframe =>
    keyframe.value >= 0.99 &&
    keyframe.time >= Math.min(clipDuration * 0.5, clipDuration - FADE_TIME_TOLERANCE) &&
    keyframe.time < clipDuration - FADE_TIME_TOLERANCE
  );
  return { zeroKeyframe, oneKeyframe };
}

function resolveFadeKeyframePair(
  keyframes: readonly Keyframe[],
  property: string,
  edge: 'left' | 'right',
  clipDuration: number,
  zeroKeyframeId?: string,
  oneKeyframeId?: string,
): { zeroKeyframe?: Keyframe; oneKeyframe?: Keyframe } {
  const keyframesById = new Map(keyframes.map(keyframe => [keyframe.id, keyframe]));
  const inferred = findFadePair(keyframes, property, edge, clipDuration);
  return {
    zeroKeyframe: zeroKeyframeId ? keyframesById.get(zeroKeyframeId) ?? inferred.zeroKeyframe : inferred.zeroKeyframe,
    oneKeyframe: oneKeyframeId ? keyframesById.get(oneKeyframeId) ?? inferred.oneKeyframe : inferred.oneKeyframe,
  };
}

function upsertFadeKeyframe(
  existingKeyframe: Keyframe | undefined,
  fallbackId: string,
  clipId: string,
  property: Keyframe['property'],
  time: number,
  value: number,
  easing: Keyframe['easing'],
): Keyframe {
  if (existingKeyframe) {
    return {
      ...existingKeyframe,
      clipId,
      property,
      time,
      value,
    };
  }

  return {
    id: fallbackId,
    clipId,
    property,
    time,
    value,
    easing,
  };
}

export function applyFadeKeyframePlan(
  operationId: string,
  clip: TimelineClip,
  keyframePlan: {
    property: Keyframe['property'];
    edge: 'left' | 'right';
    duration: number;
    zeroKeyframeId?: string;
    oneKeyframeId?: string;
    createdKeyframeIds?: readonly string[];
    removedKeyframeIds?: readonly string[];
  },
  requestedDuration: number,
  clipKeyframes: Map<string, Keyframe[]>,
): { clipKeyframes: Map<string, Keyframe[]>; changed: boolean; removedKeyframeIds: string[] } {
  const existingKeyframes = clipKeyframes.get(clip.id) ?? [];
  const existingIds = new Set(existingKeyframes.map(keyframe => keyframe.id));
  const resolvedDuration = clampFadeDuration(requestedDuration, clip.duration);
  const pair = resolveFadeKeyframePair(
    existingKeyframes,
    keyframePlan.property,
    keyframePlan.edge,
    clip.duration,
    keyframePlan.zeroKeyframeId,
    keyframePlan.oneKeyframeId,
  );
  const removableIds = uniqueIds([
    pair.zeroKeyframe?.id,
    pair.oneKeyframe?.id,
    ...(keyframePlan.removedKeyframeIds ?? []),
  ].filter((keyframeId): keyframeId is string => Boolean(keyframeId)));

  let nextKeyframes = existingKeyframes.filter(keyframe => !removableIds.includes(keyframe.id));

  if (resolvedDuration > FADE_DURATION_EPSILON) {
    const zeroTime = keyframePlan.edge === 'left' ? 0 : clip.duration;
    const oneTime = keyframePlan.edge === 'left' ? resolvedDuration : clip.duration - resolvedDuration;
    const plannedZeroId = keyframePlan.zeroKeyframeId ?? keyframePlan.createdKeyframeIds?.[0];
    const plannedOneId = keyframePlan.oneKeyframeId ?? keyframePlan.createdKeyframeIds?.[1];
    const zeroId = plannedZeroId && !existingIds.has(plannedZeroId)
      ? plannedZeroId
      : pair.zeroKeyframe?.id ?? createStableFadeKeyframeId(operationId, clip.id, keyframePlan.edge, 'zero', existingIds);
    existingIds.add(zeroId);
    const oneId = plannedOneId && !existingIds.has(plannedOneId)
      ? plannedOneId
      : pair.oneKeyframe?.id ?? createStableFadeKeyframeId(operationId, clip.id, keyframePlan.edge, 'one', existingIds);

    nextKeyframes = [
      ...nextKeyframes,
      upsertFadeKeyframe(
        pair.zeroKeyframe,
        zeroId,
        clip.id,
        keyframePlan.property,
        zeroTime,
        0,
        keyframePlan.edge === 'left' ? 'ease-out' : 'linear',
      ),
      upsertFadeKeyframe(
        pair.oneKeyframe,
        oneId,
        clip.id,
        keyframePlan.property,
        oneTime,
        1,
        keyframePlan.edge === 'left' ? 'linear' : 'ease-in',
      ),
    ];
  }

  nextKeyframes = nextKeyframes.toSorted((left, right) => left.time - right.time);
  const changed = JSON.stringify(existingKeyframes) !== JSON.stringify(nextKeyframes);
  if (!changed) {
    return { clipKeyframes, changed: false, removedKeyframeIds: [] };
  }
  const nextKeyframeIds = new Set(nextKeyframes.map(keyframe => keyframe.id));
  const removedKeyframeIds = existingKeyframes
    .filter(keyframe => !nextKeyframeIds.has(keyframe.id))
    .map(keyframe => keyframe.id);

  const nextMap = new Map(clipKeyframes);
  if (nextKeyframes.length > 0) {
    nextMap.set(clip.id, nextKeyframes);
  } else {
    nextMap.delete(clip.id);
  }

  return { clipKeyframes: nextMap, changed: true, removedKeyframeIds };
}

export function applyFadeCancel(
  clipId: string,
  discardKeyframeIds: readonly string[],
  clipKeyframes: Map<string, Keyframe[]>,
): { clipKeyframes: Map<string, Keyframe[]>; changed: boolean; removedKeyframeIds: string[] } {
  if (discardKeyframeIds.length === 0) {
    return { clipKeyframes, changed: false, removedKeyframeIds: [] };
  }

  const discardIds = new Set(discardKeyframeIds);
  const existingKeyframes = clipKeyframes.get(clipId) ?? [];
  const nextKeyframes = existingKeyframes.filter(keyframe => !discardIds.has(keyframe.id));
  const removedKeyframeIds = existingKeyframes
    .filter(keyframe => discardIds.has(keyframe.id))
    .map(keyframe => keyframe.id);
  if (removedKeyframeIds.length === 0) {
    return { clipKeyframes, changed: false, removedKeyframeIds: [] };
  }

  const nextMap = new Map(clipKeyframes);
  if (nextKeyframes.length > 0) {
    nextMap.set(clipId, nextKeyframes);
  } else {
    nextMap.delete(clipId);
  }
  return { clipKeyframes: nextMap, changed: true, removedKeyframeIds };
}
