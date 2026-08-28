import { useCallback, type Dispatch, type DragEvent, type MutableRefObject, type SetStateAction } from 'react';
import type { ExternalDragState } from '../types';

interface UseExternalDropTrackDragLeaveParams {
  dragCounterRef: MutableRefObject<number>;
  setExternalDrag: Dispatch<SetStateAction<ExternalDragState | null>>;
}

export function useExternalDropTrackDragLeave({
  dragCounterRef,
  setExternalDrag,
}: UseExternalDropTrackDragLeaveParams) {
  return useCallback((event: DragEvent) => {
    event.preventDefault();
    dragCounterRef.current--;

    if (dragCounterRef.current !== 0) {
      return;
    }

    setExternalDrag((prev) => prev ? {
      ...prev,
      trackId: '',
      audioTrackId: undefined,
      videoTrackId: undefined,
      newTrackType: null,
    } : null);
  }, [dragCounterRef, setExternalDrag]);
}
