import type { RenderCommandTarget } from '../../engine/render/contracts/workerRenderGraph';
import type { WorkerRenderSoftwareFrame } from './workerRenderHostRuntimeCommands';

export const WORKER_PRESENTING_TRANSIENT_RETRY_LIMIT = 2;
export const WORKER_PRESENTING_TRANSIENT_RETRY_DELAY_MS = 24;
export const WORKER_PRESENTING_SCRUB_SNAPSHOT_MAX_EDGE = 960;
export const WORKER_PRESENTING_PLAYBACK_SNAPSHOT_MAX_EDGE = 1280;
export const WORKER_PRESENTING_HIGH_FPS_PLAYBACK_SNAPSHOT_MAX_EDGE = 960;
export const WORKER_PRESENTING_HIGH_FPS_THRESHOLD = 50;
export const WORKER_PRESENTING_SOFTWARE_BITMAP_CACHE_KEY_LIMIT = 24;
export const WORKER_PRESENTING_SCRUB_SNAPSHOT_MAX_SIZE = {
  width: WORKER_PRESENTING_SCRUB_SNAPSHOT_MAX_EDGE,
  height: WORKER_PRESENTING_SCRUB_SNAPSHOT_MAX_EDGE,
};
export const WORKER_PRESENTING_CACHED_SCRUB_SNAPSHOT_MAX_DRIFT_SECONDS = 1.25;
export const WORKER_PRESENTING_LIVE_SCRUB_SNAPSHOT_MAX_DRIFT_SECONDS = 0.75;

export interface WorkerRenderTargetSizingRecord {
  readonly target: RenderCommandTarget;
}

export function createWorkerCanvasContext(targetId: string, canvas: HTMLCanvasElement): GPUCanvasContext {
  return {
    __workerRenderHostContext: true,
    targetId,
    canvas,
  } as unknown as GPUCanvasContext;
}

export function createWorkerRenderTarget(targetId: string, canvas: HTMLCanvasElement): RenderCommandTarget {
  return {
    id: targetId,
    compositionId: 'active',
    size: {
      x: canvas.width || canvas.clientWidth || 1,
      y: canvas.height || canvas.clientHeight || 1,
    },
    devicePixelRatio: globalThis.devicePixelRatio || 1,
    showTransparencyGrid: false,
    presentation: 'offscreen-canvas',
  };
}

export function waitForWorkerPresentingRetry(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, WORKER_PRESENTING_TRANSIENT_RETRY_DELAY_MS);
  });
}

export function documentVisibilityDiagnostics(): {
  readonly visibilityState: string | null;
  readonly hidden: boolean | null;
  readonly hasFocus: boolean | null;
} {
  if (typeof document === 'undefined') {
    return { visibilityState: null, hidden: null, hasFocus: null };
  }
  return {
    visibilityState: typeof document.visibilityState === 'string' ? document.visibilityState : null,
    hidden: typeof document.hidden === 'boolean' ? document.hidden : null,
    hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : null,
  };
}

export function bitmapSnapshotMaxSizeForPresentation(
  record: WorkerRenderTargetSizingRecord,
  isScrubbing: boolean,
  isPlaying = false,
  playbackTargetFps = 30,
): { readonly width: number; readonly height: number } {
  const width = Math.max(1, record.target.size.x);
  const height = Math.max(1, record.target.size.y);
  const playbackLimit = playbackTargetFps >= WORKER_PRESENTING_HIGH_FPS_THRESHOLD
    ? WORKER_PRESENTING_HIGH_FPS_PLAYBACK_SNAPSHOT_MAX_EDGE
    : WORKER_PRESENTING_PLAYBACK_SNAPSHOT_MAX_EDGE;
  const limit = isScrubbing
    ? WORKER_PRESENTING_SCRUB_SNAPSHOT_MAX_EDGE
    : isPlaying
      ? playbackLimit
      : null;
  if (!limit) return { width, height };
  const maxEdge = Math.max(width, height);
  if (maxEdge <= limit) return { width, height };
  const scale = limit / maxEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function collectWorkerSoftwareBitmapCacheKeys(frame: WorkerRenderSoftwareFrame): string[] {
  return frame.layers.flatMap((layer) => (
    layer.source.kind === 'bitmap' && layer.source.cacheKey
      ? [layer.source.cacheKey]
      : []
  ));
}
