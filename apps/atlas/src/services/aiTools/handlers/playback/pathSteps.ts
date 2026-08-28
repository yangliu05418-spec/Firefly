import { useTimelineStore } from '../../../../stores/timeline';
import { getPlayheadPosition } from '../../../layerBuilder/PlayheadState';
import { runScrubMotion } from './scrubMotion';
import {
  clampPlaybackTime,
  waitForAnimationFrame,
  type TimelineStore,
} from './runtime';
import type { PlaybackPathStep } from './pathPreset';

export async function runPlaybackPathPlayStep(
  timelineStore: TimelineStore,
  step: Extract<PlaybackPathStep, { kind: 'play' }>
): Promise<Record<string, unknown>> {
  timelineStore.setDraggingPlayhead(false);
  if (!useTimelineStore.getState().isPlaying) {
    await timelineStore.play();
  }

  const startedAt = performance.now();
  const initialState = useTimelineStore.getState();
  const initialPosition = getPlayheadPosition(initialState.playheadPosition);
  const remainingPlayableSeconds = step.playableEndTime - initialPosition;
  if (remainingPlayableSeconds <= 0.05) {
    timelineStore.pause();
    await waitForAnimationFrame();

    return {
      kind: step.kind,
      label: step.label,
      requestedDurationMs: step.durationMs,
      actualDurationMs: Math.round(performance.now() - startedAt),
      initialPosition,
      finalPosition: useTimelineStore.getState().playheadPosition,
      deltaSeconds: 0,
      framesObserved: 0,
      movingFrames: 0,
      stalledFrames: 0,
      minVisited: initialPosition,
      maxVisited: initialPosition,
      endedPlaying: useTimelineStore.getState().isPlaying,
      playableEndTime: step.playableEndTime,
      skipped: true,
      skipReason: 'no_playable_media_remaining',
    };
  }
  let previousPosition = initialPosition;
  let framesObserved = 0;
  let movingFrames = 0;
  let stalledFrames = 0;
  let minVisited = initialPosition;
  let maxVisited = initialPosition;

  while (performance.now() - startedAt < step.durationMs) {
    await waitForAnimationFrame();
    const position = useTimelineStore.getState().playheadPosition;
    const moved = Math.abs(position - previousPosition) > 0.0001;
    framesObserved++;
    if (moved) {
      movingFrames++;
    } else {
      stalledFrames++;
    }
    minVisited = Math.min(minVisited, position);
    maxVisited = Math.max(maxVisited, position);
    previousPosition = position;
    if (position >= step.playableEndTime - 0.05) {
      break;
    }
  }

  if (step.pauseAtEnd) {
    timelineStore.pause();
    await waitForAnimationFrame();
  }

  const finalState = useTimelineStore.getState();
  return {
    kind: step.kind,
    label: step.label,
    requestedDurationMs: step.durationMs,
    actualDurationMs: Math.round(performance.now() - startedAt),
    initialPosition,
    finalPosition: finalState.playheadPosition,
    deltaSeconds: finalState.playheadPosition - initialPosition,
    framesObserved,
    movingFrames,
    stalledFrames,
    minVisited,
    maxVisited,
    playableEndTime: step.playableEndTime,
    endedPlaying: finalState.isPlaying,
  };
}

export async function runPlaybackPathScrubStep(
  timelineStore: TimelineStore,
  step: Extract<PlaybackPathStep, { kind: 'scrub' }>
): Promise<Record<string, unknown>> {
  if (step.beginWhilePlaying && !useTimelineStore.getState().isPlaying) {
    await timelineStore.play();
    await waitForAnimationFrame();
  }

  const duration = useTimelineStore.getState().duration;
  const initialPosition = useTimelineStore.getState().playheadPosition;
  const targetTime = clampPlaybackTime(step.targetTime, duration);
  const scrubResult = await runScrubMotion(
    timelineStore,
    step.durationMs,
    (elapsedMs) => {
      const progress = Math.min(1, elapsedMs / Math.max(step.durationMs, 1));
      return initialPosition + (targetTime - initialPosition) * progress;
    },
    step.pauseOnRelease
  );

  return {
    kind: step.kind,
    label: step.label,
    requestedDurationMs: step.durationMs,
    actualDurationMs: scrubResult.actualDurationMs,
    initialPosition: scrubResult.initialPosition,
    finalPosition: scrubResult.finalPosition,
    targetTime,
    unclampedTargetTime: step.unclampedTargetTime,
    targetWasClamped: Math.abs(targetTime - step.unclampedTargetTime) > 0.0001,
    requestedEndTime: scrubResult.requestedEndTime,
    framesApplied: scrubResult.framesApplied,
    minVisited: scrubResult.minVisited,
    maxVisited: scrubResult.maxVisited,
    dragMode: scrubResult.dragMode,
    pausedAfterGrab: scrubResult.pausedAfterGrab,
    zoom: scrubResult.zoom,
    scrollX: scrubResult.scrollX,
    startClientX: scrubResult.startClientX,
    endClientX: scrubResult.endClientX,
    pixelDistance: scrubResult.pixelDistance,
    beganWhilePlaying: step.beginWhilePlaying,
    pausedOnRelease: step.pauseOnRelease,
    endedPlaying: scrubResult.endedPlaying,
  };
}
