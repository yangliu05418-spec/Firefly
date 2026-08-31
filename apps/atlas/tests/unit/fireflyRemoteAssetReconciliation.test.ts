import { describe, expect, it } from 'vitest';
import {
  hasFireflyRemoteAssetSourceChanged,
  reconcileFireflyRemoteAsset,
} from '../../src/stores/mediaStore/fireflyRemoteAssetReconciliation';
import type { MediaFile } from '../../src/stores/mediaStore/types';

function existingRemoteVideo(overrides: Partial<MediaFile> = {}): MediaFile {
  return {
    id: 'firefly-atlas-asset-video',
    name: 'Preview.mp4',
    type: 'video',
    parentId: null,
    createdAt: 1,
    url: '/api/atlas/project-assets/asset-video/media',
    remoteSourcePath: '/api/atlas/project-assets/asset-video/media',
    fireflyProjectAssetId: 'asset-video',
    ...overrides,
  };
}

describe('Firefly remote asset reconciliation', () => {
  it('returns the same object when periodic metadata is unchanged', () => {
    const descriptor = {
      cacheKey: 'asset-video', revision: 'v1', variant: 'preview' as const, mediaType: 'video' as const,
      contentType: 'video/mp4', size: 1024, url: '/api/atlas/project-assets/asset-video/media', cachePolicy: 'pin' as const,
    };
    const existing = existingRemoteVideo({ localMediaDescriptor: descriptor });
    const reconciled = reconcileFireflyRemoteAsset(existing, {
      id: 'asset-video',
      name: 'Preview.mp4',
      kind: 'video',
      mediaUrl: '/api/atlas/project-assets/asset-video/media',
      localMedia: { ...descriptor },
    });

    expect(reconciled).toBe(existing);
  });

  it('keeps a ready OPFS source while refreshing its recovery route', () => {
    const localFile = new File(['video-bytes'], 'remote.mp4', { type: 'video/mp4' });
    const existing = existingRemoteVideo({
      file: localFile,
      url: 'blob:opfs-ready',
      projectPath: 'media/remote.mp4',
      hasFileHandle: true,
      remoteCacheStatus: 'ready',
      remoteCacheProgress: 100,
    });

    const reconciled = reconcileFireflyRemoteAsset(existing, {
      id: 'asset-video',
      name: '雨夜追车.mp4',
      kind: 'video',
      mediaUrl: '/api/atlas/project-assets/asset-video/media?revision=2',
      duration: 8,
    });

    expect(reconciled).toEqual(expect.objectContaining({
      file: localFile,
      url: 'blob:opfs-ready',
      remoteSourcePath: '/api/atlas/project-assets/asset-video/media?revision=2',
      remoteCacheStatus: 'ready',
      remoteCacheProgress: 100,
    }));
  });

  it('preserves an OPFS source restored from the project before runtime cache state hydrates', () => {
    const localFile = new File(['video-bytes'], 'remote.mp4', { type: 'video/mp4' });
    const existing = existingRemoteVideo({
      file: localFile,
      url: 'blob:restored-opfs-source',
      projectPath: 'media/remote.mp4',
      hasFileHandle: true,
      remoteCacheStatus: undefined,
      remoteCacheProgress: undefined,
    });

    const reconciled = reconcileFireflyRemoteAsset(existing, {
      id: 'asset-video',
      name: '雨夜追车.mp4',
      kind: 'video',
      mediaUrl: '/api/atlas/project-assets/asset-video/media',
      duration: 8,
    });

    expect(reconciled).toEqual(expect.objectContaining({
      file: localFile,
      url: 'blob:restored-opfs-source',
      remoteCacheStatus: 'ready',
      remoteCacheProgress: 100,
    }));
  });

  it('invalidates a materialized source when the content revision changes', () => {
    const existing = existingRemoteVideo({
      file: new File(['old'], 'remote.mp4', { type: 'video/mp4' }),
      url: 'blob:old-revision',
      projectPath: 'media/remote.mp4',
      hasFileHandle: true,
      remoteCacheStatus: 'ready',
      remoteCacheProgress: 100,
      localMediaDescriptor: {
        cacheKey: 'asset-video', revision: 'v1', variant: 'preview', mediaType: 'video',
        contentType: 'video/mp4', url: '/api/atlas/project-assets/asset-video/media', cachePolicy: 'pin',
      },
      thumbnailUrl: 'blob:old-poster',
      fileHash: 'old-file-hash',
      proxyVideoUrl: 'blob:old-video-proxy',
      proxyStatus: 'ready',
      proxyProgress: 100,
      audioProxyUrl: 'blob:old-audio-proxy',
      audioProxyStorageKey: 'old-audio-proxy-key',
      audioProxyStatus: 'ready',
      audioProxyProgress: 100,
      hasProxyAudio: true,
    });

    const reconciled = reconcileFireflyRemoteAsset(existing, {
      id: 'asset-video', name: 'remote.mp4', kind: 'video',
      mediaUrl: '/api/atlas/project-assets/asset-video/media',
      localMedia: {
        cacheKey: 'asset-video', revision: 'v2', variant: 'preview', mediaType: 'video',
        contentType: 'video/mp4', url: '/api/atlas/project-assets/asset-video/media', cachePolicy: 'pin',
      },
    });

    expect(reconciled).toEqual(expect.objectContaining({
      file: undefined,
      url: '/api/atlas/project-assets/asset-video/media',
      projectPath: undefined,
      hasFileHandle: false,
      remoteCacheStatus: 'idle',
      remoteCacheProgress: 0,
      thumbnailUrl: undefined,
      fileHash: undefined,
      proxyVideoUrl: undefined,
      proxyStatus: 'none',
      proxyProgress: 0,
      audioProxyUrl: undefined,
      audioProxyStorageKey: undefined,
      audioProxyStatus: 'none',
      audioProxyProgress: 0,
      hasProxyAudio: false,
    }));
  });

  it('detects both cache key and revision changes but ignores a signed URL refresh', () => {
    const existing = existingRemoteVideo({
      localMediaDescriptor: {
        cacheKey: 'stable-key', revision: 'v1', variant: 'preview', mediaType: 'video',
        contentType: 'video/mp4', url: '/api/media?token=old', cachePolicy: 'pin',
      },
    });

    expect(hasFireflyRemoteAssetSourceChanged(existing, {
      id: 'asset-video', name: 'remote.mp4', kind: 'video', mediaUrl: '/api/media?token=new',
      localMedia: {
        cacheKey: 'stable-key', revision: 'v1', variant: 'preview', mediaType: 'video',
        contentType: 'video/mp4', url: '/api/media?token=new', cachePolicy: 'pin',
      },
    })).toBe(false);

    expect(hasFireflyRemoteAssetSourceChanged(existing, {
      id: 'asset-video', name: 'remote.mp4', kind: 'video', mediaUrl: '/api/media',
      localMedia: {
        cacheKey: 'replacement-key', revision: 'v1', variant: 'preview', mediaType: 'video',
        contentType: 'video/mp4', url: '/api/media', cachePolicy: 'pin',
      },
    })).toBe(true);

    expect(hasFireflyRemoteAssetSourceChanged(existing, {
      id: 'asset-video', name: 'remote.mp4', kind: 'video', mediaUrl: '/api/media',
      localMedia: {
        cacheKey: 'stable-key', revision: 'v2', variant: 'preview', mediaType: 'video',
        contentType: 'video/mp4', url: '/api/media', cachePolicy: 'pin',
      },
    })).toBe(true);
  });
});
