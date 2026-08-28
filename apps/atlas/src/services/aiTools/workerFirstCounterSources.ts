import type { FrameProviderStatus } from '../../engine/render/contracts/frameProviderPolicy';
import type { RenderCacheRegistrySnapshot } from '../renderJobs/renderCacheRegistry';
import type { RenderSchedulerSnapshot } from '../renderJobs/renderJobScheduler';
import type { WorkerGpuOnlyPlaybackDiagnostics } from '../../types/engineStats';
import { summarizeWorkerGpuOnlyPlaybackPaths } from '../playbackDebugStats';
import type { WorkerFirstProofCounters } from './workerFirstProofHarness';
import type { WorkerFirstProofCounterSources } from './workerFirstGateInputs';

export interface WorkerFirstRuntimeCounterSourceSnapshot {
  readonly scheduler: RenderSchedulerSnapshot | null;
  readonly cache: RenderCacheRegistrySnapshot | null;
  readonly providers: readonly FrameProviderStatus[];
  readonly transferLatencyMs: number | null;
  readonly providerWaitMs: number | null;
  readonly presentedFrameId: string | null;
  readonly presentedFrames: readonly WorkerFirstPresentedFrameEvent[];
  readonly workerGpuOnly: WorkerGpuOnlyPlaybackDiagnostics;
  readonly visiblePixels: Partial<WorkerFirstProofCounters['visiblePixels']>;
  readonly updatedAt: number | null;
}

export interface WorkerFirstPresentedFrameEvent {
  readonly t: number;
  readonly frameId: string;
  readonly targetId: string;
  readonly source: string;
  readonly changed: boolean;
  readonly targetMoved: boolean;
  readonly driftMs?: number;
}

const MAX_PRESENTED_FRAME_EVENTS = 2000;

let schedulerSnapshot: RenderSchedulerSnapshot | null = null;
let cacheSnapshot: RenderCacheRegistrySnapshot | null = null;
let providerStatuses: FrameProviderStatus[] = [];
let transferLatencyMs: number | null = null;
let providerWaitMs: number | null = null;
let presentedFrameId: string | null = null;
let presentedFrames: WorkerFirstPresentedFrameEvent[] = [];
let visiblePixels: Partial<WorkerFirstProofCounters['visiblePixels']> = {};
let updatedAt: number | null = null;

function touch(timestamp = Date.now()): number {
  updatedAt = Math.max(updatedAt ?? 0, timestamp);
  return timestamp;
}

function cloneScheduler(snapshot: RenderSchedulerSnapshot | null): RenderSchedulerSnapshot | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    byPriority: { ...snapshot.byPriority },
    byType: { ...snapshot.byType },
    counters: { ...snapshot.counters },
  };
}

function cloneCache(snapshot: RenderCacheRegistrySnapshot | null): RenderCacheRegistrySnapshot | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    bytesByOwner: { ...snapshot.bytesByOwner },
    counters: { ...snapshot.counters },
  };
}

function cloneProvider(status: FrameProviderStatus): FrameProviderStatus {
  return {
    ...status,
    substatus: [...status.substatus],
    counters: { ...status.counters },
  };
}

function summarizeWorkerGpuOnlyPresentedFrames(
  frames: readonly WorkerFirstPresentedFrameEvent[],
): WorkerGpuOnlyPlaybackDiagnostics {
  const previewPathCounts: Record<string, number> = {};
  for (const frame of frames) {
    const source = frame.source || 'worker-presenting';
    previewPathCounts[source] = (previewPathCounts[source] ?? 0) + 1;
  }
  return summarizeWorkerGpuOnlyPlaybackPaths(previewPathCounts);
}

export function clearWorkerFirstCounterSources(): void {
  schedulerSnapshot = null;
  cacheSnapshot = null;
  providerStatuses = [];
  transferLatencyMs = null;
  providerWaitMs = null;
  presentedFrameId = null;
  presentedFrames = [];
  visiblePixels = {};
  updatedAt = null;
}

export function clearWorkerFirstCounterSourcesForTests(): void {
  clearWorkerFirstCounterSources();
}

export function clearWorkerFirstPresentedFrameEvents(): void {
  presentedFrames = [];
}

export function recordWorkerFirstSchedulerSnapshot(
  snapshot: RenderSchedulerSnapshot,
  capturedAt?: number,
): void {
  touch(capturedAt);
  schedulerSnapshot = cloneScheduler(snapshot);
}

export function recordWorkerFirstCacheSnapshot(
  snapshot: RenderCacheRegistrySnapshot,
  capturedAt?: number,
): void {
  touch(capturedAt);
  cacheSnapshot = cloneCache(snapshot);
}

