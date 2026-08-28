import { dbToGraphY, frequencyToGraphX } from '../../../../engine/audio/eq/AudioEqGraphViewModel';
import type { AudioEqCurvePoint } from '../../../../engine/audio/eq/AudioEqCurveFitting';
import type { AudioEqSpectrumGrabPeak } from '../../../../engine/audio/eq/AudioEqSpectrumGrab';
import { formatEqualizerFrequency } from '../equalizerFormatting';
import {
  GRAPH_MAX_FREQUENCY_HZ,
  GRAPH_MIN_FREQUENCY_HZ,
  clamp,
  hexToRgba,
  pruneCache,
} from './graphMath';

const graphXPositionCache = new Map<string, Float32Array>();
const frequencyGridCache = new Map<string, HTMLCanvasElement>();
// Keyed per context so a gradient never outlives its canvas; the analyzer
// redraws at up to 60fps and would otherwise allocate gradients every frame.
const analyzerGradientCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasGradient>>();

function getAnalyzerFillGradient(
  ctx: CanvasRenderingContext2D,
  height: number,
  fillColor: string,
): CanvasGradient {
  let byKey = analyzerGradientCache.get(ctx);
  if (!byKey) {
    byKey = new Map();
    analyzerGradientCache.set(ctx, byKey);
  }
  const key = `${height}:${fillColor}`;
  let gradient = byKey.get(key);
  if (!gradient) {
    gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, fillColor);
    gradient.addColorStop(1, 'rgba(178, 186, 204, 0.03)');
    byKey.set(key, gradient);
    pruneCache(byKey);
  }
  return gradient;
}

export function getLogSampleXPositions(sampleCount: number, width: number): Float32Array {
  const count = Math.max(0, sampleCount);
  if (count === 0) return new Float32Array();
  const key = `${count}:${Math.round(width * 10) / 10}`;
  const cached = graphXPositionCache.get(key);
  if (cached) return cached;

  const positions = new Float32Array(count);
  const denominator = Math.max(1, count - 1);
  for (let index = 0; index < count; index += 1) {
    positions[index] = (index / denominator) * width;
  }
  graphXPositionCache.set(key, positions);
  pruneCache(graphXPositionCache);
  return positions;
}

function resampleResponseDb(responseDb: Float32Array, targetIndex: number, targetLength: number): number {
  if (responseDb.length === 0 || targetLength <= 1) {
    return 0;
  }

  const sourcePosition = (targetIndex / (targetLength - 1)) * (responseDb.length - 1);
  const leftIndex = Math.floor(sourcePosition);
  const rightIndex = Math.min(responseDb.length - 1, leftIndex + 1);
  const fraction = sourcePosition - leftIndex;
  const left = responseDb[leftIndex] ?? 0;
  const right = responseDb[rightIndex] ?? left;
  return left + (right - left) * fraction;
}

function drawFrequencyGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rangeDb: number,
): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.font = '10px ui-monospace, SFMono-Regular, Consolas, monospace';
  ctx.textBaseline = 'top';

  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, '#15141c');
  background.addColorStop(0.5, '#101119');
  background.addColorStop(1, '#0b0d13');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  for (let decade = 10; decade <= 10000; decade *= 10) {
    for (let multiplier = 1; multiplier < 10; multiplier += 1) {
      const frequency = decade * multiplier;
      if (frequency < GRAPH_MIN_FREQUENCY_HZ || frequency > GRAPH_MAX_FREQUENCY_HZ) continue;
      const x = frequencyToGraphX(frequency, width);
      const major = multiplier === 1 || multiplier === 2 || multiplier === 5;
      ctx.strokeStyle = major ? 'rgba(167, 180, 205, 0.22)' : 'rgba(167, 180, 205, 0.075)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }

  const dbStep = rangeDb <= 6 ? 1.5 : rangeDb <= 12 ? 3 : 6;
  for (let db = -rangeDb; db <= rangeDb + 0.001; db += dbStep) {
    const y = dbToGraphY(db, height, rangeDb);
    ctx.strokeStyle = Math.abs(db) < 0.001 ? 'rgba(255, 231, 98, 0.44)' : 'rgba(167, 180, 205, 0.12)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();

    if (Math.abs(db % (dbStep * 2)) < 0.001 || Math.abs(db) < 0.001) {
      ctx.fillStyle = 'rgba(217, 224, 238, 0.62)';
      ctx.fillText(db > 0 ? `+${db}` : `${db}`, width - 28, y + 3);
    }
  }

  const labels = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  ctx.fillStyle = 'rgba(217, 224, 238, 0.54)';
  ctx.textAlign = 'center';
  for (const frequency of labels) {
    const x = clamp(frequencyToGraphX(frequency, width), 18, width - 20);
    ctx.fillText(formatEqualizerFrequency(frequency), x, height - 17);
  }

  ctx.restore();
}

export function drawCachedFrequencyGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rangeDb: number,
  dpr: number,
): void {
  if (typeof document === 'undefined') {
    drawFrequencyGrid(ctx, width, height, rangeDb);
    return;
  }

  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  const key = `${pixelWidth}x${pixelHeight}:${rangeDb}:${Math.round(dpr * 100)}`;
  let layer = frequencyGridCache.get(key);

  if (!layer) {
    layer = document.createElement('canvas');
    layer.width = pixelWidth;
    layer.height = pixelHeight;
    const layerContext = layer.getContext('2d');
    if (!layerContext) {
      drawFrequencyGrid(ctx, width, height, rangeDb);
      return;
    }
    layerContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFrequencyGrid(layerContext, width, height, rangeDb);
    frequencyGridCache.set(key, layer);
    pruneCache(frequencyGridCache);
  }

  ctx.drawImage(layer, 0, 0, width, height);
}

