import type { TimelineProjection } from '../projection';
import type {
  TimelineClipBodyGeometry,
  TimelineGeometrySnapshot,
  TimelineRect,
  TimelineTrackLaneGeometry,
  TimelineViewportGeometry,
} from './TimelineGeometrySnapshot';
import {
  clampTimelineRectToViewport,
  createTimelineRect,
} from './rect';

export interface TimelineGeometryEpochInput {
  layoutVersion: string;
  timingVersion: string;
  zoomVersion: string;
}

export interface BuildTimelineGeometrySnapshotInput extends TimelineGeometryEpochInput {
  projection: TimelineProjection;
  viewportRect: TimelineRect;
  scrollX: number;
  scrollY: number;
  pxPerSecond: number;
  rulerHeightPx?: number;
  rowGapPx?: number;
  clipVerticalInsetPx?: number;
  measuredAtMs?: number;
}

export function createTimelineGeometryEpoch(input: TimelineGeometryEpochInput): string {
  return `${input.layoutVersion}:${input.timingVersion}:${input.zoomVersion}`;
}

function buildViewportGeometry(input: BuildTimelineGeometrySnapshotInput): TimelineViewportGeometry {
  return {
    scrollContainerRect: input.viewportRect,
    visibleContentRect: createTimelineRect(
      input.scrollX,
      input.scrollY,
      input.viewportRect.width,
      input.viewportRect.height,
    ),
    viewportRect: input.viewportRect,
    scrollX: input.scrollX,
    scrollY: input.scrollY,
    pxPerSecond: input.pxPerSecond,
    measuredAtMs: input.measuredAtMs,
  };
}

function buildTrackGeometry(
  projection: TimelineProjection,
  contentWidth: number,
  rulerHeightPx: number,
  rowGapPx: number,
  clipVerticalInsetPx: number,
): TimelineTrackLaneGeometry[] {
  let y = rulerHeightPx;
  return projection.tracks.map((track) => {
    const laneRect = createTimelineRect(0, y, contentWidth, track.heightPx);
    const geometry = {
      trackId: track.id,
      index: track.index,
      laneRect,
      rowViewportRect: laneRect,
      clipRowRect: createTimelineRect(
        0,
        y + clipVerticalInsetPx,
        contentWidth,
        Math.max(0, track.heightPx - clipVerticalInsetPx * 2),
      ),
      keyframeAreaRect: track.expanded
        ? createTimelineRect(0, y + track.heightPx, contentWidth, 0)
        : undefined,
    };
    y += track.heightPx + rowGapPx;
    return geometry;
  });
}

function buildClipGeometry(
  projection: TimelineProjection,
  tracks: readonly TimelineTrackLaneGeometry[],
  viewport: TimelineViewportGeometry,
): TimelineClipBodyGeometry[] {
  const trackById = new Map(tracks.map((track) => [track.trackId, track]));
  return projection.clips.flatMap((clip) => {
    const track = trackById.get(clip.trackId);
    if (!track) return [];
    const bodyRect = createTimelineRect(
      clip.startTime * viewport.pxPerSecond,
      track.clipRowRect.y,
      clip.duration * viewport.pxPerSecond,
      track.clipRowRect.height,
    );
    return [{
      clipId: clip.id,
      trackId: clip.trackId,
      bodyRect,
      visibleBodyRect: clampTimelineRectToViewport(bodyRect, viewport.visibleContentRect),
      labelRect: createTimelineRect(bodyRect.x + 8, bodyRect.y + 6, Math.max(0, bodyRect.width - 16), 18),
      badgeAnchorRects: {},
      sourceExtensionGhosts: [],
    }];
  });
}

function resolveContentWidth(projection: TimelineProjection, viewportWidth: number, pxPerSecond: number): number {
  const clipMax = projection.clips.reduce((max, clip) => (
    Math.max(max, (clip.startTime + clip.duration) * pxPerSecond)
  ), 0);
  return Math.max(viewportWidth, clipMax);
}

export function buildTimelineGeometrySnapshot(input: BuildTimelineGeometrySnapshotInput): TimelineGeometrySnapshot {
  const rulerHeightPx = input.rulerHeightPx ?? 20;
  const rowGapPx = input.rowGapPx ?? 0;
  const clipVerticalInsetPx = input.clipVerticalInsetPx ?? 2;
  const contentWidth = resolveContentWidth(input.projection, input.viewportRect.width, input.pxPerSecond);
  const viewport = buildViewportGeometry(input);
  const tracks = buildTrackGeometry(input.projection, contentWidth, rulerHeightPx, rowGapPx, clipVerticalInsetPx);

  return {
    schemaVersion: 1,
    viewport,
    contentWidth,
    geometryEpoch: createTimelineGeometryEpoch(input),
    tracks,
    clips: buildClipGeometry(input.projection, tracks, viewport),
    trimPreviews: [],
    handles: [],
    keyframeRows: [],
    transitionJunctions: [],
    marqueeExclusions: [],
    dropTargets: [],
    ruler: {
      rect: createTimelineRect(0, 0, contentWidth, rulerHeightPx),
      contentWidth,
      timeOrigin: 0,
      pxPerSecond: input.pxPerSecond,
    },
  };
}
