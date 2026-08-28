import { frequencyToGraphX } from '../../../../engine/audio/eq/AudioEqGraphViewModel';
import { detectAudioEqSpectrumGrabPeaks } from '../../../../engine/audio/eq/AudioEqSpectrumGrab';
import { getAudioEqSpectralDynamicsBandRange } from '../../../../engine/audio/eq/AudioEqSpectralDynamics';
import type { AudioEqCurvePoint } from '../../../../engine/audio/eq/AudioEqCurveFitting';
import type {
  AudioEqAnalyzerView,
  AudioEqBand,
  AudioEqGraphViewModel,
  AudioEqParamsV2,
} from '../../../../engine/audio/eq/AudioEqTypes';
import {
  DEFAULT_GRAPH_HEIGHT,
  DEFAULT_GRAPH_WIDTH,
  GRAPH_MAX_FREQUENCY_HZ,
  GRAPH_MIN_FREQUENCY_HZ,
  clamp,
} from './graphMath';
import {
  drawAnalyzer,
  drawCachedFrequencyGrid,
  drawResponseArea,
  drawResponseCurve,
  drawSketchPreview,
  drawSpectrumGrabPeaks,
} from './canvasPrimitives';

export type FlexEqGraphMode = 'edit' | 'sketch' | 'grab';

export interface FlexEqDrawState {
  view: AudioEqGraphViewModel;
  params: AudioEqParamsV2;
  analyzer: AudioEqAnalyzerView | undefined;
  hoveredBandId: string | undefined;
  selectedBandIds: readonly string[];
  soloBandIds: readonly string[];
  graphMode: FlexEqGraphMode;
  sketchPoints: readonly AudioEqCurvePoint[];
  staticVersion: number;
}

export interface FlexEqCanvasRenderCache {
  overlayCanvas?: HTMLCanvasElement;
  overlayKey?: string;
}

