import { useMediaStore } from '../../mediaStore';

export function startVideoThumbnailGeneration(file: File, mediaFileId: string, naturalDuration: number): void {
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
