import { useEffect, useState } from 'react';
import { LocalMediaCache, type LocalMediaDescriptor, type LocalMediaEvent, type LocalMediaStats } from '../packages/local-media/src';

let activeCache: LocalMediaCache | null = null;
let activeUserId = '';
let uploadResumeEnabled = false;
const cacheChangedEvent = 'firefly:local-media-cache-changed';
let playbackGuardInstalled = false;

const installPlaybackGuard = () => {
  if (playbackGuardInstalled || typeof document === 'undefined') return;
  playbackGuardInstalled = true;
  document.addEventListener('play', () => activeCache?.pauseLargeTransfers(), true);
};

const report = (event: LocalMediaEvent) => {
  void fetch('/api/local-media-events', {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  }).catch(() => undefined);
};

export function activateLocalMediaCache(userId: string) {
  installPlaybackGuard();
  if (activeCache && activeUserId === userId) return activeCache;
  const previous = activeCache;
  const previousUser = activeUserId;
  activeCache = new LocalMediaCache(userId, { report });
  activeUserId = userId;
  if (previous) {
    if (previousUser && previousUser !== userId) void previous.destroyAndRemoveUserData();
    else previous.close();
  }
  window.dispatchEvent(new Event(cacheChangedEvent));
  return activeCache;
}

export function configureLocalMedia(options: { uploadResume?: boolean }) {
  uploadResumeEnabled = options.uploadResume === true;
}

export const seedUploadedLocalMedia = (descriptor: LocalMediaDescriptor | undefined, blob: Blob) =>
  descriptor && activeCache && uploadResumeEnabled ? activeCache.seed(descriptor, blob).catch(() => undefined) : Promise.resolve();

export function deactivateLocalMediaCache(removeData = false) {
  const current = activeCache;
  activeCache = null;
  activeUserId = '';
  if (!current) return Promise.resolve();
  window.dispatchEvent(new Event(cacheChangedEvent));
  if (removeData) return current.destroyAndRemoveUserData();
  current.close();
  return Promise.resolve();
}

export const warmLocalMedia = (descriptor: LocalMediaDescriptor | undefined) =>
  descriptor && activeCache ? activeCache.warm(descriptor).catch(() => undefined) : Promise.resolve();

export const pauseLocalMedia = (descriptor: LocalMediaDescriptor | undefined) => {
  if (descriptor && activeCache) activeCache.pause(descriptor.cacheKey);
};

export const pinLocalMedia = async (descriptor: LocalMediaDescriptor | undefined) => {
  if (!descriptor || !activeCache) return false;
  try {
    await activeCache.pin(descriptor);
    window.dispatchEvent(new Event(cacheChangedEvent));
    return true;
  } catch { return false; }
};

export const localMediaStats = (): Promise<LocalMediaStats> => activeCache
  ? activeCache.stats()
  : Promise.resolve({ supported: LocalMediaCache.supported(), persisted: false, usage: 0, quota: 0, cachedBytes: 0, cachedItems: 0 });

export const clearLocalMedia = (keepPinned = false) => activeCache?.clear(keepPinned) ?? Promise.resolve();

export function useLocalMediaSource(
  descriptor: LocalMediaDescriptor | undefined,
  options: { warm?: boolean; switchWhenReady?: boolean } = {},
) {
  const [source, setSource] = useState(() => descriptor?.url);
  const [local, setLocal] = useState(false);
  const [cacheEpoch, setCacheEpoch] = useState(0);
  useEffect(() => {
    const changed = () => setCacheEpoch((value) => value + 1);
    window.addEventListener(cacheChangedEvent, changed);
    return () => window.removeEventListener(cacheChangedEvent, changed);
  }, []);
  useEffect(() => {
    let cancelled = false;
    let release: () => void = () => undefined;
    setSource(descriptor?.url);
    setLocal(false);
    if (!descriptor || !activeCache) return;
    const cache = activeCache;
    void cache.acquire(descriptor, options.warm !== false).then(async (lease) => {
      if (cancelled) { lease.release(); return; }
      release = lease.release;
      setSource(lease.url);
      setLocal(lease.local);
      if (!lease.local && options.switchWhenReady) {
        await cache.warm(descriptor).catch(() => undefined);
        if (cancelled) return;
        const ready = await cache.acquire(descriptor, false).catch(() => null);
        if (!ready) return;
        release();
        release = ready.release;
        setSource(ready.url);
        setLocal(ready.local);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; release(); };
  }, [cacheEpoch, descriptor?.cacheKey, descriptor?.revision, descriptor?.url, options.switchWhenReady, options.warm]);
  return { source: source ?? descriptor?.url, local };
}
