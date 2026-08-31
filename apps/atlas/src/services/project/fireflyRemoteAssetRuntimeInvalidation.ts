import type { MediaFile } from '../../stores/mediaStore/types';
import { thumbnailCacheService } from '../thumbnailCacheService';
import { closeSource as closeThumbnailBitmapSource } from '../timeline/thumbnailBitmapCache';
import { revokeMediaFileObjectUrls } from './mediaObjectUrlManager';

export interface FireflyRemoteAssetRuntimeInvalidationDeps {
  revokeObjectUrls: (file: MediaFile) => void;
  closeThumbnailBitmaps: (mediaFileId: string) => void;
  clearSourceThumbnails: (mediaFileId: string) => Promise<void>;
}

const defaultDeps: FireflyRemoteAssetRuntimeInvalidationDeps = {
  revokeObjectUrls: (file) => {
    revokeMediaFileObjectUrls(file);
  },
  closeThumbnailBitmaps: (mediaFileId) => {
    closeThumbnailBitmapSource(mediaFileId);
  },
  clearSourceThumbnails: (mediaFileId) => thumbnailCacheService.clearSource(mediaFileId),
};

/** Release runtime resources that were derived from a replaced cloud object. */
export async function invalidateFireflyRemoteAssetRuntime(
  file: MediaFile,
  deps: FireflyRemoteAssetRuntimeInvalidationDeps = defaultDeps,
): Promise<void> {
  deps.revokeObjectUrls(file);
  deps.closeThumbnailBitmaps(file.id);
  await deps.clearSourceThumbnails(file.id);
}
