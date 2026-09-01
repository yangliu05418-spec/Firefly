import { afterEach, describe, expect, it, vi } from 'vitest';

const remoteCache = vi.hoisted(() => ({ materialize: vi.fn() }));
const objectUrls = vi.hoisted(() => ({ createPrimary: vi.fn(() => 'blob:opfs-ready') }));
const mediaStore = vi.hoisted(() => ({ state: { files: [] as unknown[] } }));
const thumbnails = vi.hoisted(() => ({
  clearSource: vi.fn().mockResolvedValue(undefined),
  generateForSourceUrl: vi.fn().mockResolvedValue(undefined),
  getStatus: vi.fn(() => 'none'),
}));

vi.mock('../../src/services/project/firefly/FireflyRemoteMediaCache', () => ({
  materializeFireflyRemoteMedia: remoteCache.materialize,
}));

vi.mock('../../src/services/project/mediaObjectUrlManager', () => ({
  createPrimaryMediaObjectUrl: objectUrls.createPrimary,
}));

vi.mock('../../src/services/thumbnailCacheService', () => ({
  thumbnailCacheService: thumbnails,
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: {
    getState: () => mediaStore.state,
    setState: (update: unknown) => {
      const patch = typeof update === 'function'
        ? (update as (state: typeof mediaStore.state) => Partial<typeof mediaStore.state>)(mediaStore.state)
        : update as Partial<typeof mediaStore.state>;
      Object.assign(mediaStore.state, patch);
    },
  },
}));

import {
  createPlaceholderFileForTimelineMedia,
  getTimelineDropMediaTypeOverride,
  resolveMediaFileForTimelineDrop,
  setTimelineDroppedFilePath,
} from '../../src/services/timeline/timelineExternalDropMediaResolver';
import type { MediaFile } from '../../src/stores/mediaStore';
import { useMediaStore } from '../../src/stores/mediaStore';

function mediaFile(overrides: Partial<MediaFile>): MediaFile {
  return {
    id: 'media-1',
    name: 'media.bin',
    type: 'video',
    parentId: null,
    createdAt: 1,
    ...overrides,
  } as MediaFile;
}

