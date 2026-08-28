import type { TimelineClipCanvasWorkerMidiPreviewResource } from './timelineClipCanvasMidiResource';

export function drawTimelineClipCanvasMidiPreviewResource(
  ctx: CanvasRenderingContext2D,
  midiPreview: TimelineClipCanvasWorkerMidiPreviewResource | undefined,
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  if (!midiPreview || midiPreview.barCount <= 0 || midiPreview.bars.length < midiPreview.barCount * 5) {
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, top, w, h, Math.min(4, h / 4));
  ctx.clip();
  ctx.fillStyle = midiPreview.mode === 'density'
    ? 'rgba(198, 218, 255, 1)'
    : 'rgba(210, 226, 255, 1)';
  for (let index = 0; index < midiPreview.barCount; index += 1) {
    const offset = index * 5;
    const barX = midiPreview.bars[offset] ?? 0;
    const barY = midiPreview.bars[offset + 1] ?? 0;
    const barW = midiPreview.bars[offset + 2] ?? 0;
    const barH = midiPreview.bars[offset + 3] ?? 0;
    if (barW <= 0 || barH <= 0) continue;
    ctx.globalAlpha = Math.max(0.08, Math.min(1, midiPreview.bars[offset + 4] ?? 0.7));
    ctx.fillRect(x + barX, top + barY, barW, barH);
  }
  ctx.restore();
}
