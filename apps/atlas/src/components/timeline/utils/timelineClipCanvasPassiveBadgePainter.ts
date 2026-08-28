import type {
  TimelineClipCanvasWorkerPassiveBadge,
  TimelineClipCanvasWorkerProgressBar,
} from './timelineClipCanvasWorkerContract';

export function drawTimelineClipCanvasPassiveBadges(
  ctx: CanvasRenderingContext2D,
  badges: readonly TimelineClipCanvasWorkerPassiveBadge[],
  x: number,
  top: number,
  w: number,
): void {
  if (badges.length === 0 || w < 28) return;

  ctx.save();
  ctx.font = '9px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let right = x + w - 5;
  for (let index = badges.length - 1; index >= 0; index -= 1) {
    const badge = badges[index];
    const badgeW = Math.max(14, badge.label.length * 6 + 8);
    const left = right - badgeW;
    if (left < x + 4) break;

    ctx.beginPath();
    ctx.roundRect(left, top + 4, badgeW, 14, 3);
    ctx.fillStyle = badge.fill;
    ctx.fill();
    if (badge.stroke) {
      ctx.strokeStyle = badge.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.fillText(badge.label, left + badgeW / 2, top + 11);
    right = left - 3;
  }

  ctx.restore();
}

export function drawTimelineClipCanvasPassiveProgressBars(
  ctx: CanvasRenderingContext2D,
  bars: readonly TimelineClipCanvasWorkerProgressBar[],
  x: number,
  top: number,
  w: number,
): void {
  if (bars.length === 0 || w < 10) return;

  ctx.save();
  bars.slice(0, 3).forEach((bar, index) => {
    const y = top + 3 + index * 3;
    const progress = Math.max(0.02, Math.min(1, bar.progress / 100));
    ctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
    ctx.fillRect(x + 4, y, Math.max(0, w - 8), 2);
    ctx.fillStyle = bar.color;
    ctx.fillRect(x + 4, y, Math.max(1, (w - 8) * progress), 2);
  });
  ctx.restore();
}
