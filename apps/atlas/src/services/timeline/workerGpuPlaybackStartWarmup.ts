import type { TimelineClip } from '../../types';
import { renderHostPort } from '../render/renderHostPort';
import type { RenderHostPort } from '../render/renderHostTypes';

const DEFAULT_WORKER_GPU_PLAYBACK_START_TIMEOUT_MS = 360;
const COLD_SOURCE_LOAD_WORKER_GPU_PLAYBACK_START_TIMEOUT_MS = 5000;
const HOT_RESUME_WORKER_GPU_PLAYBACK_START_TIMEOUT_MS = 16;
const STALE_BEHIND_WORKER_GPU_PLAYBACK_START_TIMEOUT_MS = 32;
const STALE_AHEAD_WORKER_GPU_PLAYBACK_START_TIMEOUT_MS = 160;
const MIN_START_FRAME_TOLERANCE_SECONDS = 0.018;
const START_FRAME_TOLERANCE_FRAMES = 1.25;
const HOT_RESUME_START_FRAME_TOLERANCE_FRAMES = 3.5;
const NORMAL_PLAYBACK_SPEED_EPSILON = 0.001;

type WorkerGpuPlaybackStartWarmupHost = Pick<RenderHostPort, 'getTelemetry' | 'requestNewFrameRender'>;

interface WorkerGpuPlaybackStartWarmupOptions {
  readonly targetTime: number;
  readonly playbackSpeed: number;
  readonly timeoutMs?: number;
  readonly host?: WorkerGpuPlaybackStartWarmupHost;
  readonly waitForFrame?: () => Promise<void>;
  readonly now?: () => number;
}

export function hasWorkerGpuPlaybackStartVideoSource(clip: TimelineClip): boolean {
  const source = clip.source;
  if (source?.type === 'video') return true;
  if (source?.runtimeSourceId) return true;
  return typeof clip.file?.type === 'string' && clip.file.type.startsWith('video/');
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function getDiagnostics(host: WorkerGpuPlaybackStartWarmupHost): Record<string, unknown> | null {
  try {
    return host.getTelemetry().diagnostics ?? null;
  } catch {
    return null;
  }
}

function readPresentedStartFrame(host: WorkerGpuPlaybackStartWarmupHost): {
  readonly timestamp: number | null;
  readonly frameRate: number | null;
  readonly hotResumePending: boolean;
  readonly presented: boolean | null;
  readonly streamStartPending: boolean;
  readonly sourceLoadPending: boolean;
} {
  const diagnostics = getDiagnostics(host);
  if (!diagnostics) {
    return {
      timestamp: null,
      frameRate: null,
      hotResumePending: false,
      presented: null,
      streamStartPending: false,
      sourceLoadPending: false,
    };
  }
  const frameStats = diagnostics.lastGpuOnlyVideoFrameStats;
  const stats = frameStats && typeof frameStats === 'object'
    ? frameStats as Record<string, unknown>
    : {};
  const presented = typeof stats['workerGpu.videoFrame.presented'] === 'boolean'
    ? stats['workerGpu.videoFrame.presented']
    : null;
  const pendingSeekKind = stats['workerGpu.videoFrame.pendingSeekKind'];
  const pendingStreamStarts = readNumber(diagnostics.pendingGpuStreamStartCount) ?? 0;
  const pendingSourceLoads = readNumber(diagnostics.pendingGpuVideoSourceLoadCount) ?? 0;
  const streamActive = stats['workerGpu.videoFrame.workerStream.active'] === true;
  const streamPresentedFrameCount = readNumber(
    stats['workerGpu.videoFrame.workerStream.presentedFrameCount'],
  );
  const streamStartPending =
    pendingStreamStarts > 0 ||
    (streamActive && (streamPresentedFrameCount === null || streamPresentedFrameCount <= 0));
  const sourceLoadPending = pendingSourceLoads > 0;
  const hotResumePending =
    readBoolean(stats['workerGpu.videoFrame.decodePending']) ||
    pendingSeekKind === 'seek' ||
    streamStartPending ||
    sourceLoadPending;
  const timestamp = presented === false || streamStartPending || sourceLoadPending
    ? null
    : readNumber(diagnostics.lastGpuOnlyVideoFrameTimestampSeconds);
  return {
    timestamp,
    frameRate: readNumber(diagnostics.lastGpuOnlyVideoFrameSourceFrameRate),
    hotResumePending,
    presented,
    streamStartPending,
    sourceLoadPending,
  };
}

function isNormalForwardPlayback(playbackSpeed: number): boolean {
  return Math.abs(playbackSpeed - 1) <= NORMAL_PLAYBACK_SPEED_EPSILON;
}

function waitForAnimationFrame(): Promise<void> {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve();
      };
      const timeoutId = setTimeout(finish, 16);
      requestAnimationFrame(finish);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 16));
}

