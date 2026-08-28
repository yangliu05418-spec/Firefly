import { describe, expect, it } from 'vitest';
import type { TimelineClip } from '../../src/types';
import {
  collectTimelineProxyWarmupVideos,
  getTimelineClipScrubCacheVideoSrc,
} from '../../src/services/timeline/timelineProxyCacheRuntime';
import { createMockClip } from '../helpers/mockData';

function createVideo(src: string): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperty(video, 'src', {
    configurable: true,
    value: src,
  });
  return video;
}

function createVideoClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({
    id: 'clip-video',
    name: 'Video Clip',
    source: {
      type: 'video',
      videoElement: createVideo('blob:video-source'),
      naturalDuration: 12,
    },
    duration: 8,
    ...overrides,
  });
}

describe('timeline proxy cache runtime', () => {
  it('resolves scrub cache video sources from legacy timeline source handles', () => {
    const clip = createVideoClip();

    expect(getTimelineClipScrubCacheVideoSrc(clip)).toBe('blob:video-source');
    expect(getTimelineClipScrubCacheVideoSrc(createMockClip({ source: { type: 'image' } }))).toBeNull();
  });

  it('collects proxy warmup videos from top-level and nested clips', () => {
    const topLevelVideo = createVideo('blob:top-level');
    const nestedVideo = createVideo('blob:nested');
    const clips = [
      createVideoClip({
        id: 'top-video',
        name: 'Top Video',
        source: { type: 'video', videoElement: topLevelVideo, naturalDuration: 15 },
        duration: 6,
      }),
      createMockClip({
        id: 'composition',
        name: 'Comp',
        isComposition: true,
        nestedClips: [
          createVideoClip({
            id: 'nested-video',
            name: 'Nested Video',
            source: { type: 'video', videoElement: nestedVideo },
            duration: 4,
          }),
        ],
      }),
    ];

    expect(collectTimelineProxyWarmupVideos(clips)).toEqual([
      { video: topLevelVideo, duration: 15, name: 'Top Video' },
      { video: nestedVideo, duration: 4, name: 'Nested Video' },
    ]);
  });
});
