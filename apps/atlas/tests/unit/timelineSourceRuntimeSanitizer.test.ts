import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types/timeline';
import { DEFAULT_TRACKS, useTimelineStore } from '../../src/stores/timeline';
import {
  hasTimelineSourceRuntimeHandles,
  stripTimelineSourceRuntimeHandles,
} from '../../src/stores/timeline/sourceRuntimeSanitizer';
import { createMockClip } from '../helpers/mockData';

const runtimeSourceKeys = [
  'videoElement',
  'audioElement',
  'imageElement',
  'textCanvas',
  'webCodecsPlayer',
  'nativeDecoder',
  'runtimeSourceId',
  'runtimeSessionKey',
  'file',
] as const;

function makeRuntimeVideoClip(): TimelineClip {
  return createMockClip({
    id: 'clip-runtime',
    trackId: 'video-1',
    name: 'runtime.mp4',
    file: new File(['runtime'], 'runtime.mp4', { type: 'video/mp4' }),
    source: {
      type: 'video',
      mediaFileId: 'media-runtime',
      naturalDuration: 12,
      filePath: 'C:/media/runtime.mp4',
      videoElement: document.createElement('video'),
      imageElement: document.createElement('img'),
      webCodecsPlayer: { destroy: vi.fn() } as never,
      nativeDecoder: { close: vi.fn() } as never,
      runtimeSourceId: 'runtime-source',
      runtimeSessionKey: 'interactive:runtime-source',
      file: new File(['source'], 'source.mp4', { type: 'video/mp4' }),
    },
    mediaFileId: 'media-runtime',
    duration: 12,
    outPoint: 12,
  });
}

function collectKeys(value: unknown): Set<string> {
  const keys = new Set<string>();
  const visit = (entry: unknown) => {
    if (!entry || typeof entry !== 'object') return;
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(entry)) {
      keys.add(key);
      visit(child);
    }
  };
  visit(value);
  return keys;
}

describe('timeline source runtime sanitizer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useTimelineStore.setState({
      tracks: DEFAULT_TRACKS,
      clips: [],
      clipKeyframes: new Map(),
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      clipboardData: null,
      playheadPosition: 0,
      duration: 60,
      targetTrackIdByType: {},
    });
  });

  it('strips runtime handles from timeline source objects', () => {
    const clip = makeRuntimeVideoClip();
    const source = stripTimelineSourceRuntimeHandles(clip.source);

    expect(hasTimelineSourceRuntimeHandles(clip.source)).toBe(true);
    expect(source).toEqual({
      type: 'video',
      mediaFileId: 'media-runtime',
      naturalDuration: 12,
      filePath: 'C:/media/runtime.mp4',
    });
    expect(hasTimelineSourceRuntimeHandles(source)).toBe(false);
  });

  it('serializes clips from data-only source metadata', () => {
    useTimelineStore.setState({
      clips: [makeRuntimeVideoClip()],
    });

    const serialized = useTimelineStore.getState().getSerializableState();
    const serializedClip = serialized.clips[0];
    const keys = collectKeys(serialized);

    expect(serializedClip).toMatchObject({
      id: 'clip-runtime',
      sourceType: 'video',
      mediaFileId: 'media-runtime',
      naturalDuration: 12,
    });
    for (const key of runtimeSourceKeys) {
      expect(keys.has(key), `serialized state contains ${key}`).toBe(false);
    }
  });

  it('copies clips from data-only source metadata', () => {
    useTimelineStore.setState({
      clips: [makeRuntimeVideoClip()],
      selectedClipIds: new Set(['clip-runtime']),
    });

    useTimelineStore.getState().copyClips();
    const clipboardData = useTimelineStore.getState().clipboardData;
    const keys = collectKeys(clipboardData);

    expect(clipboardData?.[0]).toMatchObject({
      id: 'clip-runtime',
      sourceType: 'video',
      mediaFileId: 'media-runtime',
      naturalDuration: 12,
    });
    for (const key of runtimeSourceKeys) {
      expect(keys.has(key), `clipboard data contains ${key}`).toBe(false);
    }
  });
});
