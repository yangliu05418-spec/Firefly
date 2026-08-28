const PRELOAD_AHEAD_FRAMES = 60; // 2 seconds ahead for playback
const PRELOAD_BEHIND_FRAMES = 30; // 1 second behind for reverse scrubbing
const PARALLEL_LOAD_COUNT = 16; // More parallel loads for faster preload
export const SCRUB_PRELOAD_RANGE = 90; // 3 seconds around scrub position
const SCRUB_TELEPORT_SECONDS = 2; // Large jumps should abandon stale queued scrub preloads

export interface ProxyFramePreloadState {
  preloadQueue: string[];
  isPreloading: boolean;
  lastScrubFrame: number;
  scrubDirection: number;
  isScrubbing: boolean;
  scrubPreloadQueueDrops: number;
}

export function createProxyFramePreloadState(): ProxyFramePreloadState {
  return {
    preloadQueue: [],
    isPreloading: false,
    lastScrubFrame: -1,
    scrubDirection: 0,
    isScrubbing: false,
    scrubPreloadQueueDrops: 0,
  };
}

export function removeQueuedPreloadsForMedia(
  preloadQueue: string[],
  mediaFileId: string,
): { preloadQueue: string[]; dropped: number } {
  const prefix = `${mediaFileId}_`;
  const before = preloadQueue.length;
  const nextQueue = preloadQueue.filter((key) => !key.startsWith(prefix));
  return {
    preloadQueue: nextQueue,
    dropped: before - nextQueue.length,
  };
}

export function parsePreloadKey(key: string): { mediaFileId: string; frameIndex: number } | null {
  const separatorIndex = key.lastIndexOf('_');
  if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
    return null;
  }

  const frameIndex = Number.parseInt(key.slice(separatorIndex + 1), 10);
  if (!Number.isFinite(frameIndex)) {
    return null;
  }

  return {
    mediaFileId: key.slice(0, separatorIndex),
    frameIndex,
  };
}

export function scheduleProxyFramePreload(args: {
  state: ProxyFramePreloadState;
  mediaFileId: string;
  currentFrameIndex: number;
  fps: number;
  getKey: (mediaFileId: string, frameIndex: number) => string;
  hasCachedFrame: (key: string) => boolean;
  startPreloading: () => void;
}): void {
  const { state, mediaFileId, currentFrameIndex, fps, getKey, hasCachedFrame, startPreloading } = args;

  // Detect scrub direction
  if (state.lastScrubFrame >= 0) {
    const delta = currentFrameIndex - state.lastScrubFrame;
    const teleportThresholdFrames = Math.max(
      SCRUB_PRELOAD_RANGE,
      Math.floor(Math.max(1, fps) * SCRUB_TELEPORT_SECONDS)
    );
    if (Math.abs(delta) >= teleportThresholdFrames) {
      const result = removeQueuedPreloadsForMedia(state.preloadQueue, mediaFileId);
      state.preloadQueue = result.preloadQueue;
      if (result.dropped > 0) {
        state.scrubPreloadQueueDrops += result.dropped;
      }
      state.scrubDirection = delta > 0 ? 1 : -1;
      state.isScrubbing = true;
    } else if (Math.abs(delta) > 0) {
      state.scrubDirection = delta > 0 ? 1 : -1;
      state.isScrubbing = true;
    }
  }
  state.lastScrubFrame = currentFrameIndex;

  // Calculate preload range based on scrubbing state
  const preloadAhead = state.isScrubbing ? SCRUB_PRELOAD_RANGE : PRELOAD_AHEAD_FRAMES;
  const preloadBehind = state.isScrubbing ? SCRUB_PRELOAD_RANGE : PRELOAD_BEHIND_FRAMES;

  // Priority queue: current frame first, then direction-based loading
  const framesToPreload: number[] = [currentFrameIndex];

  // Add frames in scrub direction first (higher priority)
  if (state.scrubDirection >= 0) {
    // Forward or stopped: prioritize ahead
    for (let i = 1; i <= preloadAhead; i++) {
      framesToPreload.push(currentFrameIndex + i);
    }
    for (let i = 1; i <= preloadBehind; i++) {
      if (currentFrameIndex - i >= 0) {
        framesToPreload.push(currentFrameIndex - i);
      }
    }
  } else {
    // Backward scrubbing: prioritize behind
    for (let i = 1; i <= preloadBehind; i++) {
      if (currentFrameIndex - i >= 0) {
        framesToPreload.push(currentFrameIndex - i);
      }
    }
    for (let i = 1; i <= preloadAhead; i++) {
      framesToPreload.push(currentFrameIndex + i);
    }
  }

  // Add to preload queue
  for (let i = 0; i < framesToPreload.length; i++) {
    const frameIndex = framesToPreload[i];
    if (frameIndex < 0) continue;

    const key = getKey(mediaFileId, frameIndex);

    // Skip if already cached or in queue
    if (!hasCachedFrame(key) && !state.preloadQueue.includes(key)) {
      // Insert current frame at front of queue for priority loading
      if (i === 0) {
        state.preloadQueue.unshift(key);
      } else {
        state.preloadQueue.push(key);
      }
    }
  }

  // Start preloading if not already
  if (!state.isPreloading) {
    startPreloading();
  }
}

