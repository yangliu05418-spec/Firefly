import type { ClipAudioEditOperation, TimelineClip } from '../../../types';
import type { TimelineAudioRegionEditType } from '../types';
import { generateClipId } from '../helpers/idGenerator';

const AUDIO_FILE_EXTENSIONS = ['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff', 'opus'];

export function isAudioClip(clip: TimelineClip): boolean {
  const fileName = clip.file?.name || clip.name || '';
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return clip.source?.type === 'audio'
    || clip.file?.type?.startsWith('audio/') === true
    || AUDIO_FILE_EXTENSIONS.includes(extension);
}

export function createAudioEditOperationId(): string {
  return generateClipId('audio-edit');
}

export function operationLabel(type: TimelineAudioRegionEditType): string {
  switch (type) {
    case 'gain': return 'Region gain';
    case 'silence': return 'Silence region';
    case 'cut': return 'Cut region';
    case 'paste': return 'Paste region';
    case 'insert-silence': return 'Insert silence';
    case 'delete-silence': return 'Delete silence';
    case 'reverse': return 'Reverse region';
    case 'invert-polarity': return 'Invert polarity';
    case 'swap-channels': return 'Swap channels';
    case 'mono-sum': return 'Mono sum';
    case 'split-stereo': return 'Split stereo';
    case 'repair': return 'Repair region';
    case 'effect': return 'Region FX';
    case 'room-tone-fill': return 'Room tone fill';
  }
}

export function clampRegionGainDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-120, Math.min(24, value));
}

export function clampRegionFadeSeconds(value: number | undefined, maxSeconds: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.max(0, maxSeconds), value ?? 0));
}

function rangesMatch(
  operation: ClipAudioEditOperation,
  start: number,
  end: number,
): boolean {
  if (!operation.timeRange) return false;
  return Math.abs(Math.min(operation.timeRange.start, operation.timeRange.end) - start) <= 0.001 &&
    Math.abs(Math.max(operation.timeRange.start, operation.timeRange.end) - end) <= 0.001;
}

export function findMatchingRegionGainOperationIndex(
  editStack: readonly ClipAudioEditOperation[],
  start: number,
  end: number,
): number {
  for (let index = editStack.length - 1; index >= 0; index -= 1) {
    const operation = editStack[index];
    if (operation?.type === 'gain' && rangesMatch(operation, start, end)) {
      return index;
    }
  }
  return -1;
}

export function getClipMediaFileId(clip: TimelineClip): string | undefined {
  return clip.source?.mediaFileId ?? clip.mediaFileId;
}