export function drawAnalyzer(
  ctx: CanvasRenderingContext2D,
  valuesDb: Float32Array | undefined,
  width: number,
  height: number,
  fillColor: string,
  strokeColor: string,
  responseDb?: Float32Array,
): void {
  if (!valuesDb || valuesDb.length < 2) return;
  const minDb = -96;
  const maxDb = -18;
  const xPositions = getLogSampleXPositions(valuesDb.length, width);
  const valueAt = (index: number) => valuesDb[index] + (
    responseDb ? resampleResponseDb(responseDb, index, valuesDb.length) : 0
  );
  const yForDb = (value: number) => {
    const normalized = (clamp(value, minDb, maxDb) - minDb) / (maxDb - minDb);
    return height - normalized * height;
  };

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let index = 0; index < valuesDb.length; index += 1) {
    ctx.lineTo(xPositions[index], yForDb(valueAt(index)));
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fillStyle = getAnalyzerFillGradient(ctx, height, fillColor);
  ctx.fill();

  ctx.beginPath();
  for (let index = 0; index < valuesDb.length; index += 1) {
    const x = xPositions[index];
    const y = yForDb(valueAt(index));
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.25;
  ctx.stroke();
  ctx.restore();
}

function analyzerDbToY(value: number, height: number): number {
  const minDb = -96;
  const maxDb = -18;
  const normalized = (clamp(value, minDb, maxDb) - minDb) / (maxDb - minDb);
  return height - normalized * height;
}

export function drawSketchPreview(
  ctx: CanvasRenderingContext2D,
  points: readonly AudioEqCurvePoint[],
  width: number,
  height: number,
  rangeDb: number,
): void {
  if (points.length < 2) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = frequencyToGraphX(point.frequencyHz, width);
    const y = dbToGraphY(point.gainDb, height, rangeDb);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = 'rgba(112, 246, 220, 0.95)';
  ctx.lineWidth = 2.4;
  ctx.shadowColor = 'rgba(112, 246, 220, 0.35)';
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.restore();
}

export function drawSpectrumGrabPeaks(
  ctx: CanvasRenderingContext2D,
  peaks: readonly AudioEqSpectrumGrabPeak[],
  width: number,
  height: number,
): void {
  if (peaks.length === 0) return;

  ctx.save();
  for (const peak of peaks) {
    const x = frequencyToGraphX(peak.frequencyHz, width);
    const y = clamp(analyzerDbToY(peak.magnitudeDb, height), 12, height - 18);
    ctx.beginPath();
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x + 7, y + 5);
    ctx.lineTo(x - 7, y + 5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(112, 246, 220, 0.88)';
    ctx.fill();
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.stroke();
  }
  ctx.restore();
}

export function drawResponseArea(
  ctx: CanvasRenderingContext2D,
  frequencies: Float32Array,
  valuesDb: Float32Array,
  width: number,
  height: number,
  rangeDb: number,
  color: string,
  alpha: number,
): void {
  if (frequencies.length === 0 || valuesDb.length === 0) return;
  const sampleCount = Math.min(frequencies.length, valuesDb.length);
  const xPositions = getLogSampleXPositions(sampleCount, width);
  const zeroY = dbToGraphY(0, height, rangeDb);
  ctx.beginPath();
  ctx.moveTo(xPositions[0], zeroY);
  for (let index = 0; index < sampleCount; index += 1) {
    ctx.lineTo(
      xPositions[index],
      dbToGraphY(valuesDb[index] ?? 0, height, rangeDb),
    );
  }
  ctx.lineTo(xPositions[sampleCount - 1], zeroY);
  ctx.closePath();
  ctx.fillStyle = hexToRgba(color, alpha);
  ctx.fill();
}

export function drawResponseCurve(
  ctx: CanvasRenderingContext2D,
  frequencies: Float32Array,
  valuesDb: Float32Array,
  width: number,
  height: number,
  rangeDb: number,
): void {
  if (frequencies.length === 0 || valuesDb.length === 0) return;
  const sampleCount = Math.min(frequencies.length, valuesDb.length);
  const xPositions = getLogSampleXPositions(sampleCount, width);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let index = 0; index < sampleCount; index += 1) {
    const x = xPositions[index];
    const y = dbToGraphY(valuesDb[index] ?? 0, height, rangeDb);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.74)';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = '#f1d34f';
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.restore();
}
