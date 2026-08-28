import { useTimelineStore } from '../../../../stores/timeline';
import {
  clampPlaybackTime,
  waitForAnimationFrame,
  type ScrubMotionResult,
  type TimelineStore,
} from './runtime';

type TimelineDomDragTargets = {
  playhead: HTMLElement;
  tracks: HTMLElement;
  laneReference?: HTMLElement;
};

function getTimelineDomDragTargets(): TimelineDomDragTargets | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const playhead = document.querySelector<HTMLElement>('[data-ai-id="timeline-playhead"], .playhead');
  const tracks = document.querySelector<HTMLElement>('[data-ai-id="timeline-tracks"], .timeline-tracks');
  const laneReference = document.querySelector<HTMLElement>(
    '[data-guided-target="timeline-lane-reference"], .timeline-lane-reference'
  );
  if (!playhead || !tracks) {
    return null;
  }

  return { playhead, tracks, laneReference: laneReference ?? undefined };
}

function dispatchSyntheticMouseEvent(
  target: Document | HTMLElement,
  type: 'mousedown' | 'mousemove' | 'mouseup',
  clientX: number,
  clientY: number
): void {
  if (typeof MouseEvent !== 'function') {
    return;
  }

  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: typeof window !== 'undefined' ? window : null,
    button: 0,
    buttons: type === 'mouseup' ? 0 : 1,
    clientX,
    clientY,
  });
  target.dispatchEvent(event);
}

function getTimelineContentClientLeft(targets: TimelineDomDragTargets): number {
  if (targets.laneReference) {
    return targets.laneReference.getBoundingClientRect().left;
  }

  const tracksRect = targets.tracks.getBoundingClientRect();
  const originX = Number.parseFloat(targets.tracks.dataset.guidedTimelineOriginX ?? '0');
  return tracksRect.left + (Number.isFinite(originX) ? originX : 0);
}

function getTimelineClientXForTime(time: number, targets: TimelineDomDragTargets): number {
  const { zoom, scrollX } = useTimelineStore.getState();
  return getTimelineContentClientLeft(targets) + time * zoom - scrollX;
}

function hasFiniteClientCoordinates(clientX: number, clientY: number): boolean {
  return Number.isFinite(clientX) && Number.isFinite(clientY);
}

async function runStoreDrivenScrubMotion(
  timelineStore: TimelineStore,
  durationMs: number,
  sampleTimeAtElapsed: (elapsedMs: number) => number,
  pauseOnRelease: boolean
): Promise<ScrubMotionResult> {
  const state = useTimelineStore.getState();
  const duration = state.duration;
  const initialPosition = state.playheadPosition;
  const startedPlaying = state.isPlaying;
  const startedAt = performance.now();
  let framesApplied = 0;
  let minVisited = initialPosition;
  let maxVisited = initialPosition;
  let requestedEndTime = initialPosition;

  timelineStore.setDraggingPlayhead(true);

  try {
    while (true) {
      const elapsedMs = performance.now() - startedAt;
      requestedEndTime = clampPlaybackTime(sampleTimeAtElapsed(elapsedMs), duration);
      timelineStore.setPlayheadPosition(requestedEndTime);
      framesApplied++;
      const actualPosition = useTimelineStore.getState().playheadPosition;
      minVisited = Math.min(minVisited, requestedEndTime, actualPosition);
      maxVisited = Math.max(maxVisited, requestedEndTime, actualPosition);

      if (elapsedMs >= durationMs) {
        break;
      }

      await waitForAnimationFrame();
    }
  } finally {
    timelineStore.setDraggingPlayhead(false);
  }

  timelineStore.setPlayheadPosition(requestedEndTime);
  await waitForAnimationFrame();

  if (pauseOnRelease && useTimelineStore.getState().isPlaying) {
    timelineStore.pause();
    await waitForAnimationFrame();
  }

  const finalState = useTimelineStore.getState();
  return {
    dragMode: 'store_fallback',
    actualDurationMs: Math.round(performance.now() - startedAt),
    initialPosition,
    finalPosition: finalState.playheadPosition,
    requestedEndTime,
    framesApplied,
    minVisited,
    maxVisited,
    startedPlaying,
    pausedAfterGrab: false,
    endedPlaying: finalState.isPlaying,
    zoom: state.zoom,
    scrollX: state.scrollX,
  };
}