export function updateProxyFrameScrubDirection(
  state: ProxyFramePreloadState,
  currentFrameIndex: number,
): void {
  if (state.lastScrubFrame >= 0) {
    const delta = currentFrameIndex - state.lastScrubFrame;
    if (Math.abs(delta) > 0) {
      state.scrubDirection = delta > 0 ? 1 : -1;
      state.isScrubbing = true;
    }
  }
  state.lastScrubFrame = currentFrameIndex;
}

export async function processProxyFramePreloadQueue(args: {
  state: ProxyFramePreloadState;
  hasCachedFrame: (key: string) => boolean;
  loadFrame: (mediaFileId: string, frameIndex: number) => Promise<HTMLImageElement | null>;
  addToCache: (mediaFileId: string, frameIndex: number, image: HTMLImageElement) => void;
}): Promise<void> {
  const { state, hasCachedFrame, loadFrame, addToCache } = args;
  state.isPreloading = true;

  while (state.preloadQueue.length > 0) {
    // Load multiple frames in parallel for faster preloading
    const batch: string[] = [];
    while (batch.length < PARALLEL_LOAD_COUNT && state.preloadQueue.length > 0) {
      const key = state.preloadQueue.shift();
      if (key && !hasCachedFrame(key)) {
        batch.push(key);
      }
    }

    if (batch.length === 0) continue;

    // Load batch in parallel
    const loadPromises = batch.map(async (key) => {
      const parsed = parsePreloadKey(key);
      if (!parsed) {
        return { key, success: false };
      }

      const image = await loadFrame(parsed.mediaFileId, parsed.frameIndex);
      if (image) {
        addToCache(parsed.mediaFileId, parsed.frameIndex, image);
      }
      return { key, success: !!image };
    });

    await Promise.all(loadPromises);

    // Brief yield to main thread between batches
    await new Promise((r) => setTimeout(r, 0));
  }

  state.isPreloading = false;
}

export function enqueueProxyFramesAroundPosition(args: {
  state: ProxyFramePreloadState;
  mediaFileId: string;
  frameIndex: number;
  range: number;
  getKey: (mediaFileId: string, frameIndex: number) => string;
  hasCachedFrame: (key: string) => boolean;
  startPreloading: () => void;
  logDebug: (message: string) => void;
}): void {
  const { state, mediaFileId, frameIndex, range, getKey, hasCachedFrame, startPreloading, logDebug } = args;
  const framesToPreload: string[] = [];

  // Generate list of frames to preload (current position +/- range)
  for (let i = -range; i <= range; i++) {
    const frame = frameIndex + i;
    if (frame < 0) continue;

    const key = getKey(mediaFileId, frame);
    if (!hasCachedFrame(key) && !state.preloadQueue.includes(key)) {
      framesToPreload.push(key);
    }
  }

  // Add all to front of queue (highest priority)
  state.preloadQueue = [...framesToPreload, ...state.preloadQueue];

  // Start preloading if not already
  if (!state.isPreloading) {
    startPreloading();
  }

  logDebug(`Bulk preload started: ${framesToPreload.length} frames around frame ${frameIndex}`);
}

export async function preloadAllProxyFrames(args: {
  mediaFileId: string;
  totalFrames: number;
  getKey: (mediaFileId: string, frameIndex: number) => string;
  hasCachedFrame: (key: string) => boolean;
  loadFrame: (mediaFileId: string, frameIndex: number) => Promise<HTMLImageElement | null>;
  addToCache: (mediaFileId: string, frameIndex: number, image: HTMLImageElement) => void;
  onProgress?: (loaded: number, total: number) => void;
  logInfo: (message: string) => void;
}): Promise<void> {
  const { mediaFileId, totalFrames, getKey, hasCachedFrame, loadFrame, addToCache, onProgress, logInfo } = args;
  logInfo(`Starting full preload for ${mediaFileId}: ${totalFrames} frames`);

  let loadedCount = 0;
  const batchSize = 32; // Load 32 frames at a time

  for (let startFrame = 0; startFrame < totalFrames; startFrame += batchSize) {
    const endFrame = Math.min(startFrame + batchSize, totalFrames);
    const batch: Promise<void>[] = [];

    for (let frame = startFrame; frame < endFrame; frame++) {
      const key = getKey(mediaFileId, frame);

      // Skip if already cached
      if (hasCachedFrame(key)) {
        loadedCount++;
        continue;
      }

      // Load frame
      batch.push(
        loadFrame(mediaFileId, frame).then(image => {
          if (image) {
            addToCache(mediaFileId, frame, image);
          }
          loadedCount++;
        })
      );
    }

    // Wait for batch to complete
    await Promise.all(batch);

    // Report progress
    if (onProgress) {
      onProgress(loadedCount, totalFrames);
    }

    // Yield to main thread
    await new Promise(r => setTimeout(r, 0));
  }

  logInfo(`Full preload complete for ${mediaFileId}: ${loadedCount}/${totalFrames} frames cached`);
}
