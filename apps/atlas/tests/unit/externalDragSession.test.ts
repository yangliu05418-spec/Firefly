import { describe, expect, it } from 'vitest';

import {
  clearExternalDragPayload,
  createExternalDragPayloadForProjectItem,
  getExternalDragPayload,
  setExternalDragPayload,
} from '../../src/components/timeline/utils/externalDragSession';
import type { MediaFile } from '../../src/stores/mediaStore';

describe('externalDragSession', () => {
  it('stores and clears the current drag payload', () => {
    clearExternalDragPayload();

    setExternalDragPayload({
      kind: 'media-file',
      id: 'media-1',
      duration: 12.5,
      hasAudio: true,
      isAudio: false,
      isVideo: true,
    });

    expect(getExternalDragPayload()).toEqual({
      kind: 'media-file',
      id: 'media-1',
      duration: 12.5,
      hasAudio: true,
      isAudio: false,
      isVideo: true,
    });

    clearExternalDragPayload();

    expect(getExternalDragPayload()).toBeNull();
  });

  it('creates a timeline drag payload for a durable Firefly asset before OPFS materialization', () => {
    const remoteAsset = {
      id: 'remote-video-1',
      name: '海边日落.mp4',
      type: 'video',
      parentId: null,
      createdAt: 1,
      duration: 8,
      width: 1920,
      height: 1080,
      hasAudio: true,
      fireflyProjectAssetId: 'asset-1',
      remoteSourcePath: '/api/atlas/project-assets/asset-1/media',
      url: '/api/atlas/project-assets/asset-1/media',
      thumbnailUrl: '/api/generations/task-1/poster',
    } as MediaFile;

    expect(createExternalDragPayloadForProjectItem(remoteAsset)).toEqual({
      kind: 'media-file',
      id: 'remote-video-1',
      duration: 8,
      hasAudio: true,
      isAudio: false,
      isVideo: true,
      label: '海边日落.mp4',
      mediaType: 'video',
      thumbnailUrl: '/api/generations/task-1/poster',
      file: undefined,
    });
  });
});
