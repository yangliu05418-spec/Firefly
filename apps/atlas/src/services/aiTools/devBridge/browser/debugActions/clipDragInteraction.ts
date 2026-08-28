import { useTimelineStore } from '../../../../../stores/timeline';
import {
  summarizeNumberList,
  summarizePerformanceMemory,
  summarizeProxyAudioCache,
} from './performance';
import { collectTimelineInteractionSnapshot, summarizeElementForDebug } from './interaction';

interface ClipDragMeasureTarget {
  element: HTMLElement;
  clipId: string | null;
  rect: DOMRect;
}

function findClipDragDomTargetById(clipId: string): HTMLElement | null {
  const escapedClipId = CSS.escape(clipId);
  return document.querySelector<HTMLElement>(`.clip-interaction-shell[data-clip-id="${escapedClipId}"]`) ??
    document.querySelector<HTMLElement>(`.timeline-clip-preview[data-clip-id="${escapedClipId}"]`);
}

function findClipDragCanvasTargetById(clipId: string): ClipDragMeasureTarget | null {
  const timelineState = useTimelineStore.getState();
  const clip = timelineState.clips.find((candidate) => candidate.id === clipId);
  if (!clip) return null;
  const row = document.querySelector<HTMLElement>(
    `.track-lane[data-track-id="${CSS.escape(clip.trackId)}"] .track-clip-row`,
  );
  if (!row) return null;
  const rowRect = row.getBoundingClientRect();
  const zoom = Math.max(0.001, timelineState.zoom ?? 50);
  const scrollX = Math.max(0, timelineState.scrollX ?? 0);
  const left = rowRect.left + clip.startTime * zoom - scrollX;
  const width = Math.max(1, clip.duration * zoom);
  const clippedLeft = Math.max(rowRect.left, Math.min(rowRect.right - 1, left));
  const clippedRight = Math.max(clippedLeft + 1, Math.min(rowRect.right, left + width));
  return {
    element: row,
    clipId,
    rect: {
      x: clippedLeft,
      y: rowRect.y,
      left: clippedLeft,
      top: rowRect.top,
      right: clippedRight,
      bottom: rowRect.bottom,
      width: clippedRight - clippedLeft,
      height: rowRect.height,
      toJSON: () => ({}),
    } as DOMRect,
  };
}

function createClipDragMeasureTargetFromElement(element: HTMLElement): ClipDragMeasureTarget {
  return {
    element,
    clipId: element.dataset.clipId ?? null,
    rect: element.getBoundingClientRect(),
  };
}

function findClipDragMeasureTarget(args: Record<string, unknown> = {}): ClipDragMeasureTarget | null {
  const clipId = typeof args.clipId === 'string' && args.clipId.trim()
    ? args.clipId.trim()
    : '';
  if (clipId) {
    const element = findClipDragDomTargetById(clipId);
    if (element) return createClipDragMeasureTargetFromElement(element);
    return findClipDragCanvasTargetById(clipId);
  }

  const selectedClipIds = useTimelineStore.getState().selectedClipIds;
  for (const selectedClipId of selectedClipIds) {
    const selectedElement = findClipDragDomTargetById(selectedClipId);
    if (selectedElement) return createClipDragMeasureTargetFromElement(selectedElement);
    const canvasTarget = findClipDragCanvasTargetById(selectedClipId);
    if (canvasTarget) return canvasTarget;
  }

  const domCandidates = Array.from(document.querySelectorAll<HTMLElement>(
    '.clip-interaction-shell[data-clip-id], .timeline-clip-preview[data-clip-id]',
  ));
  const domTarget = domCandidates
    .map((element) => createClipDragMeasureTargetFromElement(element))
    .filter(({ rect }) => rect.width >= 32 && rect.height >= 12)
    .sort((left, right) => (right.rect.width * right.rect.height) - (left.rect.width * left.rect.height))[0] ?? null;
  if (domTarget) return domTarget;

  const timelineState = useTimelineStore.getState();
  return timelineState.clips
    .map((clip) => findClipDragCanvasTargetById(clip.id))
    .filter((target): target is ClipDragMeasureTarget => Boolean(target))
    .filter(({ rect }) => rect.width >= 32 && rect.height >= 12)
    .sort((left, right) => (right.rect.width * right.rect.height) - (left.rect.width * left.rect.height))[0] ?? null;
}