async function runDomPlayheadScrubMotion(
  timelineStore: TimelineStore,
  domTargets: TimelineDomDragTargets,
  durationMs: number,
  sampleTimeAtElapsed: (elapsedMs: number) => number,
  pauseOnRelease: boolean
): Promise<ScrubMotionResult> {
  const initialState = useTimelineStore.getState();
  const initialPosition = initialState.playheadPosition;
  const duration = initialState.duration;
  const startedPlaying = initialState.isPlaying;
  const playheadRect = domTargets.playhead.getBoundingClientRect();
  const tracksRect = domTargets.tracks.getBoundingClientRect();
  const startClientX =
    playheadRect.width > 0
      ? playheadRect.left + playheadRect.width / 2
      : getTimelineClientXForTime(initialPosition, domTargets);
  const clientY =
    playheadRect.height > 0
      ? playheadRect.top + playheadRect.height / 2
      : tracksRect.top + Math.min(12, Math.max(4, tracksRect.height / 2));

  if (!hasFiniteClientCoordinates(startClientX, clientY)) {
    return runStoreDrivenScrubMotion(timelineStore, durationMs, sampleTimeAtElapsed, pauseOnRelease);
  }

  dispatchSyntheticMouseEvent(domTargets.playhead, 'mousedown', startClientX, clientY);
  await waitForAnimationFrame();
  await waitForAnimationFrame();
  const pausedAfterGrab = startedPlaying && !useTimelineStore.getState().isPlaying;

  const startedAt = performance.now();
  let framesApplied = 0;
  let minVisited = initialPosition;
  let maxVisited = initialPosition;
  let requestedEndTime = initialPosition;

  while (true) {
    const elapsedMs = performance.now() - startedAt;
    requestedEndTime = clampPlaybackTime(sampleTimeAtElapsed(elapsedMs), duration);
    const nextClientX = getTimelineClientXForTime(requestedEndTime, domTargets);
    if (!hasFiniteClientCoordinates(nextClientX, clientY)) {
      dispatchSyntheticMouseEvent(document, 'mouseup', startClientX, clientY);
      await waitForAnimationFrame();
      return runStoreDrivenScrubMotion(timelineStore, durationMs, sampleTimeAtElapsed, pauseOnRelease);
    }
    dispatchSyntheticMouseEvent(document, 'mousemove', nextClientX, clientY);
    framesApplied++;
    const actualPosition = useTimelineStore.getState().playheadPosition;
    minVisited = Math.min(minVisited, requestedEndTime, actualPosition);
    maxVisited = Math.max(maxVisited, requestedEndTime, actualPosition);

    if (elapsedMs >= durationMs) {
      break;
    }

    await waitForAnimationFrame();
  }

  const endClientX = getTimelineClientXForTime(requestedEndTime, domTargets);
  if (!hasFiniteClientCoordinates(endClientX, clientY)) {
    dispatchSyntheticMouseEvent(document, 'mouseup', startClientX, clientY);
    await waitForAnimationFrame();
    return runStoreDrivenScrubMotion(timelineStore, durationMs, sampleTimeAtElapsed, pauseOnRelease);
  }
  dispatchSyntheticMouseEvent(document, 'mousemove', endClientX, clientY);
  dispatchSyntheticMouseEvent(document, 'mouseup', endClientX, clientY);
  await waitForAnimationFrame();
  await waitForAnimationFrame();

  if (useTimelineStore.getState().isDraggingPlayhead) {
    timelineStore.setDraggingPlayhead(false);
  }

  if (pauseOnRelease && useTimelineStore.getState().isPlaying) {
    timelineStore.pause();
    await waitForAnimationFrame();
  }

  const finalState = useTimelineStore.getState();
  return {
    dragMode: 'dom_playhead',
    actualDurationMs: Math.round(performance.now() - startedAt),
    initialPosition,
    finalPosition: finalState.playheadPosition,
    requestedEndTime,
    framesApplied,
    minVisited,
    maxVisited,
    startedPlaying,
    pausedAfterGrab,
    endedPlaying: finalState.isPlaying,
    zoom: initialState.zoom,
    scrollX: initialState.scrollX,
    startClientX,
    endClientX,
    pixelDistance: Math.abs(endClientX - startClientX),
  };
}

export async function runScrubMotion(
  timelineStore: TimelineStore,
  durationMs: number,
  sampleTimeAtElapsed: (elapsedMs: number) => number,
  pauseOnRelease: boolean
): Promise<ScrubMotionResult> {
  const domTargets = getTimelineDomDragTargets();
  if (domTargets) {
    return runDomPlayheadScrubMotion(
      timelineStore,
      domTargets,
      durationMs,
      sampleTimeAtElapsed,
      pauseOnRelease
    );
  }

  return runStoreDrivenScrubMotion(
    timelineStore,
    durationMs,
    sampleTimeAtElapsed,
    pauseOnRelease
  );
}
