import { SlotGrid } from '../SlotGrid';

interface TimelineSlotGridChromeProps {
  onToggleSlotGrid: () => void;
  slotGridProgress: number;
}

export function TimelineSlotGridChrome({
  onToggleSlotGrid,
  slotGridProgress,
}: TimelineSlotGridChromeProps) {
  return (
    <>
      {slotGridProgress > 0 && (
        <div className="toolbar-slide-wrapper" style={{
          height: `${Math.round(slotGridProgress * 36)}px`,
          opacity: slotGridProgress,
          overflow: 'hidden',
        }}>
          <div className="slot-grid-toolbar">
            <div className="timeline-slot-toggle">
              <button
                className="btn btn-sm btn-icon btn-active"
                onClick={onToggleSlotGrid}
                title="Back to Timeline (Ctrl+Shift+Scroll)"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="1" y="2" width="14" height="2" rx="0.5"/><rect x="1" y="7" width="14" height="2" rx="0.5"/><rect x="1" y="12" width="14" height="2" rx="0.5"/></svg>
              </button>
            </div>
            <span className="slot-grid-toolbar-title">Slot Grid</span>
          </div>
        </div>
      )}

      {slotGridProgress > 0 && (
        <SlotGrid opacity={slotGridProgress} />
      )}
    </>
  );
}
