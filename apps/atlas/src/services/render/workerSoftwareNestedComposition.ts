import type { Layer, NestedCompositionData } from '../../types';
import type { WorkerRenderSoftwareFrame } from './workerRenderHostRuntimeCommands';
import {
  drawWorkerSoftwareLayer,
  forEachWorkerSoftwareLayerInPaintOrder,
} from './workerRenderHostSoftwarePainter';
import type {
  WorkerLayerBitmapSource,
  WorkerSoftwarePreviewFrameBuildOptions,
  WorkerSoftwarePreviewFrameBuildResult,
  WorkerSoftwarePreviewSkipReason,
} from './workerSoftwarePreviewFrame';

const MAX_WORKER_SOFTWARE_NESTING_DEPTH = 8;

type SoftwareCanvas = OffscreenCanvas | HTMLCanvasElement;
type SoftwareCanvasContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

type BuildNestedFrame = (
  layers: readonly Layer[],
  size: { readonly width: number; readonly height: number },
  options: WorkerSoftwarePreviewFrameBuildOptions,
  depth: number,
) => Promise<WorkerSoftwarePreviewFrameBuildResult>;

function positiveDimension(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : fallback;
}

function createNestedSurface(width: number, height: number): {
  readonly canvas: SoftwareCanvas;
  readonly context: SoftwareCanvasContext;
} | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    return context ? { canvas, context } : null;
  }
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return context ? { canvas, context } : null;
}

function closeBitmapLayers(frame: WorkerRenderSoftwareFrame): void {
  for (const layer of frame.layers) {
    if (layer.source.kind !== 'bitmap') continue;
    try {
      layer.source.bitmap.close();
    } catch {
      // Ignore transferred or already-closed nested bitmap handles.
    }
  }
}

function firstBlockingSkipReason(
  diagnostics: WorkerSoftwarePreviewFrameBuildResult['diagnostics'],
): WorkerSoftwarePreviewSkipReason | null {
  const priority: readonly WorkerSoftwarePreviewSkipReason[] = [
    'createImageBitmap-failed',
    'video-not-ready',
    'video-seeking',
    'video-time-drift',
    'empty-video-frame',
    'empty-image',
    'empty-text-canvas',
    'missing-source',
    'unsupported-blend-mode',
    'unsupported-color-correction',
    'unsupported-effects',
    'unsupported-mask',
    'unsupported-nested-composition',
    'unsupported-source',
    'unsupported-transition',
    'scrub-hold',
  ];
  for (const reason of priority) {
    if (diagnostics.skippedByReason[reason] > 0) {
      return reason;
    }
  }
  return null;
}

function optionsForNestedRaster(
  options: WorkerSoftwarePreviewFrameBuildOptions,
): WorkerSoftwarePreviewFrameBuildOptions {
  const { workerBitmapCacheKeys: _workerBitmapCacheKeys, ...nestedOptions } = options;
  return nestedOptions;
}

export async function renderNestedCompositionBitmapSource(input: {
  readonly layer: Layer;
  readonly nestedComposition: NestedCompositionData;
  readonly options: WorkerSoftwarePreviewFrameBuildOptions;
  readonly depth: number;
  readonly buildNestedFrame: BuildNestedFrame;
}): Promise<WorkerLayerBitmapSource | { readonly reason: WorkerSoftwarePreviewSkipReason }> {
  if (input.depth >= MAX_WORKER_SOFTWARE_NESTING_DEPTH) {
    return { reason: 'unsupported-nested-composition' };
  }
  const width = positiveDimension(input.nestedComposition.width, 1);
  const height = positiveDimension(input.nestedComposition.height, 1);
  const nestedFrame = await input.buildNestedFrame(
    input.nestedComposition.layers,
    { width, height },
    optionsForNestedRaster(input.options),
    input.depth + 1,
  );
  const blockingReason = firstBlockingSkipReason(nestedFrame.diagnostics);
  if (blockingReason) {
    closeBitmapLayers(nestedFrame.frame);
    return { reason: blockingReason };
  }
  if (nestedFrame.frame.layers.length === 0) {
    return { reason: 'empty-image' };
  }

  const surface = createNestedSurface(width, height);
  if (!surface) {
    closeBitmapLayers(nestedFrame.frame);
    return { reason: 'unsupported-nested-composition' };
  }

  try {
    surface.context.clearRect(0, 0, width, height);
    forEachWorkerSoftwareLayerInPaintOrder(nestedFrame.frame, (nestedLayer) => {
      drawWorkerSoftwareLayer(
        surface.context as OffscreenCanvasRenderingContext2D,
        nestedLayer,
        width,
        height,
        input.nestedComposition.currentTime ?? 0,
      );
    });
  } finally {
    closeBitmapLayers(nestedFrame.frame);
  }

  return {
    source: surface.canvas as ImageBitmapSource,
    width,
    height,
    decoderKind: nestedFrame.diagnostics.webCodecsLayerCount > 0 && nestedFrame.diagnostics.htmlVideoLayerCount > 0
      ? 'mixed-video'
      : nestedFrame.diagnostics.webCodecsLayerCount > 0
        ? 'webcodecs'
        : nestedFrame.diagnostics.htmlVideoLayerCount > 0
          ? 'html-video'
          : undefined,
    contentKey: `nested-composition:${input.nestedComposition.compositionId}:${input.nestedComposition.currentTime ?? 'unknown'}:${width}x${height}`,
  };
}
