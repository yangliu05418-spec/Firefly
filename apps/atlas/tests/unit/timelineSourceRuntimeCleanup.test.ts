import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types';
import { audioRoutingManager } from '../../src/services/audioRoutingManager';
import {
  detachLegacyTimelineMediaElement,
  releaseLegacyTimelineClipSourceRuntimes,
} from '../../src/services/timeline/timelineClipSourceRuntimeCleanup';
import { vectorAnimationRuntimeManager } from '../../src/services/vectorAnimation/VectorAnimationRuntimeManager';
import { createMockClip } from '../helpers/mockData';

vi.mock('../../src/services/audioRoutingManager', () => ({
  audioRoutingManager: {
    disposeRoute: vi.fn(),
  },
}));

vi.mock('../../src/services/vectorAnimation/VectorAnimationRuntimeManager', () => ({
  vectorAnimationRuntimeManager: {
    destroyClipRuntime: vi.fn(),
  },
}));

const originalRevokeObjectURL = URL.revokeObjectURL;

function mockMediaElementMethods(element: HTMLMediaElement): void {
  Object.defineProperty(element, 'pause', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(element, 'load', {
    configurable: true,
    value: vi.fn(),
  });
}

function makeClip(clip: Partial<TimelineClip>): TimelineClip {
  return createMockClip({
    id: clip.id ?? 'clip-runtime',
    trackId: clip.trackId ?? 'video-1',
    name: clip.name ?? 'runtime-clip',
    file: clip.file ?? new File([], 'runtime.dat'),
    source: clip.source ?? null,
    nestedClips: clip.nestedClips,
  });
}

describe('timeline clip source runtime cleanup', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: originalRevokeObjectURL,
    });
  });

  it('detaches legacy media source handles and pauses detached WebCodecs players', () => {
    const videoElement = document.createElement('video');
    const audioElement = document.createElement('audio');
    mockMediaElementMethods(videoElement);
    mockMediaElementMethods(audioElement);
    videoElement.src = 'blob:http://localhost/video-source';
    audioElement.src = 'blob:http://localhost/audio-source';

    const webCodecsPlayer = {
      isPlaying: true,
      pause: vi.fn(),
    };

    releaseLegacyTimelineClipSourceRuntimes([
      makeClip({
        id: 'clip-video',
        source: {
          type: 'video',
          naturalDuration: 10,
          videoElement,
          webCodecsPlayer: webCodecsPlayer as never,
        },
      }),
      makeClip({
        id: 'clip-audio',
        source: {
          type: 'audio',
          naturalDuration: 10,
          audioElement,
        },
      }),
    ], { revokeObjectUrls: true });

    expect(videoElement.pause).toHaveBeenCalled();
    expect(videoElement.load).toHaveBeenCalled();
    expect(audioElement.pause).toHaveBeenCalled();
    expect(audioElement.load).toHaveBeenCalled();
    expect(webCodecsPlayer.pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(expect.stringContaining('video-source'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(expect.stringContaining('audio-source'));
    expect(videoElement.getAttribute('src')).toBeNull();
    expect(audioElement.getAttribute('src')).toBeNull();
  });

  it('releases vector runtimes recursively when nested clips are included', () => {
    releaseLegacyTimelineClipSourceRuntimes([
      makeClip({
        id: 'clip-vector',
        source: {
          type: 'lottie',
          naturalDuration: 10,
        },
        nestedClips: [
          makeClip({
            id: 'clip-nested-vector',
            source: {
              type: 'rive',
              naturalDuration: 10,
            },
          }),
        ],
      }),
    ], { recurseNestedClips: true });

    expect(vectorAnimationRuntimeManager.destroyClipRuntime).toHaveBeenCalledWith('clip-vector', 'lottie');
    expect(vectorAnimationRuntimeManager.destroyClipRuntime).toHaveBeenCalledWith('clip-nested-vector', 'rive');
  });

  it('can dispose audio routing for media elements that are not clip sources', () => {
    const mixdownElement = document.createElement('audio');
    mockMediaElementMethods(mixdownElement);

    detachLegacyTimelineMediaElement(mixdownElement, { disposeAudioRouting: true });

    expect(audioRoutingManager.disposeRoute).toHaveBeenCalledWith(mixdownElement);
    expect(mixdownElement.pause).toHaveBeenCalled();
    expect(mixdownElement.load).toHaveBeenCalled();
  });
});
