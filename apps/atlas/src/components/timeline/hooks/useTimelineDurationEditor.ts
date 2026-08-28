import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
} from 'react';

interface UseTimelineDurationEditorProps {
  duration: number;
  inPoint: number | null;
  outPoint: number | null;
  playheadPosition: number;
  frameRate: number;
  formatTime: (seconds: number) => string;
  parseTime: (value: string) => number | null;
  setDuration: (duration: number) => void;
}

interface UseTimelineDurationEditorReturn {
  isEditingTimelineDuration: boolean;
  timelineDurationInputValue: string;
  timelineTimeDisplayMode: 'time' | 'frames';
  timelineDurationInputRef: RefObject<HTMLInputElement | null>;
  hasInOutDisplayRange: boolean;
  inOutDisplayDuration: number;
  timelineRulerCurrentTime: number;
  timelineTotalFrames: number;
  timelineCurrentFrame: number;
  timelineFpsValue: string;
  handleTimelineDurationClick: () => void;
  handleTimelineDurationInputChange: (value: string) => void;
  handleTimelineTimeDoubleClick: (e: ReactMouseEvent<HTMLSpanElement>) => void;
  handleTimelineDurationSubmit: () => void;
  handleTimelineDurationKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
}

export function useTimelineDurationEditor({
  duration,
  inPoint,
  outPoint,
  playheadPosition,
  frameRate,
  formatTime,
  parseTime,
  setDuration,
}: UseTimelineDurationEditorProps): UseTimelineDurationEditorReturn {
  const [isEditingTimelineDuration, setIsEditingTimelineDuration] = useState(false);
  const [timelineDurationInputValue, setTimelineDurationInputValue] = useState('');
  const [timelineTimeDisplayMode, setTimelineTimeDisplayMode] = useState<'time' | 'frames'>('time');
  const timelineDurationInputRef = useRef<HTMLInputElement>(null);
  const hasInOutDisplayRange = inPoint !== null && outPoint !== null && outPoint > inPoint;
  const inOutDisplayDuration = hasInOutDisplayRange ? outPoint - inPoint : duration;
  const timelineRulerCurrentTime = hasInOutDisplayRange
    ? Math.max(0, Math.min(playheadPosition - inPoint, inOutDisplayDuration))
    : playheadPosition;
  const timelineFrameRate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  const timelineTotalFrames = Math.max(0, Math.round(inOutDisplayDuration * timelineFrameRate));
  const timelineCurrentFrame = Math.max(
    0,
    Math.min(timelineTotalFrames, Math.floor(timelineRulerCurrentTime * timelineFrameRate + Number.EPSILON)),
  );
  const timelineFpsValue = Number.isInteger(timelineFrameRate)
    ? timelineFrameRate.toString()
    : timelineFrameRate.toFixed(2).replace(/\.?0+$/, '');
  const isTimelineDurationEditorVisible = isEditingTimelineDuration && !hasInOutDisplayRange;

  useEffect(() => {
    if (isTimelineDurationEditorVisible && timelineDurationInputRef.current) {
      timelineDurationInputRef.current.focus();
      timelineDurationInputRef.current.select();
    }
  }, [isTimelineDurationEditorVisible]);

  const handleTimelineDurationClick = useCallback(() => {
    if (hasInOutDisplayRange) return;

    setTimelineDurationInputValue(formatTime(duration));
    setIsEditingTimelineDuration(true);
  }, [duration, formatTime, hasInOutDisplayRange]);

  const handleTimelineDurationInputChange = useCallback((value: string) => {
    setTimelineDurationInputValue(value);
  }, []);

  const handleTimelineTimeDoubleClick = useCallback((e: ReactMouseEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setTimelineTimeDisplayMode(mode => mode === 'frames' ? 'time' : 'frames');
  }, []);

  const handleTimelineDurationSubmit = useCallback(() => {
    const nextDuration = parseTime(timelineDurationInputValue);
    if (nextDuration !== null && nextDuration > 0) {
      setDuration(nextDuration);
    }
    setIsEditingTimelineDuration(false);
  }, [parseTime, setDuration, timelineDurationInputValue]);

  useEffect(() => {
    if (!isTimelineDurationEditorVisible) return;

    const handlePointerDown = (event: PointerEvent) => {
      const input = timelineDurationInputRef.current;
      if (input && event.target instanceof Node && input.contains(event.target)) {
        return;
      }

      handleTimelineDurationSubmit();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [handleTimelineDurationSubmit, isTimelineDurationEditorVisible]);

  const handleTimelineDurationKeyDown = useCallback((e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleTimelineDurationSubmit();
    } else if (e.key === 'Escape') {
      setIsEditingTimelineDuration(false);
    }
  }, [handleTimelineDurationSubmit]);

  return {
    isEditingTimelineDuration: isTimelineDurationEditorVisible,
    timelineDurationInputValue,
    timelineTimeDisplayMode,
    timelineDurationInputRef,
    hasInOutDisplayRange,
    inOutDisplayDuration,
    timelineRulerCurrentTime,
    timelineTotalFrames,
    timelineCurrentFrame,
    timelineFpsValue,
    handleTimelineDurationClick,
    handleTimelineDurationInputChange,
    handleTimelineTimeDoubleClick,
    handleTimelineDurationSubmit,
    handleTimelineDurationKeyDown,
  };
}
