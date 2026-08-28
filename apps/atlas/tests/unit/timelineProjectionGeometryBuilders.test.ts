import { describe, expect, it } from 'vitest';

import type { TimelineSchemaSnapshot } from '../../src/timeline/contracts/schema';
import {
  buildTimelineGeometrySnapshot,
  buildTimelineKeyframeRowGeometries,
  buildTimelineProjection,
  createTimelineGeometryEpoch,
  createTimelineRect,
  findTimelineRuntimeReferences,
  queryTimelineVisibleSet,
} from '../../src/timeline';

const schemaSnapshot: TimelineSchemaSnapshot = {
  schemaVersion: 1,
  tracks: [
    {
      id: 'audio-1',
      index: 1,
      kind: 'audio',
      name: 'Audio 1',
      locked: false,
      muted: false,
      hidden: false,
      expanded: true,
    },
    {
      id: 'video-1',
      index: 0,
      kind: 'video',
      name: 'Video 1',
      locked: false,
      muted: false,
      hidden: false,
      expanded: true,
    },
  ],
  clips: [
    {
      id: 'clip-audio',
      trackId: 'audio-1',
      index: 1,
      label: 'Room tone',
      source: {
        kind: 'audio',
        sourceId: 'source-audio',
        mediaAssetId: 'media-audio',
      },
      timing: {
        startTime: 8,
        duration: 2,
        inPoint: 0,
        outPoint: 2,
        speed: 1,
        reversed: false,
      },
      locked: false,
      muted: false,
      disabled: false,
    },
    {
      id: 'clip-video',
      trackId: 'video-1',
      index: 0,
      label: 'Interview',
      source: {
        kind: 'video',
        sourceId: 'source-video',
        mediaAssetId: 'media-video',
      },
      timing: {
        startTime: 2,
        duration: 4,
        inPoint: 0,
        outPoint: 4,
        speed: 1,
        reversed: false,
      },
      locked: false,
      muted: false,
      disabled: false,
      linkedClipId: 'clip-audio',
    },
  ],
  selectedClipIds: ['clip-video'],
  primarySelectedClipId: 'clip-video',
};

describe('timeline projection and geometry builders', () => {
  it('builds a runtime-free TimelineProjection from schema descriptors', () => {
    const projection = buildTimelineProjection(schemaSnapshot, {
      generatedAtMs: 123,
      hoveredClipId: 'clip-video',
      trackColors: { 'video-1': '#123456' },
      clipPalettes: { 'clip-video': { fill: '#abcdef' } },
    });

    expect(projection.tracks.map((track) => track.id)).toEqual(['video-1', 'audio-1']);
    expect(projection.clips.map((clip) => clip.id)).toEqual(['clip-video', 'clip-audio']);
    expect(projection.primarySelectedClipId).toBe('clip-video');
    expect(projection.tracks[0]).toMatchObject({ color: '#123456', heightPx: 76 });
    expect(projection.clips[0]).toMatchObject({
      mediaFileId: 'media-video',
      sourceKind: 'video',
      startTime: 2,
      duration: 4,
      state: {
        hovered: true,
        linked: true,
        inLinkedGroup: false,
      },
      palette: {
        fill: '#abcdef',
      },
    });
    expect(findTimelineRuntimeReferences(projection)).toEqual([]);
    expect(structuredClone(projection)).toEqual(projection);
  });

  it('builds geometry snapshots and a single visible-set query from projection data', () => {
    const projection = buildTimelineProjection(schemaSnapshot);
    const geometry = buildTimelineGeometrySnapshot({
      projection,
      viewportRect: createTimelineRect(0, 0, 300, 180),
      scrollX: 0,
      scrollY: 0,
      pxPerSecond: 50,
      layoutVersion: 'layout-1',
      timingVersion: 'timing-1',
      zoomVersion: 'zoom-1',
      clipVerticalInsetPx: 4,
    });

    expect(geometry.geometryEpoch).toBe('layout-1:timing-1:zoom-1');
    expect(geometry.contentWidth).toBe(500);
    expect(geometry.tracks.map((track) => track.trackId)).toEqual(['video-1', 'audio-1']);
    expect(geometry.clips.find((clip) => clip.clipId === 'clip-video')?.bodyRect).toEqual(
      createTimelineRect(100, 24, 200, 68),
    );

    const visibleSet = queryTimelineVisibleSet(geometry);
    expect(visibleSet.clipIds).toEqual(['clip-video']);
    expect(visibleSet.rowIds).toEqual(['video-1', 'audio-1']);
    expect(visibleSet.facetIds).toContain('clip:clip-video:body');
    expect(visibleSet.facetIds).toContain('clip:clip-video:label');
    expect(visibleSet.tileBands).toEqual(['track:video-1', 'track:audio-1']);
  });

  it('keeps geometry epoch independent from raw scroll while visible membership changes', () => {
    const projection = buildTimelineProjection(schemaSnapshot);
    const stableEpoch = createTimelineGeometryEpoch({
      layoutVersion: 'layout-1',
      timingVersion: 'timing-1',
      zoomVersion: 'zoom-1',
    });

    const baseGeometry = buildTimelineGeometrySnapshot({
      projection,
      viewportRect: createTimelineRect(0, 0, 300, 180),
      scrollX: 0,
      scrollY: 0,
      pxPerSecond: 50,
      layoutVersion: 'layout-1',
      timingVersion: 'timing-1',
      zoomVersion: 'zoom-1',
    });
    const scrolledGeometry = buildTimelineGeometrySnapshot({
      projection,
      viewportRect: createTimelineRect(0, 0, 300, 180),
      scrollX: 350,
      scrollY: 0,
      pxPerSecond: 50,
      layoutVersion: 'layout-1',
      timingVersion: 'timing-1',
      zoomVersion: 'zoom-1',
    });

    expect(baseGeometry.geometryEpoch).toBe(stableEpoch);
    expect(scrolledGeometry.geometryEpoch).toBe(stableEpoch);
    expect(queryTimelineVisibleSet(baseGeometry).clipIds).toEqual(['clip-video']);
    expect(queryTimelineVisibleSet(scrolledGeometry).clipIds).toEqual(['clip-audio']);
  });

  it('builds keyframe row geometry with deterministic diamond hit rects', () => {
    const rows = buildTimelineKeyframeRowGeometries({
      trackId: 'video-1',
      clipId: 'clip-video',
      properties: ['opacity', 'position.x'],
      keyframes: [
        { id: 'kf-opacity', clipId: 'clip-video', property: 'opacity', time: 1 },
        { id: 'kf-position', clipId: 'clip-video', property: 'position.x', time: 2 },
      ],
      selectedKeyframeIds: new Set(['kf-opacity']),
      contentWidth: 400,
      pxPerSecond: 50,
      clipStartTime: 2,
      rowHeightPx: 18,
    });

    expect(rows.map((row) => [row.property, row.rowRect])).toEqual([
      ['opacity', createTimelineRect(0, 0, 400, 18)],
      ['position.x', createTimelineRect(0, 18, 400, 18)],
    ]);
    expect(rows[0].diamonds[0]).toMatchObject({
      keyframeId: 'kf-opacity',
      rectId: 'keyframe-diamond-kf-opacity',
      selected: true,
      rect: createTimelineRect(144, 3, 12, 12),
    });
    expect(rows[1].diamonds[0]).toMatchObject({
      keyframeId: 'kf-position',
      selected: false,
      rect: createTimelineRect(194, 21, 12, 12),
    });
  });
});