export function shouldWarmWorkerGpuForwardPlaybackStart(input: {
  readonly hasVideoAtPlaybackStart: boolean;
  readonly playbackSpeed: number;
  readonly host?: WorkerGpuPlaybackStartWarmupHost;
}): boolean {
  if (!input.hasVideoAtPlaybackStart || !isNormalForwardPlayback(input.playbackSpeed)) {
    return false;
  }
  const host = input.host ?? renderHostPort;
  try {
    const telemetry = host.getTelemetry();
    return telemetry.mode === 'worker-gpu-only' &&
      telemetry.diagnostics?.strictWorkerOnly === true;
  } catch {
    return false;
  }
}

export function isWorkerGpuPlaybackStartFrameReady(input: {
  readonly targetTime: number;
  readonly host?: WorkerGpuPlaybackStartWarmupHost;
}): boolean {
  const host = input.host ?? renderHostPort;
  return isStartFrameNearTarget(readPresentedStartFrame(host), input.targetTime);
}

function startFrameToleranceSeconds(frame: {
  readonly frameRate: number | null;
  readonly hotResumePending: boolean;
  readonly streamStartPending?: boolean;
  readonly sourceLoadPending?: boolean;
}): number {
  const sourceFrameRate = frame.frameRate && frame.frameRate > 0 ? frame.frameRate : 60;
  const toleranceFrames = frame.hotResumePending
    ? HOT_RESUME_START_FRAME_TOLERANCE_FRAMES
    : START_FRAME_TOLERANCE_FRAMES;
  return Math.max(
    MIN_START_FRAME_TOLERANCE_SECONDS,
    toleranceFrames / sourceFrameRate,
  );
}

function isStartFrameNearTarget(frame: {
  readonly timestamp: number | null;
  readonly frameRate: number | null;
  readonly hotResumePending: boolean;
  readonly streamStartPending?: boolean;
  readonly sourceLoadPending?: boolean;
}, targetTime: number): boolean {
  if (frame.streamStartPending === true) return false;
  if (frame.sourceLoadPending === true) return false;
  if (frame.timestamp === null) return false;
  return Math.abs(frame.timestamp - targetTime) <= startFrameToleranceSeconds(frame);
}

function startFrameWarmupTimeoutMs(input: {
  readonly targetTime: number;
  readonly initialFrame: ReturnType<typeof readPresentedStartFrame>;
  readonly overrideTimeoutMs?: number;
}): number {
  if (input.overrideTimeoutMs !== undefined) {
    return input.overrideTimeoutMs;
  }
  if (input.initialFrame.sourceLoadPending) {
    return COLD_SOURCE_LOAD_WORKER_GPU_PLAYBACK_START_TIMEOUT_MS;
  }
  if (input.initialFrame.timestamp === null) {
    return DEFAULT_WORKER_GPU_PLAYBACK_START_TIMEOUT_MS;
  }
  if (isStartFrameNearTarget(input.initialFrame, input.targetTime)) {
    return HOT_RESUME_WORKER_GPU_PLAYBACK_START_TIMEOUT_MS;
  }
  return input.initialFrame.timestamp < input.targetTime
    ? STALE_BEHIND_WORKER_GPU_PLAYBACK_START_TIMEOUT_MS
    : STALE_AHEAD_WORKER_GPU_PLAYBACK_START_TIMEOUT_MS;
}

export async function waitForWorkerGpuPlaybackStartFrame(
  options: WorkerGpuPlaybackStartWarmupOptions,
): Promise<boolean> {
  const host = options.host ?? renderHostPort;
  if (
    !shouldWarmWorkerGpuForwardPlaybackStart({
      hasVideoAtPlaybackStart: true,
      playbackSpeed: options.playbackSpeed,
      host,
    })
  ) {
    return false;
  }

  const waitForFrame = options.waitForFrame ?? waitForAnimationFrame;
  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const initialFrame = readPresentedStartFrame(host);
  let timeoutMs = startFrameWarmupTimeoutMs({
    targetTime: options.targetTime,
    initialFrame,
    overrideTimeoutMs: options.timeoutMs,
  });
  const startedAt = now();

  if (isWorkerGpuPlaybackStartFrameReady({ targetTime: options.targetTime, host })) {
    return true;
  }

  do {
    host.requestNewFrameRender();
    await waitForFrame();
    const currentFrame = readPresentedStartFrame(host);
    if (options.timeoutMs === undefined && currentFrame.sourceLoadPending) {
      timeoutMs = Math.max(
        timeoutMs,
        COLD_SOURCE_LOAD_WORKER_GPU_PLAYBACK_START_TIMEOUT_MS,
      );
    }
    if (isWorkerGpuPlaybackStartFrameReady({ targetTime: options.targetTime, host })) {
      return true;
    }
  } while (now() - startedAt < timeoutMs);

  return isWorkerGpuPlaybackStartFrameReady({ targetTime: options.targetTime, host });
}
