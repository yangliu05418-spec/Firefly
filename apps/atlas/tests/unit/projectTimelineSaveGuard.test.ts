import { afterEach, describe, expect, it, vi } from 'vitest';

import { withProjectStoreSyncGuard } from '../../src/services/project/projectSave';
import { useTimelineStore } from '../../src/stores/timeline';
import type { CompositionTimelineData, TimelineClip, TimelineTrack } from '../../src/types';
import type { MediaState } from '../../src/stores/mediaStore';

const track: TimelineTrack = {
  id: 'video-1',
  name: 'Video 1',
  type: 'video',
  height: 60,
  muted: false,
  visible: true,
  solo: false,
};

const persistedTimeline: CompositionTimelineData = {
  tracks: [track],
  clips: [{
    id: 'persisted-clip',
    trackId: 'video-1',
    name: 'Persisted clip',
    mediaFileId: 'media-1',
    sourceType: 'video',
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    effects: [],
    keyframes: [],
  }],
  playheadPosition: 0,
  duration: 5,
  zoom: 50,
  scrollX: 0,
  inPoint: null,
  outPoint: null,
  loopPlayback: false,
};

describe('project timeline save guard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not overwrite composition timeline data while project stores are loading', async () => {
    vi.useFakeTimers();

    let mediaState = {
      compositions: [{
        id: 'comp-project',
        name: 'Project Comp',
        type: 'composition',
        parentId: null,
        createdAt: 1,
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: 5,
        backgroundColor: '#000000',
        timelineData: structuredClone(persistedTimeline),
      }],
      activeCompositionId: 'comp-project',
      openCompositionIds: ['comp-project'],
    } as Partial<MediaState>;

    const fakeUseMediaStore = Object.assign(vi.fn(), {
      getState: vi.fn(() => mediaState),
      setState: vi.fn((update: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)) => {
        const patch = typeof update === 'function'
          ? update(mediaState as MediaState)
          : update;
        mediaState = { ...mediaState, ...patch };
      }),
      subscribe: vi.fn(),
    });

    (globalThis as typeof globalThis & {
      __mediaStoreModule?: { useMediaStore: typeof fakeUseMediaStore };
    }).__mediaStoreModule = { useMediaStore: fakeUseMediaStore };

    const { triggerTimelineSave } = await import('../../src/stores/mediaStore/init');

    useTimelineStore.setState({
      tracks: [track],
      clips: [] as TimelineClip[],
      markers: [],
      clipKeyframes: new Map(),
      playheadPosition: 0,
      duration: 60,
      zoom: 50,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
    });

    await withProjectStoreSyncGuard(async () => {
      triggerTimelineSave();
    });

    const [composition] = mediaState.compositions ?? [];
    expect(composition.timelineData?.clips).toHaveLength(1);
    expect(composition.timelineData?.clips[0]?.id).toBe('persisted-clip');
  });
});
