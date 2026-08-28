import type { SlotDeckState } from '../../../stores/mediaStore/types';

interface SlotGridDeckBadgeProps {
  slotIndex: number;
  deckState: SlotDeckState;
  slotDeckTitle?: string | null;
}

function getSlotDeckBadgeLabel(status: SlotDeckState['status']): string {
  switch (status) {
    case 'cold':
      return 'C';
    case 'warming':
      return 'Wi';
    case 'warm':
      return 'Wa';
    case 'hot':
      return 'H';
    case 'failed':
      return 'F';
    case 'disposed':
      return 'D';
    default:
      return '?';
  }
}

function getSlotDeckBadgeColor(status: SlotDeckState['status']): string {
  switch (status) {
    case 'cold':
      return 'rgba(120, 128, 144, 0.92)';
    case 'warming':
      return 'rgba(194, 119, 24, 0.92)';
    case 'warm':
      return 'rgba(49, 140, 231, 0.92)';
    case 'hot':
      return 'rgba(30, 170, 94, 0.92)';
    case 'failed':
      return 'rgba(185, 42, 42, 0.92)';
    case 'disposed':
      return 'rgba(88, 96, 115, 0.92)';
    default:
      return 'rgba(88, 96, 115, 0.92)';
  }
}

export function SlotGridDeckBadge({
  slotIndex,
  deckState,
  slotDeckTitle,
}: SlotGridDeckBadgeProps) {
  return (
    <div
      className={`slot-grid-deck-badge slot-grid-deck-badge-${deckState.status}`}
      aria-label={`Slot ${slotIndex + 1} deck ${deckState.status}`}
      title={`Deck ${deckState.status}${slotDeckTitle ? ` (${slotDeckTitle})` : ''}`}
      data-slot-deck-status={deckState.status}
      style={{
        position: 'absolute',
        top: 4,
        left: 4,
        minWidth: 18,
        height: 18,
        padding: '0 5px',
        borderRadius: 999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.2,
        lineHeight: 1,
        color: '#fff',
        background: getSlotDeckBadgeColor(deckState.status),
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.35)',
        pointerEvents: 'none',
        zIndex: 3,
      }}
    >
      {getSlotDeckBadgeLabel(deckState.status)}
    </div>
  );
}
