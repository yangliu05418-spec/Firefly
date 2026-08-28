import type {
  TimelineGeometrySnapshot,
  TimelineRect,
  VisibleSet,
} from './TimelineGeometrySnapshot';
import {
  createTimelineRect,
  timelineRectsIntersect,
} from './rect';

function currentVisibleRect(snapshot: TimelineGeometrySnapshot): TimelineRect {
  return snapshot.viewport.visibleContentRect;
}

export function queryTimelineVisibleSet(
  snapshot: TimelineGeometrySnapshot,
  visibleRect: TimelineRect = currentVisibleRect(snapshot),
): VisibleSet {
  const clipIds: string[] = [];
  const rowIds: string[] = [];
  const facetIds: string[] = [];
  const tileBands: string[] = [];

  for (const track of snapshot.tracks) {
    const rowRect = createTimelineRect(
      visibleRect.x,
      track.laneRect.y,
      visibleRect.width,
      track.laneRect.height,
    );
    if (timelineRectsIntersect(track.laneRect, rowRect)) {
      rowIds.push(track.trackId);
      tileBands.push(`track:${track.trackId}`);
    }
  }

  for (const clip of snapshot.clips) {
    if (!timelineRectsIntersect(clip.bodyRect, visibleRect)) continue;
    clipIds.push(clip.clipId);
    facetIds.push(`clip:${clip.clipId}:body`);
    if (clip.labelRect) facetIds.push(`clip:${clip.clipId}:label`);
    if (clip.thumbnailStripRect) facetIds.push(`clip:${clip.clipId}:thumbnail-strip`);
    if (clip.waveformRect) facetIds.push(`clip:${clip.clipId}:waveform`);
    if (clip.spectrogramRect) facetIds.push(`clip:${clip.clipId}:spectrogram`);
  }

  return { clipIds, rowIds, facetIds, tileBands };
}
