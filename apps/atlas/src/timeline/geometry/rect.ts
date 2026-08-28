import type {
  TimelineMarqueeExclusionGeometry,
  TimelinePoint,
  TimelineRect,
  TimelineTimeRange,
} from './TimelineGeometrySnapshot';

export function createTimelineRect(x: number, y: number, width: number, height: number): TimelineRect {
  return {
    x,
    y,
    width: Math.max(0, width),
    height: Math.max(0, height),
  };
}

export function isTimelineRect(value: unknown): value is TimelineRect {
  if (value === null || typeof value !== 'object') return false;
  const rect = value as Record<string, unknown>;
  return (
    typeof rect.x === 'number' &&
    typeof rect.y === 'number' &&
    typeof rect.width === 'number' &&
    typeof rect.height === 'number' &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
}

export function timelineRectContainsPoint(rect: TimelineRect, point: TimelinePoint): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function timelineRectsIntersect(a: TimelineRect, b: TimelineRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function findTimelineMarqueeExclusionAtPoint(
  exclusions: readonly TimelineMarqueeExclusionGeometry[],
  point: TimelinePoint,
): TimelineMarqueeExclusionGeometry | null {
  return exclusions.find(exclusion => timelineRectContainsPoint(exclusion.rect, point)) ?? null;
}

export function findTimelineMarqueeExclusionsIntersectingRect(
  exclusions: readonly TimelineMarqueeExclusionGeometry[],
  rect: TimelineRect,
): TimelineMarqueeExclusionGeometry[] {
  return exclusions.filter(exclusion => timelineRectsIntersect(exclusion.rect, rect));
}

export function clampTimelineRectToViewport(rect: TimelineRect, viewport: TimelineRect): TimelineRect {
  const x = Math.max(rect.x, viewport.x);
  const y = Math.max(rect.y, viewport.y);
  const right = Math.min(rect.x + rect.width, viewport.x + viewport.width);
  const bottom = Math.min(rect.y + rect.height, viewport.y + viewport.height);
  return createTimelineRect(x, y, right - x, bottom - y);
}

export function timelineTimeRangeToRect(
  range: TimelineTimeRange,
  trackRect: TimelineRect,
  pxPerSecond: number,
): TimelineRect {
  return createTimelineRect(
    range.startTime * pxPerSecond,
    trackRect.y,
    range.duration * pxPerSecond,
    trackRect.height,
  );
}
