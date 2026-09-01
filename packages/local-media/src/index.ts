import { LocalMediaManifestStore } from './manifest-store';
import { localMediaContentHandle, removeLocalMediaContent, removeLocalMediaUserDirectory } from './paths';
import type { LocalMediaDescriptor, LocalMediaEvent, LocalMediaManifest, LocalMediaStats } from './types';

export type { LocalMediaDescriptor, LocalMediaEvent, LocalMediaManifest, LocalMediaStats } from './types';

const DEFAULT_MAX_BYTES = 50 * 1024 ** 3;
const DEFAULT_TRANSFER_INACTIVITY_TIMEOUT_MS = 30_000;
const HIGH_WATER = 0.8;
const LOW_WATER = 0.65;
const channelName = (userId: string) => `firefly-local-media-v1:${userId}`;
const inFlight = new Map<string, Promise<void>>();
let persistenceRequested = false;

class TransferScheduler {
  private readonly concurrency: number;
  private active = 0;
  private order = 0;
  private readonly waiting: { priority: number; order: number; start: () => void }[] = [];
  constructor(concurrency: number) { this.concurrency = concurrency; }
  run<T>(priority: number, work: () => Promise<T>): Promise<T> {
    return new Promise<void>((resolve) => {
      this.waiting.push({ priority, order: this.order++, start: resolve });
      this.drain();
    }).then(work).finally(() => { this.active -= 1; this.drain(); });
  }
  private drain() {
    this.waiting.sort((left, right) => left.priority - right.priority || left.order - right.order);
    while (this.active < this.concurrency && this.waiting.length) {
      this.active += 1;
      this.waiting.shift()?.start();
    }
  }
}

const imageTransfers = new TransferScheduler(3);
const largeMediaTransfers = new TransferScheduler(1);
const transferPriority = (descriptor: LocalMediaDescriptor) => descriptor.cachePolicy === 'pin' ? 1 : descriptor.variant === 'thumbnail' ? 2 : descriptor.cachePolicy === 'warm' ? 3 : 4;
const transferScheduler = (descriptor: LocalMediaDescriptor) => descriptor.mediaType === 'image' ? imageTransfers : largeMediaTransfers;

export function restoreLocalMediaFileMetadata(
  file: File,
  descriptor: Pick<LocalMediaDescriptor, 'contentType'>,
): File {
  const contentType = descriptor.contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!contentType || file.type.toLowerCase() === contentType) return file;
  // Blob parts retain the OPFS-backed bytes; this wrapper restores response
  // metadata without reading or copying a large media file into JavaScript.
  return new File([file], file.name, {
    type: contentType,
    lastModified: file.lastModified,
  });
}

export interface LocalMediaCacheOptions {
  report?: (event: LocalMediaEvent) => void;
  maxBytes?: number;
  transferInactivityTimeoutMs?: number;
}

export class LocalMediaCache {
  readonly userId: string;
  private readonly store = new LocalMediaManifestStore();
  private readonly objectUrls = new Map<string, { url: string; leases: number }>();
  private readonly activeWorkers = new Map<string, { id: string; worker: Worker; mediaType: LocalMediaDescriptor['mediaType'] }>();
  private readonly channel?: BroadcastChannel;
  private readonly report?: (event: LocalMediaEvent) => void;
  private readonly maxBytes: number;
  private readonly transferInactivityTimeoutMs: number;
  private closed = false;

  constructor(userId: string, options: LocalMediaCacheOptions = {}) {
    this.userId = userId;
    this.report = options.report;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.transferInactivityTimeoutMs = Math.max(1, options.transferInactivityTimeoutMs ?? DEFAULT_TRANSFER_INACTIVITY_TIMEOUT_MS);
    this.channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(channelName(userId));
  }

  static supported() {
    return typeof navigator !== 'undefined' && Boolean(navigator.storage?.getDirectory) && typeof Worker !== 'undefined';
  }

  async acquire(descriptor: LocalMediaDescriptor, warm = true): Promise<{ url: string; local: boolean; release: () => void }> {
    if (!LocalMediaCache.supported() || this.closed) {
      this.emit('local_media_fallback', descriptor, { errorCode: 'OPFS_UNAVAILABLE' });
      return { url: descriptor.url, local: false, release: () => undefined };
    }
    const manifest = await this.store.read(this.userId, descriptor.cacheKey).catch(() => undefined);
    if (manifest?.state === 'ready' && manifest.revision === descriptor.revision) {
      try {
        const lease = await this.localObjectUrl(descriptor);
        void this.store.touch(this.userId, descriptor.cacheKey);
        this.emit('local_media_hit', descriptor, { bytes: manifest.downloadedBytes });
        return { ...lease, local: true };
      } catch { await this.evict(manifest).catch(() => undefined); }
    }
    this.emit('local_media_miss', descriptor);
    if (warm) void this.warm(descriptor, 0);
    return { url: descriptor.url, local: false, release: () => undefined };
  }

