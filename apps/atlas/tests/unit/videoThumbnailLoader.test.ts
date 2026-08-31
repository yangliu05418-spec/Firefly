import { afterEach, describe, expect, it, vi } from 'vitest';

const thumbnails = vi.hoisted(() => ({ generateForSourceUrl: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../../src/services/thumbnailCacheService', () => ({
  thumbnailCacheService: thumbnails,
}));

import { startVideoThumbnailGeneration } from '../../src/stores/timeline/clip/videoThumbnailLoader';
import { useMediaStore } from '../../src/stores/mediaStore';

describe('video thumbnail loader', () => {
  afterEach(() => {
    thumbnails.generateForSourceUrl.mockClear();
    useMediaStore.setState({ files: [] });
  });

  it('does not start remote extraction for a zero-byte timeline placeholder', async () => {
    useMediaStore.setState({
      files: [{
        id: 'media-remote',
        name: 'remote.mp4',
        type: 'video',
        parentId: null,
        createdAt: 1,
        url: '/api/atlas/project-assets/asset-1/media',
        remoteSourcePath: '/api/atlas/project-assets/asset-1/media',
        fireflyProjectAssetId: 'asset-1',
        remoteCacheStatus: 'downloading',
      }],
    });

    startVideoThumbnailGeneration(
      new File([], 'remote.mp4', { type: 'video/mp4' }),
      'media-remote',
      8,
    );
    await Promise.resolve();

    expect(thumbnails.generateForSourceUrl).not.toHaveBeenCalled();
  });

  it('starts per-second thumbnail generation for a materialized local video', async () => {
    const localFile = new File(['local-video-bytes'], 'local.mp4', { type: 'video/mp4' });
    useMediaStore.setState({
      files: [{
        id: 'media-local',
        name: 'local.mp4',
        type: 'video',
        parentId: null,
        createdAt: 1,
        file: localFile,
        url: 'blob:local-video',
        fileHash: 'local-hash',
        remoteCacheStatus: 'ready',
      }],
    });

    startVideoThumbnailGeneration(localFile, 'media-local', 8);

    await vi.waitFor(() => {
      expect(thumbnails.generateForSourceUrl).toHaveBeenCalledWith(
        'media-local',
        expect.stringMatching(/^blob:/),
        8,
        undefined,
        'anonymous',
      );
    });
  });
});
