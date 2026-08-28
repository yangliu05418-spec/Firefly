import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import type { Composition, SlotDeckState } from '../../stores/mediaStore/types';

export type DecoderMode = SlotDeckState['decoderMode'];
export type SlotDeckStatus = SlotDeckState['status'];

export interface PreparedSlotDeck {
  slotIndex: number;
  compositionId: string;
  composition: Composition;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  duration: number;
}

export interface SlotDeckManagerSnapshot {
  softCap: number;
  deckCount: number;
  pinnedDeckCount: number;
  states: SlotDeckState[];
}

export interface SlotDeckEntry extends PreparedSlotDeck {
  status: SlotDeckStatus;
  preparedClipCount: number;
  readyClipCount: number;
  firstFrameReady: boolean;
  decoderMode: DecoderMode;
  lastPreparedAt: number | null;
  lastActivatedAt: number | null;
  lastError: string | null;
  pinnedLayerIndex: number | null;
  pendingDispose: boolean;
}
