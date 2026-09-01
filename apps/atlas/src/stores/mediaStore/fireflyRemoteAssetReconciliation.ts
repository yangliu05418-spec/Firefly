import type { LocalMediaDescriptor } from '../../firefly/local-media';
import type { MediaFile } from './types';

export interface FireflyRemoteAssetRegistration {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'audio';
  mediaUrl: string;
  size?: number;
  thumbnailUrl?: string;
  duration?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  localMedia?: LocalMediaDescriptor;
}

function sameLocalMediaDescriptor(
  left: LocalMediaDescriptor | undefined,
  right: LocalMediaDescriptor | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.cacheKey === right.cacheKey
    && left.revision === right.revision
    && left.variant === right.variant
    && left.mediaType === right.mediaType
    && left.contentType === right.contentType
    && left.size === right.size
    && left.url === right.url
    && left.cachePolicy === right.cachePolicy;
}

export function hasFireflyRemoteAssetSourceChanged(
  existing: MediaFile,
  asset: FireflyRemoteAssetRegistration,
): boolean {
  return Boolean(
    existing.localMediaDescriptor
    && asset.localMedia
    && (
      existing.localMediaDescriptor.cacheKey !== asset.localMedia.cacheKey
      || existing.localMediaDescriptor.revision !== asset.localMedia.revision
    )
  );
}

/**
 * Reconcile cloud metadata without replacing an already-materialized OPFS
 * source. The remote route remains current in remoteSourcePath and can still be
 * used for recovery; url keeps pointing at the fast local File for editing.
 */
export function reconcileFireflyRemoteAsset(
  existing: MediaFile,
  asset: FireflyRemoteAssetRegistration,
): MediaFile {
  const legacyGeneratedName = /^(?:preview|result|output)(?:[-_.]|$)/i.test(existing.name.trim());
  const sourceRevisionChanged = hasFireflyRemoteAssetSourceChanged(existing, asset);
  const hasMaterializedSource = Boolean(
    existing.file
    && existing.file.size > 0
    && existing.url.startsWith('blob:')
  );
  const keepMaterializedSource = Boolean(
    !sourceRevisionChanged
    && hasMaterializedSource
  );
  const nextLocalMediaDescriptor = sameLocalMediaDescriptor(
    existing.localMediaDescriptor,
    asset.localMedia,
  )
    ? existing.localMediaDescriptor
    : asset.localMedia ?? existing.localMediaDescriptor;

  const next: MediaFile = {
    ...existing,
    name: legacyGeneratedName && asset.name ? asset.name : existing.name,
    file: sourceRevisionChanged ? undefined : existing.file,
    url: keepMaterializedSource ? existing.url : asset.mediaUrl,
    remoteSourcePath: asset.mediaUrl,
    localMediaDescriptor: nextLocalMediaDescriptor,
    fileSize: asset.size ?? existing.fileSize,
    thumbnailUrl: asset.thumbnailUrl ?? (sourceRevisionChanged ? undefined : existing.thumbnailUrl),
    duration: asset.duration ?? existing.duration,
    width: asset.width ?? existing.width,
    height: asset.height ?? existing.height,
    hasAudio: asset.hasAudio ?? existing.hasAudio,
    remoteCacheStatus: sourceRevisionChanged
      ? 'idle'
      : hasMaterializedSource ? 'ready' : existing.remoteCacheStatus,
    remoteCacheProgress: sourceRevisionChanged
      ? 0
      : hasMaterializedSource ? 100 : existing.remoteCacheProgress,
    projectPath: sourceRevisionChanged ? undefined : existing.projectPath,
    hasFileHandle: sourceRevisionChanged ? false : existing.hasFileHandle,
    fileHash: sourceRevisionChanged ? undefined : existing.fileHash,
    proxyVideoUrl: sourceRevisionChanged ? undefined : existing.proxyVideoUrl,
    proxyStatus: sourceRevisionChanged ? 'none' : existing.proxyStatus,
    proxyProgress: sourceRevisionChanged ? 0 : existing.proxyProgress,
    audioProxyUrl: sourceRevisionChanged ? undefined : existing.audioProxyUrl,
    audioProxyStorageKey: sourceRevisionChanged ? undefined : existing.audioProxyStorageKey,
    audioProxyStatus: sourceRevisionChanged ? 'none' : existing.audioProxyStatus,
    audioProxyProgress: sourceRevisionChanged ? 0 : existing.audioProxyProgress,
    hasProxyAudio: sourceRevisionChanged ? false : existing.hasProxyAudio,
  };

  const changed = (Object.keys(next) as Array<keyof MediaFile>)
    .some((key) => next[key] !== existing[key]);
  return changed ? next : existing;
}