describe('timeline external drop media resolver', () => {
  afterEach(() => {
    remoteCache.materialize.mockReset();
    objectUrls.createPrimary.mockClear();
    thumbnails.clearSource.mockClear();
    thumbnails.generateForSourceUrl.mockClear();
    thumbnails.getStatus.mockReset().mockReturnValue('none');
    mediaStore.state.files = [];
  });
  it('marks files with native paths for timeline placement', () => {
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });

    setTimelineDroppedFilePath(file, 'C:/media/clip.mp4');

    expect((file as File & { path?: string }).path).toBe('C:/media/clip.mp4');
  });

  it('preserves the authoritative media type when OPFS files lose their name and MIME metadata', () => {
    expect(getTimelineDropMediaTypeOverride(mediaFile({ type: 'video' }))).toBe('video');
    expect(getTimelineDropMediaTypeOverride(mediaFile({ type: 'audio' }))).toBe('audio');
    expect(getTimelineDropMediaTypeOverride(mediaFile({ type: 'image' }))).toBe('image');
    expect(getTimelineDropMediaTypeOverride(mediaFile({ type: 'model' }))).toBe('model');
    expect(getTimelineDropMediaTypeOverride(mediaFile({ type: 'gaussian-splat' }))).toBe('gaussian-splat');
    expect(getTimelineDropMediaTypeOverride(mediaFile({ type: 'lottie' }))).toBe('lottie');
  });

  it('creates lazy 3D placeholder files with file paths', () => {
    const placeholder = createPlaceholderFileForTimelineMedia(mediaFile({
      name: 'hero.glb',
      type: 'model',
      absolutePath: 'D:/assets/hero.glb',
    }));

    expect(placeholder.name).toBe('hero.glb');
    expect(placeholder.type).toBe('model/gltf-binary');
    expect((placeholder as File & { path?: string }).path).toBe('D:/assets/hero.glb');
  });

  it('resolves existing files and lazy 3D placeholders for timeline drops', async () => {
    const existingFile = new File(['audio'], 'dialog.wav', { type: 'audio/wav' });

    await expect(resolveMediaFileForTimelineDrop(mediaFile({
      type: 'audio',
      file: existingFile,
    }))).resolves.toBe(existingFile);

    await expect(resolveMediaFileForTimelineDrop(mediaFile({
      id: 'model-1',
      name: 'mesh.obj',
      type: 'model',
      absolutePath: 'D:/assets/mesh.obj',
    }))).resolves.toEqual(expect.objectContaining({
      name: 'mesh.obj',
      type: 'model/obj',
    }));
  });

  it.each([
    ['video', 'remote.mp4', 'video/mp4'],
    ['image', 'remote.png', 'image/png'],
  ] as const)('creates a %s timeline clip immediately while OPFS materializes in the background', async (type, name, contentType) => {
    remoteCache.materialize.mockReturnValue(new Promise(() => undefined));
    const remote = mediaFile({
      id: `placeholder-remote-${type}`,
      name,
      type,
      fireflyProjectAssetId: `asset-${type}`,
      remoteSourcePath: `/api/atlas/project-assets/asset-${type}/media`,
      url: `/api/atlas/project-assets/asset-${type}/media`,
      duration: type === 'video' ? 8 : undefined,
      width: 1920,
      height: 1080,
    });
    useMediaStore.setState({ files: [remote] });

    const resolved = await resolveMediaFileForTimelineDrop(remote);

    expect(resolved).toEqual(expect.objectContaining({ name, type: contentType, size: 0 }));
    expect(remoteCache.materialize).toHaveBeenCalledWith(remote, expect.objectContaining({ onProgress: expect.any(Function) }));
  });

  it('does not mistake a restored zero-byte Firefly placeholder for local media', async () => {
    remoteCache.materialize.mockReturnValue(new Promise(() => undefined));
    const remote = mediaFile({
      id: 'restored-placeholder-video',
      name: 'restored.mp4',
      type: 'video',
      file: new File([], 'restored.mp4', { type: 'video/mp4' }),
      fireflyProjectAssetId: 'asset-restored-video',
      remoteSourcePath: '/api/atlas/project-assets/asset-restored-video/media',
      url: '/api/atlas/project-assets/asset-restored-video/media',
      duration: 8,
    });
    useMediaStore.setState({ files: [remote] });

    const resolved = await resolveMediaFileForTimelineDrop(remote);

    expect(resolved).not.toBe(remote.file);
    expect(resolved).toEqual(expect.objectContaining({ name: 'restored.mp4', size: 0 }));
    expect(remoteCache.materialize).toHaveBeenCalledTimes(1);
  });

  it('keeps the OPFS source and starts local filmstrip generation after a remote video materializes', async () => {
    const localFile = new File(['local-video-bytes'], 'remote.mp4', { type: 'video/mp4' });
    remoteCache.materialize.mockResolvedValue({
      file: localFile,
      relativePath: 'media/remote.mp4',
    });
    const remote = mediaFile({
      id: 'remote-video',
      name: 'remote.mp4',
      type: 'video',
      fireflyProjectAssetId: 'asset-video',
      remoteSourcePath: '/api/atlas/project-assets/asset-video/media',
      url: '/api/atlas/project-assets/asset-video/media',
      duration: 8,
      thumbnailUrl: '/api/generations/task-video/poster',
    });
    useMediaStore.setState({ files: [remote] });

    await expect(resolveMediaFileForTimelineDrop(remote)).resolves.toEqual(
      expect.objectContaining({ name: 'remote.mp4', size: 0 }),
    );

    await vi.waitFor(() => {
      expect(thumbnails.generateForSourceUrl).toHaveBeenCalledWith(
        'remote-video',
        'blob:opfs-ready',
        8,
        undefined,
        'anonymous',
      );
    });
    expect(mediaStore.state.files[0]).toEqual(expect.objectContaining({
      file: localFile,
      url: 'blob:opfs-ready',
      remoteCacheStatus: 'ready',
      remoteCacheProgress: 100,
    }));
  });

  it('coalesces duplicate drops through OPFS commit and filmstrip warmup', async () => {
    let resolveMaterialization!: (value: { file: File; relativePath: string }) => void;
    remoteCache.materialize.mockReturnValue(new Promise((resolve) => {
      resolveMaterialization = resolve;
    }));
    const remote = mediaFile({
      id: 'duplicate-video',
      name: 'duplicate.mp4',
      type: 'video',
      fireflyProjectAssetId: 'asset-duplicate-video',
      remoteSourcePath: '/api/atlas/project-assets/asset-duplicate-video/media',
      url: '/api/atlas/project-assets/asset-duplicate-video/media',
      duration: 8,
    });
    useMediaStore.setState({ files: [remote] });

    const first = resolveMediaFileForTimelineDrop(remote);
    const second = resolveMediaFileForTimelineDrop(remote);
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ size: 0 }),
      expect.objectContaining({ size: 0 }),
    ]);
    expect(remoteCache.materialize).toHaveBeenCalledTimes(1);

    const localFile = new File(['local-video-bytes'], 'duplicate.mp4', { type: 'video/mp4' });
    resolveMaterialization({ file: localFile, relativePath: 'media/duplicate.mp4' });

    await vi.waitFor(() => {
      expect(thumbnails.generateForSourceUrl).toHaveBeenCalledTimes(1);
    });
    expect(objectUrls.createPrimary).toHaveBeenCalledTimes(1);
    expect(mediaStore.state.files[0]).toEqual(expect.objectContaining({
      file: localFile,
      url: 'blob:opfs-ready',
      remoteCacheStatus: 'ready',
    }));
  });

  it('commits a copying transfer after the same asset gains its ready descriptor and route', async () => {
    let resolveMaterialization!: (value: { file: File; relativePath: string }) => void;
    remoteCache.materialize.mockReturnValue(new Promise((resolve) => {
      resolveMaterialization = resolve;
    }));
    const copying = mediaFile({
      id: 'copying-video',
      name: 'copying.mp4',
      type: 'video',
      fireflyProjectAssetId: 'asset-copying-video',
      remoteSourcePath: '/api/generations/task-copying/media',
      url: '/api/generations/task-copying/media',
      duration: 8,
      remoteCacheStatus: 'idle',
    });
    useMediaStore.setState({ files: [copying] });

    await expect(resolveMediaFileForTimelineDrop(copying)).resolves.toEqual(
      expect.objectContaining({ size: 0 }),
    );
    useMediaStore.setState({
      files: [{
        ...mediaStore.state.files[0] as MediaFile,
        remoteSourcePath: '/api/atlas/project-assets/asset-copying-video/media',
        url: '/api/atlas/project-assets/asset-copying-video/media',
        localMediaDescriptor: {
          cacheKey: 'asset-copying-video', revision: 'ready-v1', variant: 'preview', mediaType: 'video',
          contentType: 'video/mp4', size: 17, url: '/api/atlas/project-assets/asset-copying-video/media', cachePolicy: 'pin',
        },
      }],
    });

    const localFile = new File(['ready-video-bytes'], 'copying.mp4', { type: 'video/mp4' });
    resolveMaterialization({ file: localFile, relativePath: 'media/copying.mp4' });

    await vi.waitFor(() => expect(thumbnails.generateForSourceUrl).toHaveBeenCalledOnce());
    expect(remoteCache.materialize).toHaveBeenCalledTimes(1);
    expect(mediaStore.state.files[0]).toEqual(expect.objectContaining({
      file: localFile,
      url: 'blob:opfs-ready',
      remoteCacheStatus: 'ready',
      remoteCacheProgress: 100,
      localMediaDescriptor: expect.objectContaining({ revision: 'ready-v1' }),
    }));
  });

  it('refetches the ready route when copying bytes do not match its declared size', async () => {
    let resolveCopyingMaterialization!: (value: { file: File; relativePath: string }) => void;
    let resolveReadyMaterialization!: (value: { file: File; relativePath: string }) => void;
    remoteCache.materialize
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveCopyingMaterialization = resolve;
      }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveReadyMaterialization = resolve;
      }));
    const copying = mediaFile({
      id: 'copying-size-video', name: 'copying-size.mp4', type: 'video', duration: 8,
      fireflyProjectAssetId: 'asset-copying-size-video',
      remoteSourcePath: '/api/generations/task-copying-size/media',
      url: '/api/generations/task-copying-size/media',
    });
    useMediaStore.setState({ files: [copying] });
    await resolveMediaFileForTimelineDrop(copying);
    useMediaStore.setState({
      files: [{
        ...mediaStore.state.files[0] as MediaFile,
        remoteSourcePath: '/api/atlas/project-assets/asset-copying-size-video/media',
        url: '/api/atlas/project-assets/asset-copying-size-video/media',
        localMediaDescriptor: {
          cacheKey: 'asset-copying-size-video', revision: 'ready-v1', variant: 'preview', mediaType: 'video',
          contentType: 'video/mp4', size: 17, url: '/api/atlas/project-assets/asset-copying-size-video/media', cachePolicy: 'pin',
        },
      }],
    });

    resolveCopyingMaterialization({
      file: new File(['truncated'], 'copying-size.mp4', { type: 'video/mp4' }),
      relativePath: 'media/copying-size.mp4',
    });
    await vi.waitFor(() => expect(remoteCache.materialize).toHaveBeenCalledTimes(2));
    expect(objectUrls.createPrimary).not.toHaveBeenCalled();
    expect(thumbnails.generateForSourceUrl).not.toHaveBeenCalled();

    const completeFile = new File(['ready-video-bytes'], 'copying-size.mp4', { type: 'video/mp4' });
    resolveReadyMaterialization({ file: completeFile, relativePath: 'media/copying-size.mp4' });
    await vi.waitFor(() => expect(thumbnails.generateForSourceUrl).toHaveBeenCalledOnce());
    expect(mediaStore.state.files[0]).toEqual(expect.objectContaining({
      file: completeFile,
      url: 'blob:opfs-ready',
      remoteCacheStatus: 'ready',
    }));
  });

  it('retries the ready route when the copying route fails during the bridge upgrade', async () => {
    let rejectCopyingMaterialization!: (reason: Error) => void;
    let resolveReadyMaterialization!: (value: { file: File; relativePath: string }) => void;
    remoteCache.materialize
      .mockReturnValueOnce(new Promise((_resolve, reject) => {
        rejectCopyingMaterialization = reject;
      }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveReadyMaterialization = resolve;
      }));
    const copying = mediaFile({
      id: 'copying-failure-video',
      name: 'copying-failure.mp4',
      type: 'video',
      fireflyProjectAssetId: 'asset-copying-failure-video',
      remoteSourcePath: '/api/generations/task-copying-failure/media',
      url: '/api/generations/task-copying-failure/media',
      duration: 8,
      remoteCacheStatus: 'idle',
    });
    useMediaStore.setState({ files: [copying] });

    await expect(resolveMediaFileForTimelineDrop(copying)).resolves.toEqual(
      expect.objectContaining({ size: 0 }),
    );
    useMediaStore.setState({
      files: [{
        ...mediaStore.state.files[0] as MediaFile,
        remoteSourcePath: '/api/atlas/project-assets/asset-copying-failure-video/media',
        url: '/api/atlas/project-assets/asset-copying-failure-video/media',
        localMediaDescriptor: {
          cacheKey: 'asset-copying-failure-video', revision: 'ready-v1', variant: 'preview', mediaType: 'video',
          contentType: 'video/mp4', size: 17, url: '/api/atlas/project-assets/asset-copying-failure-video/media', cachePolicy: 'pin',
        },
      }],
    });

    rejectCopyingMaterialization(new Error('copying route returned 404'));
    await vi.waitFor(() => expect(remoteCache.materialize).toHaveBeenCalledTimes(2));
    expect(mediaStore.state.files[0]).toEqual(expect.objectContaining({
      remoteCacheStatus: 'downloading',
      localMediaDescriptor: expect.objectContaining({ revision: 'ready-v1' }),
    }));

    const localFile = new File(['ready-after-retry'], 'copying-failure.mp4', { type: 'video/mp4' });
    resolveReadyMaterialization({ file: localFile, relativePath: 'media/copying-failure.mp4' });
    await vi.waitFor(() => expect(thumbnails.generateForSourceUrl).toHaveBeenCalledOnce());

    expect(mediaStore.state.files[0]).toEqual(expect.objectContaining({
      file: localFile,
      url: 'blob:opfs-ready',
      remoteCacheStatus: 'ready',
      remoteCacheProgress: 100,
    }));
  });

  it('continues with a replacement revision after discarding the late prior result', async () => {
    let resolveFirstMaterialization!: (value: { file: File; relativePath: string }) => void;
    let resolveSecondMaterialization!: (value: { file: File; relativePath: string }) => void;
    remoteCache.materialize
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirstMaterialization = resolve;
      }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveSecondMaterialization = resolve;
      }));
    const descriptor = (revision: string, url: string) => ({
      cacheKey: 'shared-cache-key',
      revision,
      variant: 'preview' as const,
      mediaType: 'video' as const,
      contentType: 'video/mp4',
      size: 17,
      url,
      cachePolicy: 'pin' as const,
    });
    const original = mediaFile({
      id: 'revision-video',
      name: 'revision.mp4',
      type: 'video',
      fireflyProjectAssetId: 'asset-revision-video',
      remoteSourcePath: '/api/atlas/project-assets/asset-revision-video/media?v=1',
      url: '/api/atlas/project-assets/asset-revision-video/media?v=1',
      duration: 8,
      localMediaDescriptor: descriptor('revision-1', '/media?v=1'),
    });
    useMediaStore.setState({ files: [original] });

    await expect(resolveMediaFileForTimelineDrop(original)).resolves.toEqual(
      expect.objectContaining({ size: 0 }),
    );
    useMediaStore.setState({
      files: [{
        ...original,
        localMediaDescriptor: descriptor('revision-2', '/media?v=2'),
        remoteSourcePath: '/api/atlas/project-assets/asset-revision-video/media?v=2',
        url: '/api/atlas/project-assets/asset-revision-video/media?v=2',
      }],
    });

    resolveFirstMaterialization({
      file: new File(['stale-video-bytes'], 'revision.mp4', { type: 'video/mp4' }),
      relativePath: 'media/revision-v1.mp4',
    });
    await vi.waitFor(() => expect(remoteCache.materialize).toHaveBeenCalledTimes(2));

    expect(objectUrls.createPrimary).not.toHaveBeenCalled();
    expect(thumbnails.generateForSourceUrl).not.toHaveBeenCalled();
    expect(remoteCache.materialize.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      localMediaDescriptor: expect.objectContaining({ revision: 'revision-2' }),
    }));

    const currentFile = new File(['fresh-video-bytes'], 'revision.mp4', { type: 'video/mp4' });
    resolveSecondMaterialization({
      file: currentFile,
      relativePath: 'media/revision-v2.mp4',
    });
    await vi.waitFor(() => expect(thumbnails.generateForSourceUrl).toHaveBeenCalledOnce());

    expect(mediaStore.state.files[0]).toEqual(expect.objectContaining({
      file: currentFile,
      url: 'blob:opfs-ready',
      remoteCacheStatus: 'ready',
      remoteCacheProgress: 100,
      localMediaDescriptor: expect.objectContaining({ revision: 'revision-2' }),
    }));
  });
});