function dispatchMouseMeasureEvent(
  target: EventTarget,
  type: 'mousedown' | 'mousemove' | 'mouseup',
  clientX: number,
  clientY: number,
  buttons: number,
): void {
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons,
    clientX,
    clientY,
    screenX: clientX,
    screenY: clientY,
  }));
}

function dispatchPointerMeasureEvent(
  target: EventTarget,
  type: 'pointermove' | 'pointerup',
  clientX: number,
  clientY: number,
  buttons: number,
): void {
  if (typeof PointerEvent === 'undefined') return;
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons,
    clientX,
    clientY,
    screenX: clientX,
    screenY: clientY,
  }));
}

export async function measureClipDragInteraction(args: Record<string, unknown> = {}) {
  const durationMs = typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
    ? Math.max(500, Math.min(60000, Math.round(args.durationMs)))
    : 12000;
  const moveDistancePx = typeof args.moveDistancePx === 'number' && Number.isFinite(args.moveDistancePx)
    ? Math.max(8, Math.min(2000, Math.abs(args.moveDistancePx)))
    : 360;
  const cycles = typeof args.cycles === 'number' && Number.isFinite(args.cycles)
    ? Math.max(1, Math.min(20, Math.round(args.cycles)))
    : Math.max(2, Math.round(durationMs / 3000));
  const dispatchTargetMoves = args.dispatchTargetMoves === true;
  const dispatchPointerMoves = args.dispatchPointerMoves === true;
  const measureTarget = findClipDragMeasureTarget(args);

  if (!measureTarget) {
    return {
      success: false,
      error: 'No visible timeline clip found for drag measurement.',
      data: {
        snapshot: collectTimelineInteractionSnapshot(),
      },
    };
  }

  const target = measureTarget.element;
  const rect = measureTarget.rect;
  const originX = rect.left + Math.max(8, Math.min(rect.width - 8, rect.width * 0.5));
  const originY = rect.top + Math.max(8, Math.min(rect.height - 8, rect.height * 0.5));
  const clipId = measureTarget.clipId;
  const expectedFrameMs = 1000 / 60;
  const startedAt = performance.now();
  const frames: Array<{ elapsedMs: number; deltaMs: number }> = [];
  const longTasks: Array<Record<string, unknown>> = [];
  const longAnimationFrames: Array<Record<string, unknown>> = [];
  let observer: PerformanceObserver | null = null;
  let animationFrameObserver: PerformanceObserver | null = null;
  let previousFrameAt: number | null = null;
  let eventCount = 0;
  let clipDragPreviewChanges = 0;
  let layerChanges = 0;
  let clipArrayChanges = 0;
  let playheadChanges = 0;

  const beforeCache = summarizeProxyAudioCache();
  const beforeMemory = summarizePerformanceMemory();
  const beforeTimeline = useTimelineStore.getState();
  const beforeClip = clipId ? beforeTimeline.clips.find((clip) => clip.id === clipId) : undefined;
  const unsubscribeTimeline = useTimelineStore.subscribe(
    (state) => ({
      clipDragPreview: state.clipDragPreview,
      layers: state.layers,
      clips: state.clips,
      playheadPosition: state.playheadPosition,
    }),
    (current, previous) => {
      if (current.clipDragPreview !== previous.clipDragPreview) clipDragPreviewChanges += 1;
      if (current.layers !== previous.layers) layerChanges += 1;
      if (current.clips !== previous.clips) clipArrayChanges += 1;
      if (current.playheadPosition !== previous.playheadPosition) playheadChanges += 1;
    },
  );

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({
            name: entry.name,
            startTime: Math.round((entry.startTime - startedAt) * 100) / 100,
            durationMs: Math.round(entry.duration * 100) / 100,
            entryType: entry.entryType,
          });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      observer = null;
    }

    try {
      animationFrameObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longAnimationFrames.push({
            name: entry.name,
            startTime: Math.round((entry.startTime - startedAt) * 100) / 100,
            durationMs: Math.round(entry.duration * 100) / 100,
            entryType: entry.entryType,
          });
        }
      });
      animationFrameObserver.observe({ entryTypes: ['long-animation-frame'] });
    } catch {
      animationFrameObserver = null;
    }
  }

  try {
    dispatchMouseMeasureEvent(target, 'mousedown', originX, originY, 1);

    await new Promise<void>((resolve) => {
      const tick = (timestamp: number) => {
        const elapsed = timestamp - startedAt;
        if (previousFrameAt !== null) {
          frames.push({
            elapsedMs: Math.round(elapsed),
            deltaMs: Math.round((timestamp - previousFrameAt) * 100) / 100,
          });
        }
        previousFrameAt = timestamp;

        const progress = Math.min(1, Math.max(0, elapsed / durationMs));
        const offsetX = Math.sin(progress * Math.PI * 2 * cycles) * moveDistancePx;
        dispatchMouseMeasureEvent(dispatchTargetMoves ? target : document, 'mousemove', originX + offsetX, originY, 1);
        if (dispatchPointerMoves) {
          dispatchPointerMeasureEvent(target, 'pointermove', originX + offsetX, originY, 1);
        }
        eventCount += 1;

        if (elapsed >= durationMs) {
          resolve();
          return;
        }
        window.requestAnimationFrame(tick);
      };
      window.requestAnimationFrame(tick);
    });
  } finally {
    dispatchMouseMeasureEvent(dispatchTargetMoves ? target : document, 'mousemove', originX, originY, 1);
    dispatchMouseMeasureEvent(dispatchTargetMoves ? target : document, 'mouseup', originX, originY, 0);
    if (dispatchPointerMoves) {
      dispatchPointerMeasureEvent(target, 'pointermove', originX, originY, 1);
      dispatchPointerMeasureEvent(target, 'pointerup', originX, originY, 0);
    }
    unsubscribeTimeline();
    observer?.disconnect();
    animationFrameObserver?.disconnect();
  }

  await new Promise((resolve) => window.setTimeout(resolve, 250));

  const afterTimeline = useTimelineStore.getState();
  const afterClip = clipId ? afterTimeline.clips.find((clip) => clip.id === clipId) : undefined;
  const deltas = frames.map(frame => frame.deltaMs);
  const droppedFrameEstimate = deltas.reduce((sum, delta) => (
    sum + Math.max(0, Math.round(delta / expectedFrameMs) - 1)
  ), 0);
  const slowFrames = frames.filter(frame => frame.deltaMs > expectedFrameMs * 1.75);

  return {
    success: true,
    data: {
      clipId,
      durationMs,
      moveDistancePx,
      cycles,
      dispatchTargetMoves,
      dispatchPointerMoves,
      eventCount,
      frameCount: frames.length,
      estimatedFps: Math.round((frames.length / Math.max(1, durationMs / 1000)) * 100) / 100,
      frameDeltaMs: summarizeNumberList(deltas),
      slowFrameCount: slowFrames.length,
      droppedFrameEstimate,
      longTaskCount: longTasks.length,
      longAnimationFrameCount: longAnimationFrames.length,
      longTasks,
      longAnimationFrames,
      storeChanges: {
        clipDragPreview: clipDragPreviewChanges,
        layers: layerChanges,
        clips: clipArrayChanges,
        playheadPosition: playheadChanges,
      },
      beforeMemory,
      afterMemory: summarizePerformanceMemory(),
      beforeCache,
      afterCache: summarizeProxyAudioCache(),
      beforeClip: beforeClip
        ? { startTime: beforeClip.startTime, trackId: beforeClip.trackId }
        : null,
      afterClip: afterClip
        ? { startTime: afterClip.startTime, trackId: afterClip.trackId }
        : null,
      target: summarizeElementForDebug(target),
      frames: frames.slice(-300),
    },
  };
}
