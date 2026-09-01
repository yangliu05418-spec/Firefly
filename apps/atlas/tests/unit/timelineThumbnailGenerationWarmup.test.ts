import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: { getState: () => ({ files: [] }) },
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: () => ({ clips: [], isPlaying: false, clipDragPreview: null }),
  },
}));

import {
  resetTimelineThumbnailGenerationWarmupForTest,
  scheduleVisibleTimelineThumbnailGeneration,
  warmVisibleTimelineThumbnailGeneration,
  type TimelineThumbnailGenerationWarmupDeps,
} from '../../src/services/timeline/timelineThumbnailGenerationWarmup';
import type { ThumbnailStatus } from '../../src/services/thumbnailCacheService';

function createVideo(overrides: Partial<HTMLVideoElement> = {}): HTMLVideoElement {
  return {
    src: 'blob:video-a',
    currentSrc: 'blob:video-a',
    duration: 4,
    ...overrides,
  } as HTMLVideoElement;
}

function createDeps(
  overrides: Partial<ReturnType<TimelineThumbnailGenerationWarmupDeps['getState']>> = {},
  status: ThumbnailStatus = 'none',
): TimelineThumbnailGenerationWarmupDeps {
  let currentStatus = status;
  const generateForSourceUrl = vi.fn<TimelineThumbnailGenerationWarmupDeps['generateForSourceUrl']>()
    .mockImplementation(async () => {
      currentStatus = 'ready';
    });
  const video = createVideo();

  return {
    getState: () => ({
      clips: [
        {
          id: 'clip-a',
          duration: 4,
          outPoint: 4,
          source: {
            type: 'video',
            mediaFileId: 'media-a',
            videoElement: video,
            naturalDuration: 4,
          },
        },
      ],
      mediaFiles: [
        {
          id: 'media-a',
          fileHash: 'hash-a',
          duration: 4,
        },
      ],
      isPlaying: false,
      clipDragPreview: null,
      ...overrides,
    }),
    getStatus: vi.fn(() => currentStatus),
    getCount: vi.fn(() => Math.ceil(video.duration)),
    generateForSourceUrl,
    maxConcurrentGenerations: 2,
    setTimeout,
    clearTimeout,
  };
}

