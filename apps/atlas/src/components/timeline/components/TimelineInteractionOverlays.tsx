import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { TimelineRangeSelection } from '../../../stores/timeline/types';
import type { MidiDrawGhost } from '../hooks/useMidiClipDraw';
import type { MarqueeState } from '../types';

interface TimelineInteractionOverlaysProps {
  marquee: MarqueeState | null;
  midiDrawGhost: MidiDrawGhost | null;
  scrollX: number;
  timeToPixel: (time: number) => number;
  timelineRangeSelection: TimelineRangeSelection | null;
  trackHeaderWidth: number;
}

const MIDI_DRAW_GHOST_STYLE: Pick<CSSProperties, 'background' | 'border' | 'borderRadius' | 'pointerEvents' | 'position' | 'zIndex'> = {
  background: 'rgba(120, 170, 255, 0.25)',
  border: '1px solid rgba(150, 190, 255, 0.9)',
  borderRadius: 3,
  pointerEvents: 'none',
  position: 'fixed',
  zIndex: 10000,
};

export function TimelineInteractionOverlays({
  marquee,
  midiDrawGhost,
  scrollX,
  timeToPixel,
  timelineRangeSelection,
  trackHeaderWidth,
}: TimelineInteractionOverlaysProps) {
  return (
    <>
      {marquee && (
        <div
          className={marquee.mode === 'range' ? 'range-selection-drag' : 'marquee-selection'}
          style={{
            left: Math.min(marquee.startX, marquee.currentX) - scrollX,
            top: Math.min(marquee.startY, marquee.currentY),
            width: Math.abs(marquee.currentX - marquee.startX),
            height: Math.abs(marquee.currentY - marquee.startY),
          }}
        />
      )}

      {midiDrawGhost && createPortal(
        <div
          className="midi-draw-ghost"
          style={{
            ...MIDI_DRAW_GHOST_STYLE,
            left: midiDrawGhost.left,
            top: midiDrawGhost.top,
            width: Math.max(1, midiDrawGhost.width),
            height: midiDrawGhost.height,
          }}
        />,
        document.body,
      )}

      {timelineRangeSelection && timelineRangeSelection.endTime > timelineRangeSelection.startTime && (
        <div
          className="timeline-range-selection-overlay"
          data-track-count={timelineRangeSelection.trackIds.length}
          style={{
            left: trackHeaderWidth + timeToPixel(timelineRangeSelection.startTime) - scrollX,
            width: Math.max(1, timeToPixel(timelineRangeSelection.endTime - timelineRangeSelection.startTime)),
          }}
        />
      )}
    </>
  );
}
