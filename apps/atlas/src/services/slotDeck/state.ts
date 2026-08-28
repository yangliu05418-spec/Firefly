import type { SlotDeckState } from '../../stores/mediaStore/types';
import type { DecoderMode, SlotDeckEntry } from './types';

export function sanitizeSlotDeckError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function buildDeckState(entry: SlotDeckEntry): SlotDeckState {
  return {
    slotIndex: entry.slotIndex,
    compositionId: entry.pendingDispose ? null : entry.compositionId,
    status: entry.pendingDispose ? 'disposed' : entry.status,
    preparedClipCount: entry.preparedClipCount,
    readyClipCount: entry.readyClipCount,
    firstFrameReady: entry.firstFrameReady,
    decoderMode: entry.decoderMode,
    lastPreparedAt: entry.lastPreparedAt,
    lastActivatedAt: entry.lastActivatedAt,
    lastError: entry.lastError,
    pinnedLayerIndex: entry.pinnedLayerIndex,
  };
}

export function createDisposedSlotDeckState(slotIndex: number): SlotDeckState {
  return {
    slotIndex,
    compositionId: null,
    status: 'disposed',
    preparedClipCount: 0,
    readyClipCount: 0,
    firstFrameReady: false,
    decoderMode: 'unknown',
    lastPreparedAt: null,
    lastActivatedAt: null,
    lastError: null,
    pinnedLayerIndex: null,
  };
}

export function createPinnedWarmingSlotDeckState(
  slotIndex: number,
  compositionId: string,
  pinnedLayerIndex: number | null,
  lastPreparedAt: number
): SlotDeckState {
  return {
    slotIndex,
    compositionId,
    status: 'warming',
    preparedClipCount: 0,
    readyClipCount: 0,
    firstFrameReady: false,
    decoderMode: 'unknown',
    lastPreparedAt,
    lastActivatedAt: null,
    lastError: null,
    pinnedLayerIndex,
  };
}

export function updateDecoderMode(current: DecoderMode, next: DecoderMode): DecoderMode {
  if (current === 'unknown') {
    return next;
  }
  if (current === next) {
    return current;
  }
  return 'mixed';
}

export function markSlotDeckClipReady(
  entry: SlotDeckEntry,
  mode: DecoderMode,
  now: number,
  options?: { visual?: boolean }
): void {
  entry.readyClipCount = Math.min(entry.preparedClipCount, entry.readyClipCount + 1);
  entry.decoderMode = updateDecoderMode(entry.decoderMode, mode);
  entry.lastPreparedAt = now;

  if (options?.visual) {
    entry.firstFrameReady = true;
  }

  if (entry.readyClipCount >= entry.preparedClipCount) {
    entry.status = entry.firstFrameReady ? 'hot' : 'warm';
  }
}
