import { afterEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../../src/stores/mediaStore');
vi.unmock('../../src/services/fileSystemService');
vi.mock('../../src/stores/mediaStore/init', () => ({
  triggerTimelineSave: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  invalidateRuntime: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/project/fireflyRemoteAssetRuntimeInvalidation', () => ({
  invalidateFireflyRemoteAssetRuntime: mocks.invalidateRuntime,
}));

import { useMediaStore } from '../../src/stores/mediaStore';
import type { MediaFile } from '../../src/stores/mediaStore/types';

function remoteVideo(revision: string): MediaFile {
  return {
    id: 'firefly-atlas-asset-video',
    name: 'remote.mp4',
    type: 'video',
    parentId: null,
    createdAt: 1,
    file: new File(['old'], 'remote.mp4', { type: 'video/mp4' }),
    url: 'blob:old-source',
    remoteSourcePath: '/api/atlas/project-assets/asset-video/media',
    fireflyProjectAssetId: 'asset-video',
    remoteCacheStatus: 'ready',
    remoteCacheProgress: 100,
    localMediaDescriptor: {
      cacheKey: 'asset-video', revision, variant: 'preview', mediaType: 'video',
      contentType: 'video/mp4', url: '/api/atlas/project-assets/asset-video/media', cachePolicy: 'pin',
    },
  };
}

describe('media store Firefly remote asset registration', () => {
  afterEach(() => {
    mocks.invalidateRuntime.mockClear();
    useMediaStore.setState({ files: [] });
  });

  it('invalidates the replaced runtime source after a revision change', () => {
    const existing = remoteVideo('v1');
    useMediaStore.setState({ files: [existing] });

    useMediaStore.getState().registerFireflyRemoteAsset({
      id: 'asset-video', name: 'remote.mp4', kind: 'video',
      mediaUrl: '/api/atlas/project-assets/asset-video/media',
      localMedia: {
        cacheKey: 'asset-video', revision: 'v2', variant: 'preview', mediaType: 'video',
        contentType: 'video/mp4', url: '/api/atlas/project-assets/asset-video/media', cachePolicy: 'pin',
      },
    });

    expect(useMediaStore.getState().files[0]).toEqual(expect.objectContaining({
      file: undefined,
      url: '/api/atlas/project-assets/asset-video/media',
      remoteCacheStatus: 'idle',
    }));
    expect(mocks.invalidateRuntime).toHaveBeenCalledOnce();
    expect(mocks.invalidateRuntime).toHaveBeenCalledWith(existing);
  });

  it('does not invalidate runtime caches for unchanged content metadata', () => {
    const existing = remoteVideo('v1');
    useMediaStore.setState({ files: [existing] });

    useMediaStore.getState().registerFireflyRemoteAsset({
      id: 'asset-video', name: 'remote.mp4', kind: 'video',
      mediaUrl: '/api/atlas/project-assets/asset-video/media',
      localMedia: { ...existing.localMediaDescriptor! },
    });

    expect(mocks.invalidateRuntime).not.toHaveBeenCalled();
  });
});
