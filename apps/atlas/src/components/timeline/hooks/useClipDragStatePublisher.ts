import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import type { ClipDragState } from '../types';

const CLIP_DRAG_STATE_PUBLISH_INTERVAL_MS = 33;

export function useClipDragStatePublisher(
  clipDrag: ClipDragState | null,
  setClipDrag: Dispatch<SetStateAction<ClipDragState | null>>,
) {
  const clipDragRef = useRef<ClipDragState | null>(clipDrag);
  const lastClipDragStatePublishAtRef = useRef(0);
  const pendingClipDragStateRef = useRef<ClipDragState | null>(null);
  const pendingClipDragStateTimerRef = useRef<number | null>(null);

  const clearPendingClipDragStateTimer = useCallback(() => {
    if (pendingClipDragStateTimerRef.current !== null) {
      window.clearTimeout(pendingClipDragStateTimerRef.current);
      pendingClipDragStateTimerRef.current = null;
    }
    pendingClipDragStateRef.current = null;
  }, []);

  const publishClipDragState = useCallback((nextDrag: ClipDragState | null) => {
    lastClipDragStatePublishAtRef.current = performance.now();
    setClipDrag(nextDrag);
  }, [setClipDrag]);

  const setClipDragStateForInteraction = useCallback((nextDrag: ClipDragState | null) => {
    clipDragRef.current = nextDrag;

    if (nextDrag === null) {
      clearPendingClipDragStateTimer();
      publishClipDragState(null);
      return;
    }

    const now = performance.now();
    const elapsed = now - lastClipDragStatePublishAtRef.current;
    if (elapsed >= CLIP_DRAG_STATE_PUBLISH_INTERVAL_MS) {
      clearPendingClipDragStateTimer();
      publishClipDragState(nextDrag);
      return;
    }

    pendingClipDragStateRef.current = nextDrag;
    if (pendingClipDragStateTimerRef.current !== null) return;

    pendingClipDragStateTimerRef.current = window.setTimeout(() => {
      pendingClipDragStateTimerRef.current = null;
      const pendingDrag = pendingClipDragStateRef.current;
      pendingClipDragStateRef.current = null;
      if (pendingDrag) {
        publishClipDragState(pendingDrag);
      }
    }, Math.max(0, CLIP_DRAG_STATE_PUBLISH_INTERVAL_MS - elapsed));
  }, [clearPendingClipDragStateTimer, publishClipDragState]);

  return {
    clipDragRef,
    clearPendingClipDragStateTimer,
    setClipDragStateForInteraction,
  };
}
