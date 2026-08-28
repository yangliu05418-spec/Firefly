import { useMediaStore } from '../../stores/mediaStore';
import { type GuidedActionStoreApi } from '../../stores/guidedActionStore';
import {
  clearExternalDragPayload,
  createExternalDragPayloadForProjectItem,
  dispatchExternalDragBridgeEvent,
  getExternalDragPayload,
  setExternalDragPayload,
} from '../../components/timeline/utils/externalDragSession';
import type { GuidedAction, GuidedPoint } from './types';

interface GuidedExternalDragPreviewClock {
  setTimeout: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
}

export class GuidedExternalDragPreview {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly store: GuidedActionStoreApi;
  private readonly clock: GuidedExternalDragPreviewClock;

  constructor(
    store: GuidedActionStoreApi,
    clock: GuidedExternalDragPreviewClock,
  ) {
    this.store = store;
    this.clock = clock;
  }

  start(
    action: Extract<GuidedAction, { type: 'dragCursor' }>,
    from: GuidedPoint,
    to: GuidedPoint,
    durationMs: number,
    signal: AbortSignal,
  ): void {
    if (action.from.kind !== 'mediaItem' || action.to.kind !== 'timelineTime') {
      return;
    }
    const targetTrackId = action.to.trackId;

    const mediaState = useMediaStore.getState();
    const item = mediaState.getItemById(action.from.itemId);
    if (!item) {
      return;
    }

    const payload = createExternalDragPayloadForProjectItem(item, {
      activeCompositionId: mediaState.activeCompositionId,
      requireMediaFileObject: false,
    });
    if (!payload) {
      return;
    }

    this.clearTimers();
    setExternalDragPayload(payload);
    this.store.getState().setDragGhost({
      label: payload.label ?? action.from.itemId,
      mediaType: payload.mediaType,
      thumbnailUrl: payload.thumbnailUrl,
    });

    const plannedDurationMs = Math.max(0, durationMs);
    const stepCount = Math.max(2, Math.min(10, Math.ceil(plannedDurationMs / 120)));
    for (let index = 0; index <= stepCount; index += 1) {
      const progress = index / stepCount;
      const delayMs = Math.round(plannedDurationMs * progress);
      const timer: ReturnType<typeof setTimeout> = this.clock.setTimeout(() => {
        this.timers.delete(timer);
        if (signal.aborted) {
          return;
        }
        dispatchExternalDragBridgeEvent({
          phase: 'move',
          clientX: from.x + (to.x - from.x) * progress,
          clientY: from.y + (to.y - from.y) * progress,
          targetTrackId,
        });
      }, delayMs);
      this.timers.add(timer);
    }
  }

  cancel(): void {
    this.clearTimers();
    if (getExternalDragPayload()) {
      dispatchExternalDragBridgeEvent({ phase: 'cancel', clientX: 0, clientY: 0 });
    }
    clearExternalDragPayload();
    this.store.getState().setDragGhost(null);
  }

  private clearTimers(): void {
    for (const timer of this.timers) {
      this.clock.clearTimeout(timer);
    }
    this.timers.clear();
  }
}
