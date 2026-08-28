// Proxy frame cache map operations: keyed lookup, nearest-frame search,
// LRU insertion/eviction with runtime admission, clears, and cached ranges.

import { Logger } from '../logger';
import type { CachedFrame, CachedVideoFrame } from './frameCacheModels';
import {
  canRetainLegacyFrame,
  canRetainVideoFrame,
  logRuntimeAdmissionSkip,
  refreshLegacyFrameCacheResource,
  refreshVideoFrameCacheResource,
  releaseLegacyFrameCacheResource,
  releaseVideoFrameCacheResource,
} from './frameCacheRuntime';

const log = Logger.create('ProxyFrameCache');

// Cache settings - tuned for fast scrubbing
export const MAX_LEGACY_FRAME_CACHE_SIZE = 900; // 30 seconds at 30fps - larger cache for scrubbing
const MAX_VIDEO_FRAME_CACHE_SIZE = 120;

export function getProxyFrameCacheKey(mediaFileId: string, frameIndex: number): string {
  return `${mediaFileId}_${frameIndex}`;
}

interface TimestampedFrameEntry {
  frameIndex: number;
  timestamp: number;
}

export interface FrameCacheHitStats {
  hits: number;
  misses: number;
}

// Look up a cached entry and refresh its LRU timestamp.
export function touchCachedEntry<T extends { timestamp: number }>(
  map: Map<string, T>,
  key: string,
): T | null {
  const cached = map.get(key);
  if (cached) {
    cached.timestamp = Date.now(); // Update for LRU
  }
  return cached ?? null;
}

// Same as touchCachedEntry, but also tracks hit/miss counters.
export function lookupCachedEntry<T extends { timestamp: number }>(
  map: Map<string, T>,
  key: string,
  stats: FrameCacheHitStats,
): T | null {
  const cached = touchCachedEntry(map, key);
  if (cached) {
    stats.hits++;
  } else {
    stats.misses++;
  }
  return cached;
}

// Find the closest cached frame entry within maxDistance frames.
// Searches in scrub direction first for visual continuity while scrubbing.
export function findNearestCachedEntry<T extends TimestampedFrameEntry>(
  map: Map<string, T>,
  mediaFileId: string,
  frameIndex: number,
  maxDistance: number,
  searchForward: boolean,
): T | null {
  const exact = map.get(getProxyFrameCacheKey(mediaFileId, frameIndex));
  if (exact) {
    exact.timestamp = Date.now();
    return exact;
  }

  for (let d = 1; d <= maxDistance; d++) {
    // Search primary direction first
    const primaryFrame = frameIndex + (searchForward ? d : -d);
    if (primaryFrame >= 0) {
      const primary = map.get(getProxyFrameCacheKey(mediaFileId, primaryFrame));
      if (primary) {
        primary.timestamp = Date.now();
        return primary;
      }
    }

    // Then search opposite direction
    const secondaryFrame = frameIndex + (searchForward ? -d : d);
    if (secondaryFrame >= 0) {
      const secondary = map.get(getProxyFrameCacheKey(mediaFileId, secondaryFrame));
      if (secondary) {
        secondary.timestamp = Date.now();
        return secondary;
      }
    }
  }

  return null;
}

function findOldestCacheKey<T extends { timestamp: number }>(map: ReadonlyMap<string, T>): string | null {
  let oldestKey: string | null = null;
  let oldestTime = Infinity;
  for (const [key, entry] of map) {
    if (entry.timestamp < oldestTime) {
      oldestTime = entry.timestamp;
      oldestKey = key;
    }
  }
  return oldestKey;
}

// Resolve a value through a shared loading-promise map so concurrent callers
// for the same key reuse one in-flight load.
export async function resolveWithLoadingMap<T>(
  loadingPromises: Map<string, Promise<T | null>>,
  key: string,
  load: () => Promise<T | null>,
  onLoaded: (value: T) => T | null,
): Promise<T | null> {
  const existing = loadingPromises.get(key);
  if (existing) return existing;

  const promise = load();
  loadingPromises.set(key, promise);
  try {
    const value = await promise;
    return value ? onLoaded(value) : value;
  } finally {
    loadingPromises.delete(key);
  }
}

// --- Legacy JPEG proxy frame cache ---

export function addLegacyFrameToCache(
  cache: Map<string, CachedFrame>,
  mediaFileId: string,
  frameIndex: number,
  image: HTMLImageElement,
): boolean {
  const key = getProxyFrameCacheKey(mediaFileId, frameIndex);
  const entry: CachedFrame = {
    mediaFileId,
    frameIndex,
    image,
    timestamp: Date.now(),
  };

  // Evict old frames if cache is full
  if (!cache.has(key) && cache.size >= MAX_LEGACY_FRAME_CACHE_SIZE) {
    evictOldestLegacyFrame(cache);
  }

  const admission = canRetainLegacyFrame(cache, mediaFileId, key, entry);
  if (!admission.admitted) {
    logRuntimeAdmissionSkip('Skipped proxy frame cache retention due to runtime budget', {
      mediaFileId,
      frameIndex,
    }, admission);
    return false;
  }

  cache.set(key, entry);
  refreshLegacyFrameCacheResource(cache, mediaFileId);
  return true;
}

export function evictOldestLegacyFrame(cache: Map<string, CachedFrame>): void {
  const oldestKey = findOldestCacheKey(cache);
  if (!oldestKey) return;
  const oldest = cache.get(oldestKey);
  cache.delete(oldestKey);
  if (oldest) {
    refreshLegacyFrameCacheResource(cache, oldest.mediaFileId);
  }
}

// --- Proxy WebCodecs VideoFrame cache ---

