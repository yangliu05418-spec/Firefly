import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MediaRuntimeMediaElementLeaseOwner,
  createRuntimeAudioElement,
  createRuntimeVideoElement,
  mediaRuntimeMediaElementLeaseOwner,
  releaseRuntimeMediaElement,
} from '../../src/services/mediaRuntime/mediaElementLeases';
import { mediaRuntimeObjectUrlLeaseOwner } from '../../src/services/mediaRuntime/objectUrlLeases';
import { createAudioElement, createVideoElement, releaseTemporaryMediaElement } from '../../src/stores/timeline/helpers/webCodecsHelpers';

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

function installUrlMocks(urls: string[]) {
  let nextUrl = 0;
  const createObjectURL = vi.fn<[Blob], string>(() => urls[nextUrl++] ?? `blob:media-element-${nextUrl}`);
  const revokeObjectURL = vi.fn<[string], void>();

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: revokeObjectURL,
  });

  return { createObjectURL, revokeObjectURL };
}

function restoreUrlMocks(): void {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: originalCreateObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: originalRevokeObjectURL,
  });
}

describe('media runtime media element lease owner', () => {
  afterEach(() => {
    mediaRuntimeMediaElementLeaseOwner.clear();
    mediaRuntimeObjectUrlLeaseOwner.clear();
    restoreUrlMocks();
    vi.restoreAllMocks();
  });

  it('acquires and releases temporary video element leases idempotently', () => {
    const { createObjectURL, revokeObjectURL } = installUrlMocks(['blob:runtime-video']);
    const owner = new MediaRuntimeMediaElementLeaseOwner();
    const file = new File(['video'], 'clip.mp4', {
      type: 'video/mp4',
      lastModified: 10,
    });

    const video = owner.createVideoElement(file);
    const lease = owner.getByElement(video);

    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(video.tagName).toBe('VIDEO');
    expect(video.src).toBe('blob:runtime-video');
    expect(video.preload).toBe('metadata');
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.crossOrigin).toBe('anonymous');
    expect(lease?.status).toBe('active');
    expect(owner.getStats()).toEqual({ liveLeases: 1, created: 1, released: 0 });

    owner.releaseElement(video, 'done');
    owner.releaseElement(video, 'again');

    expect(video.hasAttribute('src')).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:runtime-video');
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(lease?.status).toBe('released');
    expect(lease?.getRuntimeHandles()).toBeNull();
    expect(owner.getStats()).toEqual({ liveLeases: 0, created: 1, released: 1 });
  });

  it('delegates element object URLs to the mediaRuntime object URL owner', () => {
    installUrlMocks(['blob:runtime-audio']);
    const owner = new MediaRuntimeMediaElementLeaseOwner();
    const file = new File(['audio'], 'clip.wav', {
      type: 'audio/wav',
      lastModified: 20,
    });

    // created/revoked are lifetime-cumulative singleton counters; assert deltas.
    const baseline = mediaRuntimeObjectUrlLeaseOwner.getStats();
    const audio = owner.createAudioElement(file);
    const handles = owner.getByElement(audio)?.getRuntimeHandles();

    expect(audio.tagName).toBe('AUDIO');
    expect(audio.src).toBe('blob:runtime-audio');
    expect(audio.preload).toBe('auto');
    expect(handles?.objectUrlRuntimeSourceId).toBeTruthy();
    expect(mediaRuntimeObjectUrlLeaseOwner.getUrl(handles?.objectUrlRuntimeSourceId ?? '')).toBe('blob:runtime-audio');
    expect(mediaRuntimeObjectUrlLeaseOwner.getStats()).toEqual({
      liveLeases: 1,
      created: baseline.created + 1,
      revoked: baseline.revoked,
    });

    owner.releaseElement(audio);

    expect(mediaRuntimeObjectUrlLeaseOwner.getUrl(handles?.objectUrlRuntimeSourceId ?? '')).toBeUndefined();
    expect(mediaRuntimeObjectUrlLeaseOwner.getStats()).toEqual({
      liveLeases: 0,
      created: baseline.created + 1,
      revoked: baseline.revoked + 1,
    });
  });

  it('keeps runtime element helpers signature-compatible with the timeline facade', () => {
    const { revokeObjectURL } = installUrlMocks([
      'blob:facade-video',
      'blob:facade-audio',
    ]);
    const videoFile = new File(['video'], 'facade.mp4', { type: 'video/mp4' });
    const audioFile = new File(['audio'], 'facade.wav', { type: 'audio/wav' });

    const video = createVideoElement(videoFile);
    const audio = createAudioElement(audioFile);

    expect(video).toBeInstanceOf(HTMLVideoElement);
    expect(audio).toBeInstanceOf(HTMLAudioElement);
    expect(video.src).toBe('blob:facade-video');
    expect(audio.src).toBe('blob:facade-audio');
    expect(mediaRuntimeMediaElementLeaseOwner.getByElement(video)).toBeTruthy();
    expect(mediaRuntimeMediaElementLeaseOwner.getByElement(audio)).toBeTruthy();

    releaseTemporaryMediaElement(video);
    releaseTemporaryMediaElement(audio);

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:facade-video');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:facade-audio');
    expect(mediaRuntimeMediaElementLeaseOwner.getStats()).toEqual({
      liveLeases: 0,
      created: 2,
      released: 2,
    });
  });

  it('delegates unmanaged blob URL release through objectUrlLeases', () => {
    const { revokeObjectURL } = installUrlMocks([]);
    const audio = document.createElement('audio');
    audio.src = 'blob:legacy-audio';

    // created/revoked are lifetime-cumulative singleton counters; assert deltas.
    const baseline = mediaRuntimeObjectUrlLeaseOwner.getStats();
    releaseRuntimeMediaElement(audio);

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:legacy-audio');
    expect(mediaRuntimeObjectUrlLeaseOwner.getStats()).toEqual({
      liveLeases: 0,
      created: baseline.created,
      revoked: baseline.revoked + 1,
    });
  });

  it('exposes mediaRuntime creation helpers with the legacy element configuration', () => {
    installUrlMocks(['blob:direct-video', 'blob:direct-audio']);

    const video = createRuntimeVideoElement(new File(['video'], 'direct.mp4'));
    const audio = createRuntimeAudioElement(new File(['audio'], 'direct.wav'));

    expect(video.preload).toBe('metadata');
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.crossOrigin).toBe('anonymous');
    expect(audio.preload).toBe('auto');
  });
});
