import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip } from '../../../types';
import type { TimelineEditOperation } from '../../../stores/timeline/editOperations/types';
import type { GuidedToolCall } from '../types';

export function createTimelineReplayOperationFromToolCall(
  toolCall: GuidedToolCall,
): TimelineEditOperation | null {
  switch (toolCall.tool) {
    case 'splitClip':
      return createSplitClipOperation(toolCall);
    case 'splitClipAtTimes':
      return createSplitClipAtTimesOperation(toolCall);
    case 'splitClipEvenly':
      return createSplitClipEvenlyOperation(toolCall);
    default:
      return null;
  }
}

function createSplitClipOperation(toolCall: GuidedToolCall): TimelineEditOperation | null {
  const clipId = readString(toolCall.args.clipId);
  const splitTime = readNumber(toolCall.args.splitTime);
  if (!clipId || splitTime === null) {
    return null;
  }

  const clip = getClip(clipId);
  return {
    id: `guided-replay:${toolCall.tool}:${clipId}:${splitTime}`,
    type: 'split-at-time',
    clipIds: [clipId],
    time: splitTime,
    ...optionalIncludeLinked(toolCall.args.withLinked),
    ...(clip ? { scope: { trackIds: [clip.trackId] } } : {}),
  };
}

function createSplitClipAtTimesOperation(toolCall: GuidedToolCall): TimelineEditOperation | null {
  const clipId = readString(toolCall.args.clipId);
  if (!clipId) {
    return null;
  }

  const clip = getClip(clipId);
  const times = normalizeSplitTimes(readNumberArray(toolCall.args.times), clip);
  if (times.length === 0) {
    return null;
  }

  return {
    id: `guided-replay:${toolCall.tool}:${clipId}:${times.join(',')}`,
    type: 'split-at-times',
    clipId,
    times,
    ...optionalIncludeLinked(toolCall.args.withLinked),
    ...(clip ? { scope: { trackIds: [clip.trackId] } } : {}),
  };
}

function createSplitClipEvenlyOperation(toolCall: GuidedToolCall): TimelineEditOperation | null {
  const clipId = readString(toolCall.args.clipId);
  const parts = readInteger(toolCall.args.parts);
  if (!clipId || parts === null || parts < 2) {
    return null;
  }

  const clip = getClip(clipId);
  if (!clip || clip.duration <= 0) {
    return null;
  }

  const partDuration = clip.duration / parts;
  const times = normalizeSplitTimes(
    Array.from({ length: parts - 1 }, (_, index) => clip.startTime + partDuration * (index + 1)),
    clip,
  );
  if (times.length === 0) {
    return null;
  }

  return {
    id: `guided-replay:${toolCall.tool}:${clipId}:${parts}`,
    type: 'split-at-times',
    clipId,
    times,
    ...optionalIncludeLinked(toolCall.args.withLinked),
    scope: { trackIds: [clip.trackId] },
  };
}

function normalizeSplitTimes(times: number[], clip?: TimelineClip): number[] {
  const minTime = clip ? clip.startTime + 0.001 : Number.NEGATIVE_INFINITY;
  const maxTime = clip ? clip.startTime + clip.duration - 0.001 : Number.POSITIVE_INFINITY;
  return [...new Set(times)]
    .filter((time) => Number.isFinite(time) && time > minTime && time < maxTime)
    .toSorted((a, b) => a - b);
}

function getClip(clipId: string): TimelineClip | undefined {
  return useTimelineStore.getState().clips.find((clip) => clip.id === clipId);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function optionalIncludeLinked(value: unknown): { includeLinked?: boolean } {
  return typeof value === 'boolean' ? { includeLinked: value } : {};
}

function readNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry))
    : [];
}