export function addVideoFrameToCacheMap(
  videoFrameCache: Map<string, CachedVideoFrame>,
  mediaFileId: string,
  frameIndex: number,
  frame: VideoFrame,
): boolean {
  const key = getProxyFrameCacheKey(mediaFileId, frameIndex);
  const entry: CachedVideoFrame = {
    mediaFileId,
    frameIndex,
    frame,
    timestamp: Date.now(),
  };

  while (!videoFrameCache.has(key) && videoFrameCache.size >= MAX_VIDEO_FRAME_CACHE_SIZE) {
    evictOldestVideoFrameFromMap(videoFrameCache);
  }

  const admission = canRetainVideoFrame(videoFrameCache, mediaFileId, key, entry);
  if (!admission.admitted) {
    logRuntimeAdmissionSkip('Skipped proxy video frame cache retention due to runtime budget', {
      mediaFileId,
      frameIndex,
    }, admission);
    frame.close();
    return false;
  }

  const existing = videoFrameCache.get(key);
  if (existing && existing.frame !== frame) {
    existing.frame.close();
  }

  videoFrameCache.set(key, entry);
  refreshVideoFrameCacheResource(videoFrameCache, mediaFileId);
  return true;
}

export function evictOldestVideoFrameFromMap(videoFrameCache: Map<string, CachedVideoFrame>): void {
  const oldestKey = findOldestCacheKey(videoFrameCache);
  if (!oldestKey) return;
  const oldest = videoFrameCache.get(oldestKey);
  oldest?.frame.close();
  videoFrameCache.delete(oldestKey);
  if (oldest) {
    refreshVideoFrameCacheResource(videoFrameCache, oldest.mediaFileId);
  }
}

// --- Clears ---

export function clearFrameCachesForMedia(
  cache: Map<string, CachedFrame>,
  videoFrameCache: Map<string, CachedVideoFrame>,
  mediaFileId: string,
): void {
  for (const [key, entry] of cache) {
    if (entry.mediaFileId === mediaFileId) {
      cache.delete(key);
    }
  }
  releaseLegacyFrameCacheResource(mediaFileId);
  for (const [key, entry] of videoFrameCache) {
    if (entry.mediaFileId === mediaFileId) {
      entry.frame.close();
      videoFrameCache.delete(key);
    }
  }
  releaseVideoFrameCacheResource(mediaFileId);
}

export function clearAllFrameCaches(
  cache: Map<string, CachedFrame>,
  videoFrameCache: Map<string, CachedVideoFrame>,
): void {
  const legacyFrameMediaIds = new Set(Array.from(cache.values()).map((entry) => entry.mediaFileId));
  const videoFrameMediaIds = new Set(Array.from(videoFrameCache.values()).map((entry) => entry.mediaFileId));
  cache.clear();
  for (const mediaFileId of legacyFrameMediaIds) {
    releaseLegacyFrameCacheResource(mediaFileId);
  }
  for (const entry of videoFrameCache.values()) {
    entry.frame.close();
  }
  videoFrameCache.clear();
  for (const mediaFileId of videoFrameMediaIds) {
    releaseVideoFrameCacheResource(mediaFileId);
  }
}

// --- Cached range reporting (for timeline display) ---

// Returns cached ranges in seconds relative to media file start.
export function computeProxyCachedRanges(
  cache: ReadonlyMap<string, CachedFrame>,
  videoFrameCache: ReadonlyMap<string, CachedVideoFrame>,
  mediaFileId: string,
  fps: number,
): Array<{ start: number; end: number }> {
  // Collect all cached frame indices for this media file
  const cachedFrames: number[] = [];
  for (const [, entry] of cache) {
    if (entry.mediaFileId === mediaFileId) {
      cachedFrames.push(entry.frameIndex);
    }
  }
  for (const [, entry] of videoFrameCache) {
    if (entry.mediaFileId === mediaFileId) {
      cachedFrames.push(entry.frameIndex);
    }
  }

  if (cachedFrames.length === 0) return [];

  // Sort frames
  cachedFrames.sort((a, b) => a - b);

  // Convert to time ranges, merging adjacent frames
  const ranges: Array<{ start: number; end: number }> = [];
  const frameInterval = 1 / fps;
  const maxGap = frameInterval * 3; // Allow gap of 3 frames before starting new range

  let rangeStart = cachedFrames[0] / fps;
  let rangeEnd = rangeStart + frameInterval;

  for (let i = 1; i < cachedFrames.length; i++) {
    const frameTime = cachedFrames[i] / fps;
    if (frameTime - rangeEnd <= maxGap) {
      // Extend current range
      rangeEnd = frameTime + frameInterval;
    } else {
      // Save current range and start new one
      ranges.push({ start: rangeStart, end: rangeEnd });
      rangeStart = frameTime;
      rangeEnd = frameTime + frameInterval;
    }
  }

  // Add final range
  ranges.push({ start: rangeStart, end: rangeEnd });

  return ranges;
}

export function collectCachedMediaIds(cache: ReadonlyMap<string, CachedFrame>): string[] {
  const ids = new Set<string>();
  for (const entry of cache.values()) {
    ids.add(entry.mediaFileId);
  }
  return Array.from(ids);
}

export function logFrameCachePerformance(stats: FrameCacheHitStats & {
  cachedFrames: number;
  preloadQueueSize: number;
}): void {
  const total = stats.hits + stats.misses;
  const hitRate = total > 0 ? (stats.hits / total * 100).toFixed(1) : '0';
  log.debug(`Hit rate: ${hitRate}% (${stats.hits}/${total}), cached: ${stats.cachedFrames}/${MAX_LEGACY_FRAME_CACHE_SIZE}, queue: ${stats.preloadQueueSize}`);
}