export function recordWorkerFirstProviderStatuses(
  statuses: readonly FrameProviderStatus[],
  capturedAt?: number,
): void {
  touch(capturedAt);
  providerStatuses = statuses.map(cloneProvider);
}

export function recordWorkerFirstTimingCounters(input: {
  readonly transferLatencyMs?: number | null;
  readonly providerWaitMs?: number | null;
  readonly presentedFrameId?: string | null;
}, capturedAt?: number): void {
  touch(capturedAt);
  if ('transferLatencyMs' in input) {
    transferLatencyMs = input.transferLatencyMs ?? null;
  }
  if ('providerWaitMs' in input) {
    providerWaitMs = input.providerWaitMs ?? null;
  }
  if ('presentedFrameId' in input) {
    presentedFrameId = input.presentedFrameId ?? null;
  }
}

export function recordWorkerFirstPresentedFrame(input: {
  readonly frameId: string;
  readonly targetId: string;
  readonly source?: string;
  readonly changed?: boolean;
  readonly targetMoved?: boolean;
  readonly driftMs?: number;
  readonly t?: number;
}, capturedAt?: number): void {
  touch(capturedAt);
  presentedFrameId = input.frameId;
  presentedFrames.push({
    t: typeof input.t === 'number' && Number.isFinite(input.t)
      ? input.t
      : typeof performance !== 'undefined'
        ? performance.now()
        : Date.now(),
    frameId: input.frameId,
    targetId: input.targetId,
    source: input.source ?? 'worker-presenting',
    changed: input.changed ?? true,
    targetMoved: input.targetMoved ?? true,
    ...(typeof input.driftMs === 'number' && Number.isFinite(input.driftMs) ? { driftMs: input.driftMs } : {}),
  });
  if (presentedFrames.length > MAX_PRESENTED_FRAME_EVENTS) {
    presentedFrames = presentedFrames.slice(-MAX_PRESENTED_FRAME_EVENTS);
  }
}

export function recordWorkerFirstVisiblePixelCounters(
  input: Partial<WorkerFirstProofCounters['visiblePixels']>,
  capturedAt?: number,
): void {
  touch(capturedAt);
  visiblePixels = { ...input };
}

export function recordWorkerFirstCounterSources(
  sources: WorkerFirstProofCounterSources,
  capturedAt?: number,
): void {
  touch(capturedAt);
  schedulerSnapshot = cloneScheduler(sources.scheduler ?? null);
  cacheSnapshot = cloneCache(sources.cache ?? null);
  providerStatuses = (sources.providers ?? []).map(cloneProvider);
  transferLatencyMs = sources.transferLatencyMs ?? null;
  providerWaitMs = sources.providerWaitMs ?? null;
  presentedFrameId = sources.presentedFrameId ?? null;
  presentedFrames = [];
  visiblePixels = { ...(sources.visiblePixels ?? {}) };
}

export function getWorkerFirstCounterSourceSnapshot(): WorkerFirstRuntimeCounterSourceSnapshot {
  return {
    scheduler: cloneScheduler(schedulerSnapshot),
    cache: cloneCache(cacheSnapshot),
    providers: providerStatuses.map(cloneProvider),
    transferLatencyMs,
    providerWaitMs,
    presentedFrameId,
    presentedFrames: presentedFrames.map((frame) => ({ ...frame })),
    workerGpuOnly: summarizeWorkerGpuOnlyPresentedFrames(presentedFrames),
    visiblePixels: { ...visiblePixels },
    updatedAt,
  };
}

export function getWorkerFirstGpuOnlyPresentedFrameSummary(): WorkerGpuOnlyPlaybackDiagnostics {
  return summarizeWorkerGpuOnlyPresentedFrames(presentedFrames);
}

export function getWorkerFirstPresentedFrameEvents(
  windowMs: number,
  now = typeof performance !== 'undefined' ? performance.now() : Date.now(),
): readonly WorkerFirstPresentedFrameEvent[] {
  const start = now - Math.max(0, windowMs);
  return presentedFrames
    .filter((frame) => frame.t >= start && frame.t <= now)
    .map((frame) => ({ ...frame }));
}

export function getWorkerFirstCounterSources(): WorkerFirstProofCounterSources {
  return {
    scheduler: cloneScheduler(schedulerSnapshot),
    cache: cloneCache(cacheSnapshot),
    providers: providerStatuses.map(cloneProvider),
    transferLatencyMs,
    providerWaitMs,
    presentedFrameId,
    visiblePixels: { ...visiblePixels },
  };
}
