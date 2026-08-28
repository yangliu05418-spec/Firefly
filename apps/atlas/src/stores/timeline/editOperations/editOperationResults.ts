import type { TimelineClip, TimelineTrack } from '../../../types';
import type { TimelineEditResult, TimelineEditWarning } from './types';

export function blockedByExport(operationId: string): TimelineEditResult {
  return {
    success: false,
    operationId,
    changedClipIds: [],
    warnings: [{
      code: 'export-locked',
      message: 'Timeline edits are locked during export.',
    }],
  };
}

export function aborted(operationId: string): TimelineEditResult {
  return {
    success: false,
    operationId,
    changedClipIds: [],
    warnings: [{
      code: 'no-op',
      message: 'Timeline edit operation was aborted before it ran.',
    }],
  };
}

export function hasOnlyNoopWarnings(warnings: TimelineEditWarning[]): boolean {
  return warnings.length > 0 && warnings.every((warning) => warning.code === 'no-op');
}

export function resultFromWarnings(operationId: string, warnings: TimelineEditWarning[]): TimelineEditResult {
  return {
    success: false,
    operationId,
    changedClipIds: [],
    warnings,
  };
}

export function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

export function isClipTrackLocked(clips: readonly TimelineClip[], tracks: readonly TimelineTrack[], clipId: string): boolean {
  const clip = clips.find(candidate => candidate.id === clipId);
  if (!clip) return false;
  return tracks.find(track => track.id === clip.trackId)?.locked === true;
}
