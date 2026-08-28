import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';

export interface MixerFaderResizeHandleProps {
  onResizePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onResizePointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onResizePointerEnd: (event: PointerEvent<HTMLDivElement>) => void;
  onResizeDoubleClick: (event: MouseEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export function MixerFaderResizeHandle({
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerEnd,
  onResizeDoubleClick,
  onResizeKeyDown,
}: MixerFaderResizeHandleProps) {
  return (
    <div
      className="audio-mixer-fader-resize-handle"
      role="separator"
      aria-label="Resize mixer fader area"
      aria-orientation="horizontal"
      tabIndex={0}
      title="Drag to resize fader area, double-click to reset"
      onPointerDown={onResizePointerDown}
      onPointerMove={onResizePointerMove}
      onPointerUp={onResizePointerEnd}
      onPointerCancel={onResizePointerEnd}
      onLostPointerCapture={onResizePointerEnd}
      onDoubleClick={onResizeDoubleClick}
      onKeyDown={onResizeKeyDown}
    />
  );
}
