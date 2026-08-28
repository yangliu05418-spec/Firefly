import { memo, useEffect, useRef } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { playheadState } from '../../../services/layerBuilder';
import { layerPlaybackManager } from '../../../services/layerPlaybackManager';

interface SlotGridTimeOverlayProps {
  compId: string;
  duration: number;
  isActive: boolean;
  layerIndex: number;
  slotSize: number;
  initialPosition: number;
}

function fmtTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  const msStr = ms.toString().padStart(2, '0');
  if (mins > 0) return `${mins}:${secs.toString().padStart(2, '0')}.${msStr}`;
  return `${secs}.${msStr}`;
}

export const SlotGridTimeOverlay = memo(function SlotGridTimeOverlay({
  compId,
  duration,
  isActive,
  layerIndex,
  slotSize,
  initialPosition,
}: SlotGridTimeOverlayProps) {
  const lineRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  const startedAtRef = useRef<number>(0);
  const wasActiveRef = useRef(false);
  const wasEditorRef = useRef(false);

  useEffect(() => {
    if (isActive && !wasActiveRef.current) {
      startedAtRef.current = performance.now() - initialPosition * 1000;
    }
    wasActiveRef.current = isActive;
  }, [isActive, initialPosition]);

  useEffect(() => {
    const line = lineRef.current;
    const timeEl = timeRef.current;
    if (!line || !timeEl || duration <= 0) return;

    const durationStr = fmtTime(duration);

    if (!isActive) {
      line.style.display = 'none';
      timeEl.textContent = `${fmtTime(0)} / ${durationStr}`;
      return;
    }

    line.style.display = '';
    let rafId: number;
    const padding = 3;
    const trackWidth = slotSize - padding * 2;

    const update = () => {
      const isEditor = useMediaStore.getState().activeCompositionId === compId;
      const layerPlayback = layerPlaybackManager.getLayerPlaybackInfo(layerIndex);
      let pos: number;
      if (layerPlayback?.compositionId === compId) {
        pos = layerPlayback.currentTime;
      } else if (isEditor) {
        pos = playheadState.isUsingInternalPosition
          ? playheadState.position
          : useTimelineStore.getState().playheadPosition;
        wasEditorRef.current = true;
      } else {
        if (wasEditorRef.current) {
          const comp = useMediaStore.getState().compositions.find(c => c.id === compId);
          const savedPos = comp?.timelineData?.playheadPosition ?? 0;
          startedAtRef.current = performance.now() - savedPos * 1000;
          wasEditorRef.current = false;
        }
        const elapsed = (performance.now() - startedAtRef.current) / 1000;
        pos = duration > 0 ? elapsed % duration : 0;
      }
      const pct = Math.max(0, Math.min(1, pos / duration));
      line.style.left = `${padding + pct * trackWidth}px`;
      timeEl.textContent = `${fmtTime(pos)} / ${durationStr}`;
      rafId = requestAnimationFrame(update);
    };

    rafId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafId);
  }, [compId, duration, isActive, layerIndex, slotSize]);

  return (
    <>
      <div
        ref={lineRef}
        className="slot-grid-playhead"
      />
      <div
        ref={timeRef}
        className="slot-grid-time"
      />
    </>
  );
});
