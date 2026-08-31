import {
  canRetainThumbnailJob,
  createThumbnailBitmapResourceDescriptor,
  getThumbnailBitmapDecodeJobId,
  getThumbnailBitmapResourceId,
  releaseThumbnailRuntimeResource,
  reportThumbnailBitmapDecodeJob,
  reportThumbnailBitmapResource,
} from './thumbnailRuntimeReporting';
import { timelineRuntimeCoordinator } from './timelineRuntimeCoordinator';
import { Logger } from '../logger';

// Decoded ImageBitmap cache for timeline thumbnails.
//
// thumbnailCacheService owns blob URLs for source thumbnails. Canvas renderers
// need decoded ImageBitmaps, but those decoded resources must be closed when
// source thumbnails are evicted or the media source is deleted.

const MAX_BITMAPS = 600;
const log = Logger.create('TimelineThumbnailBitmapCache');

const cache = new Map<string, ImageBitmap>(); // insertion order = LRU order
const inflight = new Set<string>();
const invalidatedUrls = new Set<string>();
const sourceUrls = new Map<string, Set<string>>();
const urlSources = new Map<string, Set<string>>();
const sourceBlobs = new Map<string, Blob>();

export function getThumbnailBitmap(url: string): ImageBitmap | null {
  const bmp = cache.get(url);
  if (bmp) {
    cache.delete(url);
    cache.set(url, bmp);
    return bmp;
  }
  return null;
}

export function hasThumbnailBitmap(url: string): boolean {
  return cache.has(url);
}

export function ensureThumbnailBitmap(
  url: string,
  onReady: () => void,
  mediaFileId?: string,
): void {
  registerThumbnailBitmapSource(url, mediaFileId);
  if (cache.has(url) || inflight.has(url) || invalidatedUrls.has(url)) return;

  const jobId = getThumbnailBitmapDecodeJobId(url);
  const jobAdmission = canRetainThumbnailJob({
    jobId,
    jobKind: 'thumbnail-bitmap-decode',
    mediaFileId,
    thumbnailUrl: url,
  });
  if (!jobAdmission.admitted) {
    unlinkUrl(url);
    return;
  }

  const resource = createThumbnailBitmapResourceDescriptor(url, mediaFileId);
  const bitmapAdmission = timelineRuntimeCoordinator.canRetainResource(resource);
  if (!bitmapAdmission.admitted) {
    unlinkUrl(url);
    return;
  }

  inflight.add(url);
  reportThumbnailBitmapDecodeJob(url, mediaFileId);
  const registeredBlob = sourceBlobs.get(url);
  const blobPromise = registeredBlob
    ? Promise.resolve(registeredBlob)
    : fetch(url).then((response) => {
        if (response.ok === false) {
          throw new Error(`THUMBNAIL_HTTP_${response.status}`);
        }
        const contentType = response.headers?.get('content-type') ?? '';
        if (contentType && !contentType.toLowerCase().startsWith('image/')) {
          throw new Error('THUMBNAIL_INVALID_CONTENT_TYPE');
        }
        return response.blob();
      });

  blobPromise
    .then((blob) => createImageBitmap(blob))
    .then((bmp) => {
      inflight.delete(url);
      releaseThumbnailRuntimeResource(getThumbnailBitmapDecodeJobId(url));
      if (invalidatedUrls.has(url)) {
        invalidatedUrls.delete(url);
        bmp.close();
        return;
      }

      const admission = timelineRuntimeCoordinator.canRetainResource(resource);
      if (!admission.admitted) {
        bmp.close();
        unlinkUrl(url);
        return;
      }

      cache.set(url, bmp);
      reportThumbnailBitmapResource(url, mediaFileId);
      enforceBitmapLimit();
      onReady();
    })
    .catch((error) => {
      inflight.delete(url);
      releaseThumbnailRuntimeResource(getThumbnailBitmapDecodeJobId(url));
      log.warn('Timeline thumbnail bitmap decode failed', {
        mediaFileId,
        sourceKind: registeredBlob ? 'registered-blob' : 'fetch',
        errorCode: error instanceof Error ? error.message : 'THUMBNAIL_DECODE_FAILED',
      });
    });
}

/**
 * Registers an already-owned generated frame without fetching its object URL.
 * Blob URLs are intentionally not part of Atlas' connect-src policy; decoding
 * the original Blob is also faster and avoids a duplicate browser copy.
 */
export function registerThumbnailBitmapBlob(
  url: string,
  blob: Blob,
  mediaFileId: string | undefined,
): void {
  sourceBlobs.set(url, blob);
  registerThumbnailBitmapSource(url, mediaFileId);
}

export function registerThumbnailBitmapSource(
  url: string,
  mediaFileId: string | undefined,
): void {
  if (!mediaFileId) return;

  let urls = sourceUrls.get(mediaFileId);
  if (!urls) {
    urls = new Set();
    sourceUrls.set(mediaFileId, urls);
  }
  urls.add(url);

  let sources = urlSources.get(url);
  if (!sources) {
    sources = new Set();
    urlSources.set(url, sources);
  }
  sources.add(mediaFileId);
}

export function closeByThumbnailUrls(urls: Iterable<string>): void {
  for (const url of [...urls]) {
    if (inflight.has(url)) {
      invalidatedUrls.add(url);
      releaseThumbnailRuntimeResource(getThumbnailBitmapDecodeJobId(url));
    }
    inflight.delete(url);
    closeCachedUrl(url);
    unlinkUrl(url);
  }
}

export function closeSource(mediaFileId: string): void {
  const urls = sourceUrls.get(mediaFileId);
  if (!urls) return;
  closeByThumbnailUrls([...urls]);
}

export function clearThumbnailBitmapCache(): void {
  closeByThumbnailUrls([...cache.keys()]);
  for (const url of inflight) {
    invalidatedUrls.add(url);
    releaseThumbnailRuntimeResource(getThumbnailBitmapDecodeJobId(url));
  }
  inflight.clear();
  sourceUrls.clear();
  urlSources.clear();
  sourceBlobs.clear();
}

export function getThumbnailBitmapCacheSize(): number {
  return cache.size;
}

function enforceBitmapLimit(): void {
  while (cache.size > MAX_BITMAPS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    closeCachedUrl(oldest);
    unlinkUrl(oldest);
  }
}

function closeCachedUrl(url: string): void {
  const bmp = cache.get(url);
  cache.delete(url);
  releaseThumbnailRuntimeResource(getThumbnailBitmapResourceId(url));
  bmp?.close();
}

function unlinkUrl(url: string): void {
  const sources = urlSources.get(url);
  if (sources) {
    for (const mediaFileId of sources) {
      const urls = sourceUrls.get(mediaFileId);
      urls?.delete(url);
      if (urls?.size === 0) {
        sourceUrls.delete(mediaFileId);
      }
    }
  }
  urlSources.delete(url);
  sourceBlobs.delete(url);
}
