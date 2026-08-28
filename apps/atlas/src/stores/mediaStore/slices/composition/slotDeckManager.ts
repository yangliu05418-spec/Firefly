import type { SlotDeckState } from '../../types';

interface SlotDeckManagerLike {
  prepareSlot: (slotIndex: number, compositionId: string) => void;
  disposeSlot: (slotIndex: number) => void;
}

export function resolveSlotDeckManager(): SlotDeckManagerLike | null {
  const globalScope = globalThis as typeof globalThis & { __slotDeckManager?: SlotDeckManagerLike };
  return globalScope.__slotDeckManager ?? null;
}

export function createWarmingSlotDeckState(
  slotIndex: number,
  compositionId: string | null,
): SlotDeckState {
  return {
    slotIndex,
    compositionId,
    status: compositionId ? 'warming' : 'disposed',
    preparedClipCount: 0,
    readyClipCount: 0,
    firstFrameReady: false,
    decoderMode: 'unknown',
    lastPreparedAt: compositionId ? Date.now() : null,
    lastActivatedAt: null,
    lastError: null,
    pinnedLayerIndex: null,
  };
}
