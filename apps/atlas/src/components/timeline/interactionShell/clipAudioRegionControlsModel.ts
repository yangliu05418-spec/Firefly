import type { ClipAudioEditOperation } from '../../../types';
import type { AudioRegionGainHandleMode } from '../components/ClipAudioRegionSelectionOverlay';
import type {
  ClipInteractionShellCommandContext,
  ClipInteractionShellModuleCommand,
} from './types';

export const AUDIO_EXTENSIONS = new Set(['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff', 'opus']);

export type ClipAudioRegionSelection = NonNullable<
  NonNullable<ClipInteractionShellCommandContext['activeModules']['audioRegion']>['selection']
>;

export type ClipAudioRegionModuleCommand = Extract<
  ClipInteractionShellModuleCommand,
  { type: `audio-region:${string}` }
>;

export type AudioRegionMoveDragState = {
  startClientX: number;
  clipWidth: number;
  clipDuration: number;
  initialSelection: ClipAudioRegionSelection;
  operationIds: string[];
};

export type AudioRegionResizeDragState = {
  edge: 'left' | 'right';
  rectLeft: number;
  rectWidth: number;
  initialSelection: ClipAudioRegionSelection;
  operationIds: string[];
};

export type AudioRegionGainDragState = {
  mode: AudioRegionGainHandleMode;
  regionLeft: number;
  regionWidth: number;
  regionTop: number;
  regionHeight: number;
  regionDuration: number;
  currentGainDb: number;
  currentFadeInSeconds: number;
  currentFadeOutSeconds: number;
};

export interface AudioRegionContextMenuState {
  x: number;
  y: number;
  selection: ClipAudioRegionSelection;
}

export function findSelectedGainOperation(
  operations: readonly ClipAudioEditOperation[],
  selection: ClipAudioRegionSelection,
): ClipAudioEditOperation | null {
  const start = Math.min(selection.sourceInPoint, selection.sourceOutPoint);
  const end = Math.max(selection.sourceInPoint, selection.sourceOutPoint);

  for (let index = operations.length - 1; index >= 0; index -= 1) {
    const operation = operations[index];
    if (
      operation?.type === 'gain' &&
      operation.enabled !== false &&
      operation.timeRange &&
      Math.abs(Math.min(operation.timeRange.start, operation.timeRange.end) - start) <= 0.001 &&
      Math.abs(Math.max(operation.timeRange.start, operation.timeRange.end) - end) <= 0.001
    ) {
      return operation;
    }
  }

  return null;
}

export function getMatchingAudioRegionOperationIds(
  operations: readonly ClipAudioEditOperation[],
  selection: ClipAudioRegionSelection,
): string[] {
  const start = Math.min(selection.sourceInPoint, selection.sourceOutPoint);
  const end = Math.max(selection.sourceInPoint, selection.sourceOutPoint);

  return operations
    .filter((operation) => {
      if (!operation.timeRange) return false;
      const operationStart = Math.min(operation.timeRange.start, operation.timeRange.end);
      const operationEnd = Math.max(operation.timeRange.start, operation.timeRange.end);
      return Math.abs(operationStart - start) <= 0.001 &&
        Math.abs(operationEnd - end) <= 0.001;
    })
    .map((operation) => operation.id);
}
