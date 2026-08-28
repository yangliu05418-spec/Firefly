import { describe, expect, it } from 'vitest';

import { LayerCache } from '../../src/services/layerBuilder/LayerCache';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import type { Layer } from '../../src/types';

function createFrameContext(overrides: Partial<FrameContext> = {}): FrameContext {
  return {
    clips: [],
    tracks: [],
    isPlaying: true,
    isDraggingPlayhead: false,
    hasClipDragPreview: false,
    playheadPosition: 1,
    playbackSpeed: 1,
    activeCompId: 'default',
    proxyEnabled: false,
    getInterpolatedTransform: () => ({
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      opacity: 1,
      blendMode: 'normal',
    }),
    getInterpolatedEffects: () => [],
    getInterpolatedNodeGraphParams: () => ({}),
    getInterpolatedColorCorrection: () => undefined,
    getInterpolatedVectorAnimationSettings: () => ({
      enabled: false,
      playbackRate: 1,
      loop: true,
      direction: 'forward',
      remapMode: 'clip',
    }),
    getInterpolatedTextBounds: () => undefined,
    getInterpolatedSpeed: () => 1,
    getSourceTimeForClip: () => 0,
    hasKeyframes: () => false,
    now: 0,
    frameNumber: 30,
    videoTracks: [],
    audioTracks: [],
    visibleVideoTrackIds: new Set(),
    unmutedAudioTrackIds: new Set(),
    anyVideoSolo: false,
    anyAudioSolo: false,
    clipsAtTime: [],
    clipsByTrackId: new Map(),
    mediaFiles: [],
    mediaFileById: new Map(),
    mediaFileByName: new Map(),
    compositionById: new Map(),
    masterAudioState: undefined,
    ...overrides,
  };
}

describe('LayerCache', () => {
  it('invalidates cached layers when playback speed changes', () => {
    const cache = new LayerCache();
    const layer = { id: 'cached-layer' } as Layer;
    const stableClips = [];
    const stableTracks = [];
    const initialContext = createFrameContext({
      clips: stableClips,
      tracks: stableTracks,
    });

    expect(cache.checkCache(initialContext).useCache).toBe(false);
    cache.setCachedLayers([layer]);

    expect(cache.checkCache(createFrameContext({
      clips: stableClips,
      tracks: stableTracks,
    })).useCache).toBe(true);
    expect(cache.checkCache(createFrameContext({
      clips: stableClips,
      tracks: stableTracks,
      playbackSpeed: -1,
    })).useCache).toBe(false);
  });
});
