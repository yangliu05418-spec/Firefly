import { useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import knobFaceUrl from './assets/knob-face.jpg';

const KNOB_SWEEP_DEGREES = 270;
const KNOB_START_ANGLE = -135;
// Full vertical drag distance (px) for one min->max sweep; shift = fine.
const DRAG_RANGE_PX = 220;
const FINE_DRAG_FACTOR = 0.12;

export interface HardwareKnobProps {
  value: number;
  min: number;
  max: number;
  /** 'log' maps drag/rotation logarithmically (frequency, Q). */
  scale?: 'linear' | 'log';
  size?: 'sm' | 'lg';
  label: string;
  ariaLabel?: string;
  minLabel?: string;
  maxLabel?: string;
  disabled?: boolean;
  defaultValue?: number;
  /** Continuous value stream while dragging (coalesce upstream). */
  onChange: (value: number) => void;
  /** Drag gesture ended (flush pending commits). */
  onDragEnd?: () => void;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function valueToNormalized(value: number, min: number, max: number, scale: 'linear' | 'log'): number {
  if (scale === 'log') {
    const safeMin = Math.max(1e-6, min);
    const safeValue = Math.max(safeMin, value);
    return clamp01(Math.log(safeValue / safeMin) / Math.log(max / safeMin));
  }
  return clamp01((value - min) / (max - min));
}

function normalizedToValue(normalized: number, min: number, max: number, scale: 'linear' | 'log'): number {
  const t = clamp01(normalized);
  if (scale === 'log') {
    const safeMin = Math.max(1e-6, min);
    return safeMin * Math.exp(t * Math.log(max / safeMin));
  }
  return min + t * (max - min);
}

/**
 * Rotary hardware-style knob: vertical pointer drag (shift = fine), arrow-key
 * stepping, double-click reset. Purely presentational chrome lives in CSS
 * (`.flex-eq-knob*`); value mapping covers linear and logarithmic ranges.
 */
export function HardwareKnob({
  value,
  min,
  max,
  scale = 'linear',
  size = 'sm',
  label,
  ariaLabel,
  minLabel,
  maxLabel,
  disabled = false,
  defaultValue,
  onChange,
  onDragEnd,
}: HardwareKnobProps) {
  const dragStateRef = useRef<{ pointerId: number; startY: number; startNormalized: number } | null>(null);

  const normalized = valueToNormalized(value, min, max, scale);
  const angle = KNOB_START_ANGLE + normalized * KNOB_SWEEP_DEGREES;

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startNormalized: normalized,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const factor = event.shiftKey ? FINE_DRAG_FACTOR : 1;
    const deltaNormalized = ((drag.startY - event.clientY) / DRAG_RANGE_PX) * factor;
    onChange(normalizedToValue(drag.startNormalized + deltaNormalized, min, max, scale));
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture can already be released.
    }
    dragStateRef.current = null;
    onDragEnd?.();
  };

  const handleDoubleClick = () => {
    if (disabled || defaultValue === undefined) return;
    onChange(defaultValue);
    onDragEnd?.();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight'
      ? 1
      : event.key === 'ArrowDown' || event.key === 'ArrowLeft'
        ? -1
        : 0;
    if (direction === 0) return;
    event.preventDefault();
    const step = (event.shiftKey ? 0.002 : 0.02) * direction;
    onChange(normalizedToValue(normalized + step, min, max, scale));
    onDragEnd?.();
  };

  return (
    <div className={`flex-eq-knob ${size} ${disabled ? 'disabled' : ''}`}>
      <div
        className="flex-eq-knob-dial"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel ?? label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(value * 100) / 100}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
      >
        <div className="flex-eq-knob-ticks" aria-hidden="true" />
        <div className="flex-eq-knob-body" aria-hidden="true">
          {/* The photographed face never rotates (its lighting and machining
              are baked in); the crop hides the photo's printed marker and the
              pointer below is our own rotating indication layer. */}
          <div className="flex-eq-knob-face" style={{ backgroundImage: `url(${knobFaceUrl})` }} />
          <div className="flex-eq-knob-pointer" style={{ transform: `rotate(${angle}deg)` }}>
            <i className="flex-eq-knob-pointer-mark" />
          </div>
        </div>
      </div>
      <div className="flex-eq-knob-legend" aria-hidden="true">
        <span>{minLabel ?? ''}</span>
        <strong>{label}</strong>
        <span>{maxLabel ?? ''}</span>
      </div>
    </div>
  );
}