  async warm(descriptor: LocalMediaDescriptor, priority = transferPriority(descriptor)) {
    if (!LocalMediaCache.supported() || this.closed) return;
    if (!persistenceRequested) {
      persistenceRequested = true;
      void navigator.storage.persist?.().catch(() => false);
    }
    const key = `${this.userId}:${descriptor.cacheKey}`;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const run = transferScheduler(descriptor).run(priority, () => this.withLock(descriptor.cacheKey, async () => {
      const current = await this.store.read(this.userId, descriptor.cacheKey);
      if (current?.state === 'ready' && current.revision === descriptor.revision) return;
      if (current && current.revision !== descriptor.revision) await this.evict(current);
      await this.download(descriptor);
      await this.trim();
    })).finally(() => { if (inFlight.get(key) === run) inFlight.delete(key); });
    inFlight.set(key, run);
    return run;
  }

  async pin(descriptor: LocalMediaDescriptor) {
    await this.warm({ ...descriptor, cachePolicy: 'pin' }, 1);
    const manifest = await this.store.read(this.userId, descriptor.cacheKey);
    if (manifest && !manifest.pinned) await this.store.put({ ...manifest, pinned: true });
  }

  async materialize(descriptor: LocalMediaDescriptor): Promise<{ file: File; handle: FileSystemFileHandle }> {
    if (!LocalMediaCache.supported() || this.closed) throw new Error('OPFS_UNAVAILABLE');
    await this.warm(descriptor);
    const manifest = await this.store.read(this.userId, descriptor.cacheKey);
    if (manifest?.state !== 'ready' || manifest.revision !== descriptor.revision) throw new Error('LOCAL_MEDIA_NOT_READY');
    const handle = await localMediaContentHandle(this.userId, descriptor.cacheKey);
    const storedFile = await handle.getFile();
    if (!storedFile.size || (descriptor.size && storedFile.size !== descriptor.size)) throw new Error('LOCAL_MEDIA_INVALID');
    const file = restoreLocalMediaFileMetadata(storedFile, descriptor);
    void this.store.touch(this.userId, descriptor.cacheKey);
    return { file, handle };
  }

  async seed(descriptor: LocalMediaDescriptor, blob: Blob) {
    if (!LocalMediaCache.supported() || this.closed) return;
    const key = `${this.userId}:${descriptor.cacheKey}`;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const run = transferScheduler(descriptor).run(0, () => this.withLock(descriptor.cacheKey, async () => {
      const current = await this.store.read(this.userId, descriptor.cacheKey);
      if (current?.state === 'ready' && current.revision === descriptor.revision && current.downloadedBytes === blob.size) return;
      if (current) await this.evict(current);
      await this.runWorker({ type: 'seed', descriptor, blob });
      await this.trim();
    })).finally(() => { if (inFlight.get(key) === run) inFlight.delete(key); });
    inFlight.set(key, run);
    return run;
  }

  async unpin(cacheKey: string) {
    const manifest = await this.store.read(this.userId, cacheKey);
    if (manifest?.pinned) await this.store.put({ ...manifest, pinned: false, lastAccessedAt: Date.now() });
  }

  pause(cacheKey: string) {
    const active = this.activeWorkers.get(cacheKey);
    if (active) active.worker.postMessage({ id: active.id, type: 'cancel' });
  }

  pauseLargeTransfers() {
    for (const active of this.activeWorkers.values()) {
      if (active.mediaType !== 'image') active.worker.postMessage({ id: active.id, type: 'cancel' });
    }
  }

  async clear(keepPinned = false) {
    const manifests = await this.store.list(this.userId);
    for (const manifest of manifests) {
      if (!keepPinned || !manifest.pinned) await this.evict(manifest);
    }
  }

