import type { WaveformColumn } from './waveformLod';

export function buildCanvasSignedEnvelopePath(
  ctx: CanvasRenderingContext2D,
  columns: WaveformColumn[],
  width: number,
  height: number,
  minFloor = 0,
  scale = 1,
): void {
  const midY = height / 2;
  const halfHeight = Math.max(1, (height - 6) / 2);
  const count = columns.length;
  const normalizedScale = Math.max(0, Math.min(1, scale));
  const xAt = (index: number) => count <= 1 ? width / 2 : (index / (count - 1)) * width;
  const topYAt = (index: number) => {
    const column = columns[index];
    return midY - Math.max(column.max, column.peak * minFloor, 0) * normalizedScale * halfHeight;
  };
  const bottomYAt = (index: number) => {
    const column = columns[index];
    return midY + Math.max(-column.min, column.peak * minFloor, 0) * normalizedScale * halfHeight;
  };

  ctx.beginPath();
  ctx.moveTo(0, topYAt(0));
  for (let index = 0; index < count - 1; index += 1) {
    const previousX = xAt(index);
    const currentX = xAt(index + 1);
    const previousY = topYAt(index);
    const currentY = topYAt(index + 1);
    ctx.quadraticCurveTo(previousX, previousY, (previousX + currentX) / 2, (previousY + currentY) / 2);
  }
  ctx.quadraticCurveTo(width, topYAt(count - 1), width, topYAt(count - 1));
  ctx.lineTo(width, bottomYAt(count - 1));
  for (let index = count - 1; index > 0; index -= 1) {
    const nextX = xAt(index);
    const currentX = xAt(index - 1);
    const nextY = bottomYAt(index);
    const currentY = bottomYAt(index - 1);
    ctx.quadraticCurveTo(nextX, nextY, (nextX + currentX) / 2, (nextY + currentY) / 2);
  }
  ctx.quadraticCurveTo(0, bottomYAt(0), 0, bottomYAt(0));
  ctx.closePath();
}

export function buildCanvasSmoothEnvelopePath(
  ctx: CanvasRenderingContext2D,
  columns: WaveformColumn[],
  width: number,
  height: number,
  valueForColumn: (column: WaveformColumn) => number,
): void {
  const midY = height / 2;
  const halfHeight = Math.max(1, (height - 6) / 2);
  const count = columns.length;
  const xAt = (index: number) => count <= 1 ? width / 2 : (index / (count - 1)) * width;
  const topYAt = (index: number) => midY - valueForColumn(columns[index]) * halfHeight;
  const bottomYAt = (index: number) => midY + valueForColumn(columns[index]) * halfHeight;

  ctx.beginPath();
  ctx.moveTo(0, topYAt(0));
  for (let index = 0; index < count - 1; index += 1) {
    const previousX = xAt(index);
    const currentX = xAt(index + 1);
    const previousY = topYAt(index);
    const currentY = topYAt(index + 1);
    ctx.quadraticCurveTo(previousX, previousY, (previousX + currentX) / 2, (previousY + currentY) / 2);
  }
  ctx.quadraticCurveTo(width, topYAt(count - 1), width, topYAt(count - 1));
  ctx.lineTo(width, bottomYAt(count - 1));
  for (let index = count - 1; index > 0; index -= 1) {
    const nextX = xAt(index);
    const currentX = xAt(index - 1);
    const nextY = bottomYAt(index);
    const currentY = bottomYAt(index - 1);
    ctx.quadraticCurveTo(nextX, nextY, (nextX + currentX) / 2, (nextY + currentY) / 2);
  }
  ctx.quadraticCurveTo(0, bottomYAt(0), 0, bottomYAt(0));
  ctx.closePath();
}
