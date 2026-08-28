// Proxy storage source resolution: project-folder proxy frame blobs and
// parsed proxy video sources (cached per media file via a shared promise map).

import { Logger } from '../logger';
import { projectFileService } from '../projectFileService';
import { useMediaStore } from '../../stores/mediaStore';
import {
  decodeProxyVideoFrameFromSource,
  parseProxyVideoFile,
  type ProxyVideoSourceState,
} from './proxyVideoParser';

const log = Logger.create('ProxyFrameCache');

export type ProxyVideoSourcePromises = Map<string, Promise<ProxyVideoSourceState | null>>;

// Load a single proxy frame blob - ONLY from project folder (no browser cache)
export async function fetchProxyFrameBlob(mediaFileId: string, frameIndex: number): Promise<Blob | null> {
  // Get the media file to find its fileHash (used for proxy folder naming)
  const mediaFile = useMediaStore.getState().files.find(f => f.id === mediaFileId);
  const storageKey = mediaFile?.fileHash || mediaFileId;

  // Debug logging
  if (frameIndex === 0) {
    log.debug(`Loading frame 0 for: ${mediaFile?.name}`);
    log.debug(`storageKey: ${storageKey}, projectOpen: ${projectFileService.isProjectOpen()}, proxyStatus: ${mediaFile?.proxyStatus}`);
  }

  // Load from project folder ONLY (no IndexedDB fallback)
  if (!projectFileService.isProjectOpen()) {
    return null;
  }
  const blob = await projectFileService.getProxyFrame(storageKey, frameIndex);
  if (frameIndex === 0) {
    log.debug(`Frame 0 blob: ${blob ? `${blob.size} bytes` : 'null'}`);
  }
  return blob;
}

export async function resolveProxyVideoSource(
  promises: ProxyVideoSourcePromises,
  mediaFileId: string,
): Promise<ProxyVideoSourceState | null> {
  const existing = promises.get(mediaFileId);
  if (existing) return existing;

  const promise = (async () => {
    const mediaFile = useMediaStore.getState().files.find(f => f.id === mediaFileId);
    const storageKey = mediaFile?.fileHash || mediaFileId;
    if (!projectFileService.isProjectOpen()) return null;

    const proxyVideo = await projectFileService.getProxyVideo(storageKey);
    if (!proxyVideo) return null;

    return parseProxyVideoFile(mediaFileId, storageKey, proxyVideo, log);
  })();

  promises.set(mediaFileId, promise);
  return promise;
}

export async function decodeProxyVideoFrame(
  promises: ProxyVideoSourcePromises,
  mediaFileId: string,
  frameIndex: number,
): Promise<VideoFrame | null> {
  const source = await resolveProxyVideoSource(promises, mediaFileId);
  if (!source || source.samples.length === 0) return null;
  return decodeProxyVideoFrameFromSource(source, frameIndex, log);
}
