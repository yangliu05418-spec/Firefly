import type { LayerOverlayBounds, OverlayPoint } from './editModeOverlayMath';

export interface AxisSnapPoints {
  x: readonly number[];
  y: readonly number[];
}

export interface SnapRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function finitePoint(value: number): boolean {
  return Number.isFinite(value);
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values.filter(finitePoint))].sort((a, b) => a - b);
}

export function mergeSnapPointSets(sets: readonly AxisSnapPoints[]): AxisSnapPoints {
  return {
    x: uniqueSorted(sets.flatMap((set) => set.x)),
    y: uniqueSorted(sets.flatMap((set) => set.y)),
  };
}

export function getCanvasSnapPoints(width: number, height: number): AxisSnapPoints {
  return {
    x: uniqueSorted([0, width / 2, width]),
    y: uniqueSorted([0, height / 2, height]),
  };
}

export function getRectSnapPoints(rect: SnapRect): AxisSnapPoints {
  return {
    x: uniqueSorted([rect.left, (rect.left + rect.right) / 2, rect.right]),
    y: uniqueSorted([rect.top, (rect.top + rect.bottom) / 2, rect.bottom]),
  };
}

export function getLayerBoundsRect(bounds: LayerOverlayBounds): SnapRect {
  const points = [bounds.corners.tl, bounds.corners.tr, bounds.corners.br, bounds.corners.bl];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

export function getLayerBoundsSnapPoints(bounds: LayerOverlayBounds): AxisSnapPoints {
  return getRectSnapPoints(getLayerBoundsRect(bounds));
}

export function resolveAxisSnapDelta(
  movingPoints: readonly number[],
  targetPoints: readonly number[],
  threshold: number,
): number {
  if (threshold <= 0) return 0;

  let bestDelta = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const movingPoint of movingPoints) {
    if (!finitePoint(movingPoint)) continue;
    for (const targetPoint of targetPoints) {
      if (!finitePoint(targetPoint)) continue;
      const delta = targetPoint - movingPoint;
      const distance = Math.abs(delta);
      if (distance <= threshold && distance < bestDistance) {
        bestDistance = distance;
        bestDelta = delta;
      }
    }
  }

  return bestDelta;
}

export function resolveSnapDelta(
  movingPoints: AxisSnapPoints,
  targetPoints: AxisSnapPoints,
  threshold: number,
): OverlayPoint {
  return {
    x: resolveAxisSnapDelta(movingPoints.x, targetPoints.x, threshold),
    y: resolveAxisSnapDelta(movingPoints.y, targetPoints.y, threshold),
  };
}

export function snapPointToTargets(
  point: OverlayPoint,
  targetPoints: AxisSnapPoints,
  threshold: number,
  axes: { x?: boolean; y?: boolean } = { x: true, y: true },
): OverlayPoint {
  return {
    x: point.x + (axes.x === false ? 0 : resolveAxisSnapDelta([point.x], targetPoints.x, threshold)),
    y: point.y + (axes.y === false ? 0 : resolveAxisSnapDelta([point.y], targetPoints.y, threshold)),
  };
}