function drawSpectralDynamicsOverlays(
  ctx: CanvasRenderingContext2D,
  bands: readonly AudioEqBand[],
  width: number,
  height: number,
  selectedBandIds: readonly string[],
): void {
  const activeBands = bands.filter(band => (
    band.enabled !== false &&
    band.spectralDynamics?.enabled === true &&
    band.type !== 'all-pass'
  ));
  if (activeBands.length === 0) return;

  ctx.save();
  for (const band of activeBands) {
    const selected = selectedBandIds.includes(band.id);
    const range = getAudioEqSpectralDynamicsBandRange(band, 48_000);
    const x0 = clamp(frequencyToGraphX(Math.max(GRAPH_MIN_FREQUENCY_HZ, range.minHz), width), 0, width);
    const x1 = clamp(frequencyToGraphX(Math.min(GRAPH_MAX_FREQUENCY_HZ, range.maxHz), width), 0, width);
    const left = Math.min(x0, x1);
    const bandWidth = Math.max(1, Math.abs(x1 - x0));
    const gradient = ctx.createLinearGradient(left, 0, left + bandWidth, 0);
    gradient.addColorStop(0, selected ? 'rgba(112, 246, 220, 0.02)' : 'rgba(112, 246, 220, 0.01)');
    gradient.addColorStop(0.5, selected ? 'rgba(112, 246, 220, 0.22)' : 'rgba(112, 246, 220, 0.10)');
    gradient.addColorStop(1, selected ? 'rgba(112, 246, 220, 0.02)' : 'rgba(112, 246, 220, 0.01)');
    ctx.fillStyle = gradient;
    ctx.fillRect(left, 0, bandWidth, height);
    ctx.strokeStyle = selected ? 'rgba(112, 246, 220, 0.54)' : 'rgba(112, 246, 220, 0.22)';
    ctx.lineWidth = selected ? 1.1 : 0.7;
    ctx.beginPath();
    ctx.moveTo(left, 0);
    ctx.lineTo(left, height);
    ctx.moveTo(left + bandWidth, 0);
    ctx.lineTo(left + bandWidth, height);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEqualizerStaticOverlay(
  ctx: CanvasRenderingContext2D,
  view: AudioEqGraphViewModel,
  params: AudioEqParamsV2,
  hoveredBandId: string | undefined,
  selectedBandIds: readonly string[],
  soloBandIds: readonly string[],
  graphMode: FlexEqGraphMode,
  sketchPoints: readonly AudioEqCurvePoint[],
): void {
  const { width, height } = view;
  drawSpectralDynamicsOverlays(ctx, params.audible.bands, width, height, selectedBandIds);

  const soloSet = new Set(soloBandIds);
  const hasSolo = soloSet.size > 0;
  for (const band of view.bandResponses) {
    if (!band.enabled) continue;
    drawResponseArea(
      ctx,
      view.xFrequenciesHz,
      band.responseDb,
      width,
      height,
      view.rangeDb,
      band.color,
      hasSolo && !soloSet.has(band.bandId) ? 0.06 : 0.24,
    );
  }

  drawResponseArea(ctx, view.xFrequenciesHz, view.summedResponseDb, width, height, view.rangeDb, '#b149ff', 0.18);
  drawResponseCurve(ctx, view.xFrequenciesHz, view.summedResponseDb, width, height, view.rangeDb);

  for (const band of view.bandResponses) {
    const selected = selectedBandIds.includes(band.bandId);
    const hovered = hoveredBandId === band.bandId;
    ctx.save();
    ctx.globalAlpha = band.enabled ? (hasSolo && !soloSet.has(band.bandId) ? 0.32 : 1) : 0.36;
    ctx.beginPath();
    ctx.arc(band.handle.x, band.handle.y, selected || hovered ? 7 : 5.5, 0, Math.PI * 2);
    ctx.fillStyle = band.color;
    ctx.fill();
    ctx.lineWidth = selected || hovered ? 2.2 : 1.3;
    ctx.strokeStyle = selected || hovered ? '#ffffff' : 'rgba(255,255,255,0.72)';
    ctx.stroke();
    ctx.restore();
  }

  if (graphMode === 'sketch') {
    drawSketchPreview(ctx, sketchPoints, width, height, view.rangeDb);
  }
}

function drawCachedEqualizerStaticOverlay(
  ctx: CanvasRenderingContext2D,
  cache: FlexEqCanvasRenderCache,
  view: AudioEqGraphViewModel,
  params: AudioEqParamsV2,
  hoveredBandId: string | undefined,
  selectedBandIds: readonly string[],
  soloBandIds: readonly string[],
  graphMode: FlexEqGraphMode,
  sketchPoints: readonly AudioEqCurvePoint[],
  dpr: number,
  staticVersion: number,
): void {
  if (typeof document === 'undefined') {
    drawEqualizerStaticOverlay(ctx, view, params, hoveredBandId, selectedBandIds, soloBandIds, graphMode, sketchPoints);
    return;
  }

  const pixelWidth = Math.round(view.width * dpr);
  const pixelHeight = Math.round(view.height * dpr);
  const overlayKey = `${pixelWidth}x${pixelHeight}:${Math.round(dpr * 100)}:${staticVersion}`;
  let overlay = cache.overlayKey === overlayKey ? cache.overlayCanvas : undefined;

  if (!overlay) {
    // Reuse the cached canvas across redraws: band drags invalidate the key on
    // every frame, and allocating a fresh DPR-sized canvas per move causes
    // visible GC churn.
    overlay = cache.overlayCanvas ?? document.createElement('canvas');
    const overlayContext = overlay.getContext('2d');
    if (!overlayContext) {
      drawEqualizerStaticOverlay(ctx, view, params, hoveredBandId, selectedBandIds, soloBandIds, graphMode, sketchPoints);
      return;
    }
    if (overlay.width !== pixelWidth || overlay.height !== pixelHeight) {
      overlay.width = pixelWidth;
      overlay.height = pixelHeight;
    } else {
      overlayContext.setTransform(1, 0, 0, 1, 0, 0);
      overlayContext.clearRect(0, 0, pixelWidth, pixelHeight);
    }
    overlayContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawEqualizerStaticOverlay(overlayContext, view, params, hoveredBandId, selectedBandIds, soloBandIds, graphMode, sketchPoints);
    cache.overlayCanvas = overlay;
    cache.overlayKey = overlayKey;
  }

  ctx.drawImage(overlay, 0, 0, view.width, view.height);
}

export function drawEqualizerCanvas(
  canvas: HTMLCanvasElement,
  cache: FlexEqCanvasRenderCache,
  view: AudioEqGraphViewModel,
  params: AudioEqParamsV2,
  analyzer: AudioEqAnalyzerView | undefined,
  hoveredBandId: string | undefined,
  selectedBandIds: readonly string[],
  soloBandIds: readonly string[],
  graphMode: FlexEqGraphMode,
  sketchPoints: readonly AudioEqCurvePoint[],
  staticVersion: number,
): void {
  // The view model carries the ResizeObserver-driven graph size; reading
  // layout here (getBoundingClientRect) would force a reflow on every
  // analyzer frame while the spectrum animates at up to 60fps.
  const width = Math.max(1, Math.round(view.width || DEFAULT_GRAPH_WIDTH));
  const height = Math.max(1, Math.round(view.height || DEFAULT_GRAPH_HEIGHT));
  const dpr = Math.max(1, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  drawCachedFrequencyGrid(ctx, width, height, view.rangeDb, dpr);
  const analyzerMode = params.display.analyzerMode === 'off' ? 'post' : params.display.analyzerMode;
  const sourceAnalyzerDb = analyzer?.preDb ?? analyzer?.postDb;
  if (analyzerMode === 'pre' || analyzerMode === 'pre-post') {
    drawAnalyzer(ctx, sourceAnalyzerDb, width, height, 'rgba(156, 161, 178, 0.22)', 'rgba(210, 218, 232, 0.34)');
  }
  if (analyzerMode === 'post' || analyzerMode === 'pre-post') {
    drawAnalyzer(ctx, sourceAnalyzerDb, width, height, 'rgba(241, 211, 79, 0.13)', 'rgba(241, 211, 79, 0.42)', view.summedResponseDb);
  }
  if (graphMode === 'grab') {
    const grabPeaks = detectAudioEqSpectrumGrabPeaks(sourceAnalyzerDb, { maxPeaks: 8 });
    drawSpectrumGrabPeaks(ctx, grabPeaks, width, height);
  }

  drawCachedEqualizerStaticOverlay(
    ctx,
    cache,
    view,
    params,
    hoveredBandId,
    selectedBandIds,
    soloBandIds,
    graphMode,
    sketchPoints,
    dpr,
    staticVersion,
  );
}
