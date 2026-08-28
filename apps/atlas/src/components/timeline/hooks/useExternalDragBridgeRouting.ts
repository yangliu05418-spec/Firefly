import { useEffect } from 'react';
import type {
  Dispatch,
  DragEvent,
  MutableRefObject,
  SetStateAction,
} from 'react';

import type { ExternalDragState } from '../types';
import {
  EXTERNAL_DRAG_BRIDGE_EVENT,
  getExternalDragPayload,
  getExternalDragPayloadMimeData,
  getExternalDragPayloadMimeTypes,
  type ExternalDragBridgeEventDetail,
  type ExternalDragPayload,
} from '../utils/externalDragSession';

type ExternalDragBridgeTarget =
  | { kind: 'track'; trackId: string }
  | { kind: 'new-track'; trackType: 'video' | 'audio' };

interface UseExternalDragBridgeRoutingProps {
  dragCounterRef: MutableRefObject<number>;
  clearExternalDragState: () => void;
  setExternalDrag: Dispatch<SetStateAction<ExternalDragState | null>>;
  updateVideoNewTrackGesture: (clientY: number, isAudio: boolean) => boolean;
  handleTrackDragOver: (event: DragEvent, trackId: string) => void;
  handleTrackDrop: (event: DragEvent, trackId: string) => void | Promise<void>;
  handleNewTrackDragOver: (event: DragEvent, trackType: 'video' | 'audio') => void;
  handleNewTrackDrop: (event: DragEvent, trackType: 'video' | 'audio') => void | Promise<void>;
}

function createPayloadDragEvent(
  detail: ExternalDragBridgeEventDetail,
  payload: ExternalDragPayload,
): DragEvent {
  const types = getExternalDragPayloadMimeTypes(payload);
  const dataTransfer = {
    types,
    dropEffect: 'copy',
    effectAllowed: 'copyMove',
    files: { length: 0, item: () => null },
    items: { length: 0, item: () => null },
    getData: (mimeType: string) => getExternalDragPayloadMimeData(payload, mimeType),
    setData: () => undefined,
    clearData: () => undefined,
    setDragImage: () => undefined,
  } as unknown as DataTransfer;

  return {
    clientX: detail.clientX,
    clientY: detail.clientY,
    dataTransfer,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  } as DragEvent;
}

function resolveExternalDragBridgeTarget(clientX: number, clientY: number): ExternalDragBridgeTarget | null {
  const elementAtPoint = document.elementFromPoint(clientX, clientY);
  const targetElement = elementAtPoint instanceof HTMLElement ? elementAtPoint : null;
  if (!targetElement) return null;

  const newTrackZone = targetElement.closest<HTMLElement>('.new-track-drop-zone');
  if (newTrackZone?.classList.contains('video')) {
    return { kind: 'new-track', trackType: 'video' };
  }
  if (newTrackZone?.classList.contains('audio')) {
    return { kind: 'new-track', trackType: 'audio' };
  }

  const trackLane = targetElement.closest<HTMLElement>('.track-lane[data-track-id]');
  const trackId = trackLane?.dataset.trackId;
  return trackId ? { kind: 'track', trackId } : null;
}

export function useExternalDragBridgeRouting({
  dragCounterRef,
  clearExternalDragState,
  setExternalDrag,
  updateVideoNewTrackGesture,
  handleTrackDragOver,
  handleTrackDrop,
  handleNewTrackDragOver,
  handleNewTrackDrop,
}: UseExternalDragBridgeRoutingProps): void {
  useEffect(() => {
    const handleBridgeDrag = (event: Event) => {
      const detail = (event as CustomEvent<ExternalDragBridgeEventDetail>).detail;
      if (!detail) return;

      if (detail.phase === 'cancel') {
        dragCounterRef.current = 0;
        clearExternalDragState();
        return;
      }

      const payload = getExternalDragPayload();
      if (!payload) {
        dragCounterRef.current = 0;
        clearExternalDragState();
        return;
      }

      const target = detail.targetTrackId
        ? { kind: 'track' as const, trackId: detail.targetTrackId }
        : detail.targetNewTrackType
          ? { kind: 'new-track' as const, trackType: detail.targetNewTrackType }
          : resolveExternalDragBridgeTarget(detail.clientX, detail.clientY);
      if (!target) {
        if (detail.phase === 'drop') {
          dragCounterRef.current = 0;
          clearExternalDragState();
        } else {
          setExternalDrag((prev) => prev ? {
            ...prev,
            x: detail.clientX,
            y: detail.clientY,
            trackId: '',
            audioTrackId: undefined,
            videoTrackId: undefined,
            newTrackType: null,
            showVideoNewTrackZone: updateVideoNewTrackGesture(detail.clientY, payload.isAudio),
          } : null);
        }
        return;
      }

      const dragEvent = createPayloadDragEvent(detail, payload);
      dragCounterRef.current = Math.max(1, dragCounterRef.current);

      if (target.kind === 'track') {
        if (detail.phase === 'drop') {
          void handleTrackDrop(dragEvent, target.trackId);
        } else {
          handleTrackDragOver(dragEvent, target.trackId);
        }
        return;
      }

      if (detail.phase === 'drop') {
        void handleNewTrackDrop(dragEvent, target.trackType);
      } else {
        handleNewTrackDragOver(dragEvent, target.trackType);
      }
    };

    window.addEventListener(EXTERNAL_DRAG_BRIDGE_EVENT, handleBridgeDrag);
    return () => window.removeEventListener(EXTERNAL_DRAG_BRIDGE_EVENT, handleBridgeDrag);
  }, [
    handleNewTrackDragOver,
    handleNewTrackDrop,
    handleTrackDragOver,
    handleTrackDrop,
    clearExternalDragState,
    dragCounterRef,
    setExternalDrag,
    updateVideoNewTrackGesture,
  ]);
}
