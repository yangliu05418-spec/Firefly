import { useCallback, useEffect, useRef, useState } from 'react';

export function useTimelineHeaderAudioPopoverState() {
  const [audioFxOpen, setAudioFxOpen] = useState(false);
  const [audioSendsOpen, setAudioSendsOpen] = useState(false);
  const audioFxPopoverRef = useRef<HTMLDivElement>(null);
  const audioSendsPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!audioFxOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (audioFxPopoverRef.current?.contains(event.target as Node)) return;
      setAudioFxOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [audioFxOpen]);

  useEffect(() => {
    if (!audioSendsOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (audioSendsPopoverRef.current?.contains(event.target as Node)) return;
      setAudioSendsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [audioSendsOpen]);

  const toggleAudioFxOpen = useCallback(() => {
    setAudioSendsOpen(false);
    setAudioFxOpen(open => !open);
  }, []);

  const toggleAudioSendsOpen = useCallback(() => {
    setAudioFxOpen(false);
    setAudioSendsOpen(open => !open);
  }, []);

  return {
    audioFxOpen,
    audioFxPopoverRef,
    audioSendsOpen,
    audioSendsPopoverRef,
    toggleAudioFxOpen,
    toggleAudioSendsOpen,
  };
}

export type TimelineHeaderAudioPopoverState = ReturnType<typeof useTimelineHeaderAudioPopoverState>;
