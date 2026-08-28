import type { WaveformColumn } from './waveformLod';

type WaveformSpikeCanvasContext = Pick<
  CanvasRenderingContext2D,
  'beginPath' | 'lineTo' | 'moveTo' | 'restore' | 'save' | 'stroke'
> & {
  lineWidth: number;
  strokeStyle: string | CanvasGradient | CanvasPattern;
};

function percentileFromSorted(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const index = Math.max(0, Math.min(
    values.length - 1,
    Math.round((values.length - 1) * ratio),
  ));
  return values[index] ?? 0;
}

export function drawTransientPeakSpikes(
  ctx: WaveformSpikeCanvasContext,
  columnCount: number,
  columnAt: (index: number) => WaveformColumn,
  width: number,
  height: number,
): void {
  const midY = height / 2;
  const halfHeight = Math.max(1, (height - 6) / 2);
  const peakValues: number[] = [];

  for (let index = 0; index < columnCount; index += 1) {
    const peak = columnAt(index).peak;
    if (peak > 0.0001) {
      peakValues.push(peak);
    }
  }

  peakValues.sort((a, b) => a - b);
  if (peakValues.length === 0) return;

  const transientThreshold = Math.max(
    0.52,
    percentileFromSorted(peakValues, width < 420 ? 0.94 : 0.955),
  );
  const minGapPx = width < 420 ? 11 : 8;
  let lastSpikeX = -Infinity;

  ctx.save();
  ctx.lineWidth = width < 320 ? 0.9 : 1.1;

  for (let index = 0; index < columnCount; index += 1) {
    const column = columnAt(index);
    const previousPeak = columnAt(Math.max(0, index - 1)).peak;
    const nextPeak = columnAt(Math.min(columnCount - 1, index + 1)).peak;
    const localPeak = column.peak >= previousPeak && column.peak >= nextPeak;
    const transientLift = column.peak - Math.max(column.rms, Math.min(previousPeak, nextPeak) * 0.82);
    if (!localPeak || column.peak < transientThreshold || transientLift < 0.16) continue;

    const x = columnCount <= 1 ? width / 2 : (index / (columnCount - 1)) * width;
    if (x - lastSpikeX < minGapPx) continue;

    const alpha = Math.max(0.18, Math.min(0.48, 0.18 + transientLift * 0.62));
    const top = midY - Math.max(column.max, column.peak * 0.92, 0) * halfHeight;
    const bottom = midY + Math.max(-column.min, column.peak * 0.92, 0) * halfHeight;
    const inner = Math.max(column.rms, column.peak * 0.22) * halfHeight;
    ctx.strokeStyle = `rgba(244, 250, 255, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, midY - inner);
    ctx.moveTo(x, midY + inner);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    lastSpikeX = x;
  }

  ctx.restore();
}
