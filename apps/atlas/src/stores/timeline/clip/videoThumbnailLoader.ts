import { useMediaStore } from '../../mediaStore';

export function startVideoThumbnailGeneration(file: File, mediaFileId: string, naturalDuration: number): void {
  // Firefly remote assets use a zero-byte File only to admit the clip without
  // waiting for OPFS. Sampling that placeholder starts a competing remote
  // extraction and can permanently win the cache race. The OPFS materializer
  // explicitly starts generation once the real local File is ready.
  if (file.size <= 0) return;
  import('../../../services/thumbnailCacheService').then(({ thumbnailCacheService }) => {
    const mediaFile = useMediaStore.getState().files.find(f => f.id === mediaFileId);
    const sourceUrl = mediaFile?.url || URL.createObjectURL(file);
    const shouldRevokeSourceUrl = !mediaFile?.url;
    const fileHash = mediaFile?.fileHash;
    thumbnailCacheService
      .generateForSourceUrl(mediaFileId, sourceUrl, naturalDuration, fileHash, 'anonymous')
      .finally(() => {
        if (shouldRevokeSourceUrl) {
          URL.revokeObjectURL(sourceUrl);
        }
      });
  });
}
