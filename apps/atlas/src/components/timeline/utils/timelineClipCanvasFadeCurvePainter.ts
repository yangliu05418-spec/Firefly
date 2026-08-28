import type { TimelinePaintFadeVisuals } from '../../../timeline';
import { buildFadeCurvePath } from './fadeCurvePath';

export function drawTimelineClipCanvasFadeCurve(
  ctx: CanvasRenderingContext2D,
  fade: TimelinePaintFadeVisuals | undefined,
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  if (!fade || fade.keyframes.length < 2 || typeof Path2D === 'undefined') return;
  const path = buildFadeCurvePath({
    keyframes: fade.keyframes,
    clipDuration: fade.clipDuration,
    width: w,
    height: h,
  });
  if (!path) return;

  ctx.save();
  ctx.translate(x, top);
  ctx.fillStyle = fade.isAudioClip ? 'rgba(51, 197, 255, 0.13)' : 'rgba(0, 0, 0, 0.4)';
  ctx.fill(new Path2D(path.fillPath));
  ctx.strokeStyle = fade.isAudioClip ? 'rgba(96, 217, 255, 0.86)' : 'rgba(140, 180, 220, 0.8)';
  ctx.lineWidth = fade.isAudioClip ? 1.6 : 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(path.curvePath));
  ctx.fillStyle = fade.isAudioClip ? 'rgba(96, 217, 255, 0.95)' : 'rgba(140, 180, 220, 1)';
  for (const point of path.points) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
