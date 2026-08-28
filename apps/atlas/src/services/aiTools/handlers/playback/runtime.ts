import { useEngineStore } from '../../../../stores/engineStore';
import { playbackHealthMonitor } from '../../../playbackHealthMonitor';
import { buildPlaybackRunDiagnostics } from '../../../playbackDebugStats';
import { vfPipelineMonitor } from '../../../vfPipelineMonitor';
import { wcPipelineMonitor } from '../../../wcPipelineMonitor';
import { getWorkerFirstPresentedFrameEvents } from '../../workerFirstCounterSources';

export type TimelineStore = ReturnType<typeof import('../../../../stores/timeline').useTimelineStore.getState>;

export interface PlaybackToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export type ScrubMotionResult = {
  dragMode: 'dom_playhead' | 'store_fallback';
  actualDurationMs: number;
  initialPosition: number;
  finalPosition: number;
  requestedEndTime: number;
  framesApplied: number;
  minVisited: number;
  maxVisited: number;
  startedPlaying: boolean;
  pausedAfterGrab: boolean;
  endedPlaying: boolean;
  zoom: number;
  scrollX: number;
  startClientX?: number;
  endClientX?: number;
  pixelDistance?: number;
};

export function waitForAnimationFrame(maxWaitMs = 120): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    let rafId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const finish = (timestamp?: number) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      if (rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
      }
      resolve(typeof timestamp === 'number' ? timestamp : performance.now());
    };

    timeoutId = setTimeout(() => finish(), Math.max(0, maxWaitMs));
    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(finish);
      return;
    }
  });
}

export function clampPlaybackTime(time: number, duration: number): number {
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  return Math.min(safeDuration, Math.max(0, time));
}

export function waitForTimeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

export function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function readDurationMsArg(
  args: Record<string, unknown>,
  key: string,
  defaultValue: number,
  minValue: number,
  maxValue = Number.POSITIVE_INFINITY,
): number {
  const parsed = readFiniteNumber(args[key]);
  const rawValue = parsed ?? defaultValue;
  return Math.max(minValue, Math.min(maxValue, Math.round(rawValue)));
}

export function collectPlaybackRunDiagnostics(startMs: number, endMs: number) {
  const windowMs = Math.max(100, Math.ceil(endMs - startMs + 250));
  const { engineStats } = useEngineStore.getState();
  const workerPreviewEvents = getWorkerFirstPresentedFrameEvents(windowMs, endMs);
  const healthAnomalies = playbackHealthMonitor
    .anomalies()
    .filter((anomaly) => anomaly.timestamp >= startMs && anomaly.timestamp <= endMs);

  return buildPlaybackRunDiagnostics({
    decoder: engineStats.decoder,
    startMs,
    endMs,
    wcEvents: wcPipelineMonitor.timeline(windowMs),
    vfEvents: vfPipelineMonitor.timeline(windowMs),
    workerPreviewEvents,
    healthVideos: playbackHealthMonitor.videos(),
    healthAnomalies,
  });
}
