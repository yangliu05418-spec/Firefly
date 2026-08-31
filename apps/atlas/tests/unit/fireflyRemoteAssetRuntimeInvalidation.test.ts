import { describe, expect, it, vi } from 'vitest';

import { invalidateFireflyRemoteAssetRuntime } from '../../src/services/project/fireflyRemoteAssetRuntimeInvalidation';
import type { MediaFile } from '../../src/stores/mediaStore/types';

describe('Firefly remote asset runtime invalidation', () => {
  it('revokes object URLs and clears decoded and persisted thumbnail state', async () => {
    const file: MediaFile = {
      id: 'firefly-atlas-asset-video',
      name: 'remote.mp4',
      type: 'video',
      parentId: null,
      createdAt: 1,
      url: 'blob:old-source',
      thumbnailUrl: 'blob:old-poster',
    };
    const deps = {
      revokeObjectUrls: vi.fn(),
      closeThumbnailBitmaps: vi.fn(),
      clearSourceThumbnails: vi.fn().mockResolvedValue(undefined),
    };

    await invalidateFireflyRemoteAssetRuntime(file, deps);

    expect(deps.revokeObjectUrls).toHaveBeenCalledWith(file);
    expect(deps.closeThumbnailBitmaps).toHaveBeenCalledWith(file.id);
    expect(deps.clearSourceThumbnails).toHaveBeenCalledWith(file.id);
  });
});