describe('timeline thumbnail generation warmup', () => {
  afterEach(() => {
    resetTimelineThumbnailGenerationWarmupForTest();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('generates thumbnails for visible refs with an available video element', async () => {
    const deps = createDeps();

    await expect(warmVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
    ], { deps })).resolves.toEqual([
      { mediaFileId: 'media-a', status: 'generated' },
    ]);

    expect(deps.generateForSourceUrl).toHaveBeenCalledTimes(1);
    expect(deps.generateForSourceUrl).toHaveBeenCalledWith(
      'media-a',
      'blob:video-a',
      4,
      'hash-a',
      'anonymous',
    );
  });

  it('passes exact visible source-second ranges to the thumbnail generator', async () => {
    const deps = createDeps();
    const prioritySecondRanges = [{ startSecond: 2, endSecond: 3 }];

    await expect(warmVisibleTimelineThumbnailGeneration([{
      mediaFileId: 'media-a',
      fileHash: 'hash-a',
      prioritySecondRanges,
    }], { deps })).resolves.toEqual([
      { mediaFileId: 'media-a', status: 'generated' },
    ]);

    expect(deps.generateForSourceUrl).toHaveBeenCalledWith(
      'media-a',
      'blob:video-a',
      4,
      'hash-a',
      'anonymous',
      prioritySecondRanges,
    );
  });

  it('blocks thumbnail generation while playback is active', async () => {
    const deps = createDeps({ isPlaying: true });

    await expect(warmVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
    ], { deps })).resolves.toEqual([
      { mediaFileId: 'media-a', status: 'blocked' },
    ]);

    expect(deps.generateForSourceUrl).not.toHaveBeenCalled();
  });

  it('does not generate when thumbnails are already ready or generating', async () => {
    const deps = createDeps({}, 'ready');

    await expect(warmVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
    ], { deps })).resolves.toEqual([
      { mediaFileId: 'media-a', status: 'ready' },
    ]);

    expect(deps.generateForSourceUrl).not.toHaveBeenCalled();
  });

  it('regenerates when a ready cache contains fewer frames than the source duration', async () => {
    const deps = createDeps({}, 'ready');
    vi.mocked(deps.getCount!).mockReturnValue(1);

    await expect(warmVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
    ], { deps })).resolves.toEqual([
      { mediaFileId: 'media-a', status: 'generated' },
    ]);

    expect(deps.generateForSourceUrl).toHaveBeenCalledTimes(1);
  });

  it('reports a generator error instead of claiming the filmstrip was generated', async () => {
    const deps = createDeps();
    vi.mocked(deps.getStatus)
      .mockReturnValueOnce('none')
      .mockReturnValue('error');
    vi.mocked(deps.generateForSourceUrl).mockResolvedValue(undefined);

    await expect(warmVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
    ], { deps })).resolves.toEqual([
      { mediaFileId: 'media-a', status: 'error' },
    ]);
  });

  it('reports skipped when generation finishes without producing a ready source', async () => {
    const deps = createDeps();
    vi.mocked(deps.getStatus).mockReturnValue('none');
    vi.mocked(deps.generateForSourceUrl).mockResolvedValue(undefined);

    await expect(warmVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
    ], { deps })).resolves.toEqual([
      { mediaFileId: 'media-a', status: 'skipped' },
    ]);
  });

  it('coalesces overlapping generation requests by media id and file hash', async () => {
    let resolveGeneration: (() => void) | undefined;
    const deps = createDeps();
    vi.mocked(deps.generateForSourceUrl).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveGeneration = resolve;
      }),
    );

    const refs = [{ mediaFileId: 'media-a', fileHash: 'hash-a' }];
    const first = warmVisibleTimelineThumbnailGeneration(refs, { deps });
    const second = warmVisibleTimelineThumbnailGeneration(refs, { deps });

    await vi.waitFor(() => expect(deps.generateForSourceUrl).toHaveBeenCalledTimes(1));
    resolveGeneration?.();

    await expect(first).resolves.toEqual([{ mediaFileId: 'media-a', status: 'skipped' }]);
    await expect(second).resolves.toEqual([{ mediaFileId: 'media-a', status: 'skipped' }]);
  });

  it('promotes a newly visible range while full-source generation is in flight', async () => {
    let resolveGeneration: (() => void) | undefined;
    const deps = createDeps();
    deps.prioritizeSourceSeconds = vi.fn();
    vi.mocked(deps.generateForSourceUrl).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveGeneration = resolve;
      }),
    );

    const first = warmVisibleTimelineThumbnailGeneration([{
      mediaFileId: 'media-a',
      fileHash: 'hash-a',
      prioritySecondRanges: [{ startSecond: 0, endSecond: 1 }],
    }], { deps });
    await vi.waitFor(() => expect(deps.generateForSourceUrl).toHaveBeenCalledTimes(1));

    const second = warmVisibleTimelineThumbnailGeneration([{
      mediaFileId: 'media-a',
      fileHash: 'hash-a',
      prioritySecondRanges: [{ startSecond: 3, endSecond: 4 }],
    }], { deps });

    expect(deps.prioritizeSourceSeconds).toHaveBeenCalledWith(
      'media-a',
      [{ startSecond: 3, endSecond: 4 }],
    );
    expect(deps.generateForSourceUrl).toHaveBeenCalledTimes(1);

    resolveGeneration?.();
    await expect(first).resolves.toEqual([{ mediaFileId: 'media-a', status: 'skipped' }]);
    await expect(second).resolves.toEqual([{ mediaFileId: 'media-a', status: 'skipped' }]);
  });

  it('limits concurrent visible thumbnail generation jobs', async () => {
    const deps = createDeps({
      clips: [
        {
          id: 'clip-a',
          duration: 4,
          source: { type: 'video', mediaFileId: 'media-a', naturalDuration: 4 },
        },
        {
          id: 'clip-b',
          duration: 4,
          source: { type: 'video', mediaFileId: 'media-b', naturalDuration: 4 },
        },
      ],
      mediaFiles: [
        { id: 'media-a', fileHash: 'hash-a', duration: 4, url: 'blob:media-a' },
        { id: 'media-b', fileHash: 'hash-b', duration: 4, url: 'blob:media-b' },
      ],
    });
    deps.maxConcurrentGenerations = 1;
    let resolveFirst: (() => void) | undefined;
    let resolveSecond: (() => void) | undefined;
    vi.mocked(deps.generateForSourceUrl).mockImplementation((mediaFileId) => (
      new Promise<void>((resolve) => {
        if (mediaFileId === 'media-a') {
          resolveFirst = resolve;
        } else {
          resolveSecond = resolve;
        }
      })
    ));

    const first = warmVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
    ], { deps });
    await vi.waitFor(() => expect(deps.generateForSourceUrl).toHaveBeenCalledTimes(1));

    const second = warmVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-b', fileHash: 'hash-b' },
    ], { deps });
    await Promise.resolve();
    expect(deps.generateForSourceUrl).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await expect(first).resolves.toEqual([{ mediaFileId: 'media-a', status: 'skipped' }]);
    await vi.waitFor(() => expect(deps.generateForSourceUrl).toHaveBeenCalledTimes(2));

    resolveSecond?.();
    await expect(second).resolves.toEqual([{ mediaFileId: 'media-b', status: 'skipped' }]);
  });

  it('can cancel scheduled thumbnail generation before work starts', () => {
    vi.useFakeTimers();
    const deps = createDeps();
    const cancel = scheduleVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
    ], {
      deps,
      delayMs: 50,
    });

    cancel();
    vi.advanceTimersByTime(60);

    expect(deps.generateForSourceUrl).not.toHaveBeenCalled();
  });

  it('binds default browser timers before scheduling visible generation', () => {
    const receiverAwareSetTimeout = vi.fn(function (
      this: typeof globalThis,
      _callback: () => void,
    ) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return 1 as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    const receiverAwareClearTimeout = vi.fn(function (
      this: typeof globalThis,
      _handle?: ReturnType<typeof setTimeout>,
    ) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
    }) as unknown as typeof clearTimeout;

    vi.stubGlobal('setTimeout', receiverAwareSetTimeout);
    vi.stubGlobal('clearTimeout', receiverAwareClearTimeout);

    const cancel = scheduleVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
    ], { delayMs: 50 });

    expect(receiverAwareSetTimeout).toHaveBeenCalledTimes(1);
    cancel();
    expect(receiverAwareClearTimeout).toHaveBeenCalledTimes(1);
  });

  it('generates from the media file URL when no matching video element is available', async () => {
    const deps = createDeps({
      clips: [
        {
          id: 'clip-a',
          duration: 4,
          source: { type: 'video', mediaFileId: 'media-a' },
        },
      ],
      mediaFiles: [
        {
          id: 'media-a',
          fileHash: 'hash-a',
          duration: 4,
          url: 'blob:media-file-url',
        },
      ],
    });

    await expect(warmVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
    ], { deps })).resolves.toEqual([
      { mediaFileId: 'media-a', status: 'generated' },
    ]);
    expect(deps.generateForSourceUrl).toHaveBeenCalledWith(
      'media-a',
      'blob:media-file-url',
      4,
      'hash-a',
      'anonymous',
    );
  });

  it('waits for OPFS instead of competing with a downloading Firefly remote source', async () => {
    const deps = createDeps({
      clips: [{
        id: 'clip-a',
        duration: 8,
        source: { type: 'video', mediaFileId: 'media-a', naturalDuration: 8 },
      }],
      mediaFiles: [{
        id: 'media-a',
        duration: 8,
        url: '/api/atlas/project-assets/asset-a/media',
        fireflyProjectAssetId: 'asset-a',
        remoteSourcePath: '/api/atlas/project-assets/asset-a/media',
        remoteCacheStatus: 'downloading',
      }],
    });

    await expect(warmVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-a' },
    ], { deps })).resolves.toEqual([
      { mediaFileId: 'media-a', status: 'blocked' },
    ]);
    expect(deps.generateForSourceUrl).not.toHaveBeenCalled();
  });

  it('starts OPFS recovery for a visible restored Firefly clip before native filmstrip generation', async () => {
    const deps = createDeps({
      clips: [{
        id: 'clip-a',
        duration: 8,
        source: { type: 'video', mediaFileId: 'media-a', naturalDuration: 8 },
      }],
      mediaFiles: [{
        id: 'media-a',
        duration: 8,
        file: new File([], 'restored.mp4', { type: 'video/mp4' }),
        url: '/api/atlas/project-assets/asset-a/media',
        fireflyProjectAssetId: 'asset-a',
        remoteSourcePath: '/api/atlas/project-assets/asset-a/media',
        remoteCacheStatus: 'idle',
      }],
    });
    deps.ensureLocalSource = vi.fn();

    await expect(warmVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-a' },
    ], { deps })).resolves.toEqual([
      { mediaFileId: 'media-a', status: 'blocked' },
    ]);

    expect(deps.ensureLocalSource).toHaveBeenCalledWith('media-a');
    expect(deps.generateForSourceUrl).not.toHaveBeenCalled();
  });

  it('uses the local OPFS blob after a Firefly remote source is ready', async () => {
    const localFile = new File(['video'], 'remote.mp4', { type: 'video/mp4' });
    const deps = createDeps({
      clips: [{
        id: 'clip-a',
        duration: 8,
        source: { type: 'video', mediaFileId: 'media-a', naturalDuration: 8 },
      }],
      mediaFiles: [{
        id: 'media-a',
        duration: 8,
        file: localFile,
        url: 'blob:opfs-ready',
        fireflyProjectAssetId: 'asset-a',
        remoteSourcePath: '/api/atlas/project-assets/asset-a/media',
        remoteCacheStatus: 'ready',
      }],
    });

    await expect(warmVisibleTimelineThumbnailGeneration([
      { mediaFileId: 'media-a' },
    ], { deps })).resolves.toEqual([
      { mediaFileId: 'media-a', status: 'generated' },
    ]);
    expect(deps.generateForSourceUrl).toHaveBeenCalledWith(
      'media-a',
      'blob:opfs-ready',
      8,
      undefined,
      'anonymous',
    );
  });
});