  async stats(): Promise<LocalMediaStats> {
    const manifests = LocalMediaCache.supported() ? await this.store.list(this.userId).catch(() => []) : [];
    const estimate: StorageEstimate = await navigator.storage?.estimate?.().catch(() => ({} as StorageEstimate)) ?? {};
    const persisted = await navigator.storage?.persisted?.().catch(() => false) ?? false;
    return {
      supported: LocalMediaCache.supported(), persisted,
      usage: estimate.usage ?? 0, quota: estimate.quota ?? 0,
      cachedBytes: manifests.filter((item) => item.state === 'ready').reduce((sum, item) => sum + item.downloadedBytes, 0),
      cachedItems: manifests.filter((item) => item.state === 'ready').length,
    };
  }

  async destroyAndRemoveUserData() {
    this.close();
    await Promise.allSettled([this.store.clearUser(this.userId), removeLocalMediaUserDirectory(this.userId)]);
  }

  close() {
    this.closed = true;
    for (const active of this.activeWorkers.values()) active.worker.postMessage({ id: active.id, type: 'cancel' });
    this.channel?.close();
    for (const lease of this.objectUrls.values()) URL.revokeObjectURL(lease.url);
    this.objectUrls.clear();
  }

  private async localObjectUrl(descriptor: LocalMediaDescriptor) {
    const cacheKey = descriptor.cacheKey;
    const existing = this.objectUrls.get(cacheKey);
    if (existing) {
      existing.leases += 1;
      return { url: existing.url, release: () => this.releaseObjectUrl(cacheKey) };
    }
    const storedFile = await (await localMediaContentHandle(this.userId, cacheKey)).getFile();
    if (!storedFile.size) throw new Error('LOCAL_MEDIA_EMPTY');
    const file = restoreLocalMediaFileMetadata(storedFile, descriptor);
    const url = URL.createObjectURL(file);
    this.objectUrls.set(cacheKey, { url, leases: 1 });
    return { url, release: () => this.releaseObjectUrl(cacheKey) };
  }

  private releaseObjectUrl(cacheKey: string) {
    const lease = this.objectUrls.get(cacheKey);
    if (!lease || --lease.leases > 0) return;
    URL.revokeObjectURL(lease.url);
    this.objectUrls.delete(cacheKey);
  }

  private async download(descriptor: LocalMediaDescriptor) {
    await this.runWorker({ type: 'cache', descriptor });
  }

