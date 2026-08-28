import type { TimelineClipCanvasTrimGeometry } from './timelineClipCanvasTrimResource';

function drawSourceExtensionGhost(
  ctx: CanvasRenderingContext2D,
  edge: 'left' | 'right',
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  if (w <= 0 || h <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, top, w, h);
  ctx.clip();

  const fill = ctx.createLinearGradient(0, top, 0, top + h);
  fill.addColorStop(0, 'rgba(251, 191, 36, 0.24)');
  fill.addColorStop(1, 'rgba(251, 191, 36, 0.08)');
  ctx.fillStyle = fill;
  ctx.fillRect(x, top, w, h);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  for (let offset = -h; offset < w + h; offset += 10) {
    ctx.beginPath();
    ctx.moveTo(x + offset, top + h);
    ctx.lineTo(x + offset + h, top);
    ctx.stroke();
  }

  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.46)';
  ctx.strokeRect(x + 0.5, top + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(251, 191, 36, 0.92)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (edge === 'left') {
    ctx.moveTo(x + w - 1, top);
    ctx.lineTo(x + w - 1, top + h);
  } else {
    ctx.moveTo(x + 1, top);
    ctx.lineTo(x + 1, top + h);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawTimelineClipCanvasSourceExtensionGhosts(
  ctx: CanvasRenderingContext2D,
  geometry: TimelineClipCanvasTrimGeometry,
  clipTop: number,
  clipHeight: number,
  visibleLeft: number,
  visibleRight: number,
  canvasOffsetX: number,
  timeToPixel: (time: number) => number,
): void {
  if (!geometry.trimEdge) return;

  const displayEnd = geometry.startTime + geometry.duration;
  let drewPrimaryGhost = false;
  const pushGhost = (edge: 'left' | 'right', startTime: number, endTime: number) => {
    const ghostStartTime = Math.max(0, Math.min(startTime, endTime));
    const ghostEndTime = Math.max(ghostStartTime, Math.max(startTime, endTime));
    if (ghostEndTime - ghostStartTime <= 0.001) return false;

    const rawLeft = timeToPixel(ghostStartTime);
    const rawRight = timeToPixel(ghostEndTime);
    const clippedLeft = Math.max(rawLeft, visibleLeft);
    const clippedRight = Math.min(rawRight, visibleRight);
    if (clippedRight - clippedLeft < 1) return false;

    drawSourceExtensionGhost(ctx, edge, clippedLeft - canvasOffsetX, clipTop, clippedRight - clippedLeft, clipHeight);
    return true;
  };

  if (geometry.trimEdge === 'left') {
    const availableLeftDuration = Math.min(
      Math.max(0, geometry.inPoint),
      Math.max(0, geometry.startTime),
    );
    if (availableLeftDuration > 0.001) {
      drewPrimaryGhost = pushGhost('left', geometry.startTime - availableLeftDuration, geometry.startTime) || drewPrimaryGhost;
    }
  }

  if (geometry.trimEdge === 'right') {
    const availableRightDuration = Math.max(0, geometry.sourceDuration - geometry.outPoint);
    if (availableRightDuration > 0.001) {
      drewPrimaryGhost = pushGhost('right', displayEnd, displayEnd + availableRightDuration) || drewPrimaryGhost;
    }
  }

  if (
    !drewPrimaryGhost &&
    geometry.trimEdge === 'left' &&
    Math.abs(geometry.startTime - geometry.originalStartTime) > 0.001
  ) {
    pushGhost('left', Math.min(geometry.startTime, geometry.originalStartTime), Math.max(geometry.startTime, geometry.originalStartTime));
  }

  if (
    !drewPrimaryGhost &&
    geometry.trimEdge === 'right' &&
    Math.abs(displayEnd - geometry.originalEndTime) > 0.001
  ) {
    pushGhost('right', Math.min(displayEnd, geometry.originalEndTime), Math.max(displayEnd, geometry.originalEndTime));
  }
}
