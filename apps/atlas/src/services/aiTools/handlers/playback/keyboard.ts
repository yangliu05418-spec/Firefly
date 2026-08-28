import { useTimelineStore } from '../../../../stores/timeline';
import { playbackHealthMonitor } from '../../../playbackHealthMonitor';
import { renderHostPort } from '../../../render/renderHostPort';
import { vfPipelineMonitor } from '../../../vfPipelineMonitor';
import { wcPipelineMonitor } from '../../../wcPipelineMonitor';
import {
  clampPlaybackTime,
  collectPlaybackRunDiagnostics,
  readDurationMsArg,
  readFiniteNumber,
  waitForAnimationFrame,
  waitForTimeout,
  type PlaybackToolResult,
  type TimelineStore,
} from './runtime';

type FrameKey = 'ArrowLeft' | 'ArrowRight';
type DispatchTargetKind = 'activeElement' | 'body' | 'window';

const FRAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'left', 'right']);

function readCountArg(
  args: Record<string, unknown>,
  key: string,
  defaultValue: number,
): number {
  return readDurationMsArg(args, key, defaultValue, 0, 120);
}

function normalizeFrameKey(value: unknown): FrameKey | null {
  if (typeof value !== 'string') return null;
  if (!FRAME_KEYS.has(value)) return null;
  return value === 'left' || value === 'ArrowLeft' ? 'ArrowLeft' : 'ArrowRight';
}

function buildFrameKeySequence(args: Record<string, unknown>): FrameKey[] {
  if (Array.isArray(args.sequence)) {
    return args.sequence
      .map(normalizeFrameKey)
      .filter((key): key is FrameKey => key !== null)
      .slice(0, 120);
  }

  const direction = typeof args.direction === 'string' ? args.direction : 'both';
  if (direction === 'left') {
    return Array.from({ length: readCountArg(args, 'count', 1) }, () => 'ArrowLeft');
  }
  if (direction === 'right') {
    return Array.from({ length: readCountArg(args, 'count', 1) }, () => 'ArrowRight');
  }

  const leftCount = readCountArg(args, 'leftCount', 6);
  const rightCount = readCountArg(args, 'rightCount', 6);
  return [
    ...Array.from({ length: leftCount }, () => 'ArrowLeft' as const),
    ...Array.from({ length: rightCount }, () => 'ArrowRight' as const),
  ];
}

function describeEventTarget(target: EventTarget): string {
  if (typeof window !== 'undefined' && target === window) return 'window';
  if (typeof document !== 'undefined' && target === document.body) return 'body';
  if (target instanceof HTMLElement) {
    const id = target.id ? `#${target.id}` : '';
    const role = target.getAttribute('role');
    const roleLabel = role ? `[role="${role}"]` : '';
    return `${target.tagName.toLowerCase()}${id}${roleLabel}`;
  }
  return 'eventTarget';
}

function resolveDispatchTarget(kind: DispatchTargetKind): EventTarget {
  if (kind === 'window') return window;
  if (kind === 'body' && document.body) return document.body;
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement) {
    return activeElement;
  }
  return document.body ?? window;
}

function readDispatchTargetKind(value: unknown): DispatchTargetKind {
  return value === 'body' || value === 'window' ? value : 'activeElement';
}

function readWorkerGpuVideoDiagnostics(): Record<string, unknown> | null {
  const diagnostics = renderHostPort.getTelemetry().diagnostics ?? null;
  const stats = diagnostics?.lastGpuOnlyVideoFrameStats;
  if (!stats || typeof stats !== 'object') {
    return null;
  }
  const record = stats as Record<string, unknown>;
  return {
    presented: record['workerGpu.videoFrame.presented'],
    mode: record['workerGpu.videoFrame.mode'],
    timestampSeconds: record['workerGpu.videoFrame.timestampSeconds'],
    targetMediaTime: record['workerGpu.videoFrame.targetMediaTime'],
    currentFrameTimestampSeconds: record['workerGpu.videoFrame.currentFrameTimestampSeconds'],
    decodePending: record['workerGpu.videoFrame.decodePending'],
    decodeQueueSize: record['workerGpu.videoFrame.decodeQueueSize'],
    frameBufferSize: record['workerGpu.videoFrame.frameBufferSize'],
    pendingSeekKind: record['workerGpu.videoFrame.pendingSeekKind'],
    pendingSeekTargetSeconds: record['workerGpu.videoFrame.pendingSeekTargetSeconds'],
  };
}

export async function handleSimulateFrameKeypresses(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<PlaybackToolResult> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      success: false,
      error: 'simulateFrameKeypresses requires a browser window',
    };
  }

  const sequence = buildFrameKeySequence(args);
  const delayMs = readDurationMsArg(args, 'delayMs', 120, 0, 5_000);
  const settleMs = readDurationMsArg(args, 'settleMs', 150, 0, 5_000);
  const resetDiagnostics = args.resetDiagnostics !== false;
  const pauseBefore = args.pauseBefore !== false;
  const startTime = readFiniteNumber(args.startTime);
  const targetKind = readDispatchTargetKind(args.target);

  if (sequence.length === 0) {
    return {
      success: false,
      error: 'No ArrowLeft/ArrowRight keypresses requested',
    };
  }

  if (pauseBefore) {
    timelineStore.pause();
    await waitForAnimationFrame();
  }
  timelineStore.setDraggingPlayhead(false);
  if (startTime !== null) {
    timelineStore.setPlayheadPosition(clampPlaybackTime(startTime, timelineStore.duration));
    await waitForAnimationFrame();
  }

  if (resetDiagnostics) {
    wcPipelineMonitor.reset();
    vfPipelineMonitor.reset();
    playbackHealthMonitor.reset();
  }

  const startedAt = performance.now();
  const initialState = useTimelineStore.getState();
  const samples: Record<string, unknown>[] = [];

  for (let index = 0; index < sequence.length; index += 1) {
    const key = sequence[index]!;
    const beforeState = useTimelineStore.getState();
    const target = resolveDispatchTarget(targetKind);
    const event = new KeyboardEvent('keydown', {
      key,
      code: key,
      bubbles: true,
      cancelable: true,
      composed: true,
      repeat: false,
    });
    const dispatchReturned = target.dispatchEvent(event);

    if (delayMs > 0) {
      await waitForTimeout(delayMs);
    }
    await waitForAnimationFrame();

    const afterState = useTimelineStore.getState();
    samples.push({
      index,
      key,
      dispatchTarget: describeEventTarget(target),
      dispatchReturned,
      defaultPrevented: event.defaultPrevented,
      beforePosition: beforeState.playheadPosition,
      afterPosition: afterState.playheadPosition,
      deltaSeconds: afterState.playheadPosition - beforeState.playheadPosition,
      isPlaying: afterState.isPlaying,
      renderHostVideo: readWorkerGpuVideoDiagnostics(),
    });
  }

  if (settleMs > 0) {
    await waitForTimeout(settleMs);
  }
  await waitForAnimationFrame();

  const endedAt = performance.now();
  const finalState = useTimelineStore.getState();
  return {
    success: true,
    data: {
      keyCount: sequence.length,
      sequence,
      delayMs,
      settleMs,
      resetDiagnostics,
      pauseBefore,
      target: targetKind,
      initialPosition: initialState.playheadPosition,
      finalPosition: finalState.playheadPosition,
      deltaSeconds: finalState.playheadPosition - initialState.playheadPosition,
      samples,
      renderHost: renderHostPort.getTelemetry(),
      runDiagnostics: collectPlaybackRunDiagnostics(startedAt, endedAt),
    },
  };
}