  private async runWorker(request: { type: 'cache'; descriptor: LocalMediaDescriptor } | { type: 'seed'; descriptor: LocalMediaDescriptor; blob: Blob }) {
    const descriptor = request.descriptor;
    const startedAt = performance.now();
    const worker = new Worker(new URL('./local-media.worker.ts', import.meta.url), { type: 'module' });
    const id = crypto.randomUUID();
    let lastCheckpointAt = 0;
    let lastCheckpointBytes = 0;
    this.activeWorkers.set(descriptor.cacheKey, { id, worker, mediaType: descriptor.mediaType });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      let lastProgressBytes = -1;
      const clearWatchdog = () => {
        if (watchdog !== undefined) clearTimeout(watchdog);
        watchdog = undefined;
      };
      const finish = (result: { ok: true } | { ok: false; error: Error }) => {
        if (settled) return;
        settled = true;
        clearWatchdog();
        if (result.ok) resolve(); else reject(result.error);
      };
      const armWatchdog = () => {
        clearWatchdog();
        watchdog = setTimeout(() => {
          if (settled) return;
          try { worker.postMessage({ id, type: 'cancel' }); } catch { /* worker will be terminated in finally */ }
          this.emit('local_media_fallback', descriptor, {
            bytes: Math.max(0, lastProgressBytes),
            errorCode: 'LOCAL_MEDIA_TRANSFER_STALLED',
          });
          finish({ ok: false, error: new Error('LOCAL_MEDIA_TRANSFER_STALLED') });
        }, this.transferInactivityTimeoutMs);
      };
      armWatchdog();
      worker.onmessage = (event: MessageEvent<{ id: string; type: string; downloadedBytes?: number; errorCode?: string }>) => {
        if (settled || event.data.id !== id) return;
        const bytes = event.data.downloadedBytes ?? 0;
        if (event.data.type === 'started' || event.data.type === 'resumed') {
          lastProgressBytes = bytes;
          armWatchdog();
          void this.store.markPartial(this.userId, descriptor, bytes);
          lastCheckpointAt = performance.now();
          lastCheckpointBytes = bytes;
          this.emit(event.data.type === 'resumed' ? 'local_media_fetch_resumed' : 'local_media_fetch_started', descriptor, { bytes });
        } else if (event.data.type === 'progress') {
          if (bytes <= lastProgressBytes) return;
          lastProgressBytes = bytes;
          armWatchdog();
          const now = performance.now();
          if (bytes - lastCheckpointBytes >= 4 * 1024 ** 2 || now - lastCheckpointAt >= 1_000) {
            lastCheckpointAt = now;
            lastCheckpointBytes = bytes;
            void this.store.markPartial(this.userId, descriptor, bytes);
            this.channel?.postMessage({ type: 'progress', cacheKey: descriptor.cacheKey, revision: descriptor.revision, bytes });
          }
        } else if (event.data.type === 'ready') {
          lastProgressBytes = bytes;
          armWatchdog();
          void this.store.markReady(this.userId, descriptor, bytes).then(() => {
            if (settled) return;
            this.channel?.postMessage({ type: 'ready', cacheKey: descriptor.cacheKey, revision: descriptor.revision });
            this.emit('local_media_ready', descriptor, { bytes, elapsedMs: Math.round(performance.now() - startedAt) });
            finish({ ok: true });
          }, (error) => finish({ ok: false, error: error instanceof Error ? error : new Error('LOCAL_MEDIA_MANIFEST_FAILED') }));
        } else if (event.data.type === 'failed') {
          void this.store.markPartial(this.userId, descriptor, bytes);
          if (event.data.errorCode !== 'AbortError') {
            this.emit('local_media_fallback', descriptor, { bytes, errorCode: event.data.errorCode });
          }
          finish({ ok: false, error: new Error(event.data.errorCode ?? 'LOCAL_MEDIA_DOWNLOAD_FAILED') });
        }
      };
      worker.onerror = () => finish({ ok: false, error: new Error('LOCAL_MEDIA_WORKER_CRASHED') });
      try {
        worker.postMessage({ id, userId: this.userId, ...request });
      } catch (error) {
        finish({ ok: false, error: error instanceof Error ? error : new Error('LOCAL_MEDIA_WORKER_POST_FAILED') });
      }
    }).finally(() => {
      if (this.activeWorkers.get(descriptor.cacheKey)?.id === id) this.activeWorkers.delete(descriptor.cacheKey);
      worker.terminate();
    });
  }

  private async trim() {
    const estimate = await navigator.storage.estimate();
    const quotaBudget = Math.floor((estimate.quota ?? this.maxBytes) * HIGH_WATER);
    const budget = Math.min(this.maxBytes, quotaBudget);
    const manifests = (await this.store.list(this.userId)).filter((item) => item.state === 'ready');
    let bytes = manifests.reduce((sum, item) => sum + item.downloadedBytes, 0);
    if (bytes <= budget) return;
    this.emit('local_media_quota_pressure', manifests[0] ?? {
      cacheKey: 'quota', revision: '0', variant: 'original', mediaType: 'video', contentType: '', url: '', cachePolicy: 'on-demand',
    }, { bytes });
    const target = Math.floor(budget * (LOW_WATER / HIGH_WATER));
    for (const manifest of manifests.filter((item) => !item.pinned).sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)) {
      await this.evict(manifest);
      bytes -= manifest.downloadedBytes;
      if (bytes <= target) break;
    }
  }

  private async evict(manifest: LocalMediaManifest) {
    const lease = this.objectUrls.get(manifest.cacheKey);
    if (lease) { URL.revokeObjectURL(lease.url); this.objectUrls.delete(manifest.cacheKey); }
    await removeLocalMediaContent(this.userId, manifest.cacheKey);
    await this.store.remove(this.userId, manifest.cacheKey);
    this.emit('local_media_evicted', manifest, { bytes: manifest.downloadedBytes });
  }

  private withLock<T>(cacheKey: string, work: () => Promise<T>): Promise<T> {
    if (!navigator.locks?.request) return work();
    return new Promise<T>((resolve, reject) => {
      void navigator.locks.request(`firefly-local-media:${this.userId}:${cacheKey}`, async () => {
        try { resolve(await work()); } catch (error) { reject(error); }
      }).catch(reject);
    });
  }

  private emit(type: LocalMediaEvent['type'], descriptor: LocalMediaDescriptor, detail: Partial<LocalMediaEvent> = {}) {
    this.report?.({ type, cacheKey: descriptor.cacheKey, variant: descriptor.variant, mediaType: descriptor.mediaType, ...detail });
  }
}
