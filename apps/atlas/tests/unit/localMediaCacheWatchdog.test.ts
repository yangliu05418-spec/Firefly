import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const manifestStore = vi.hoisted(() => ({
  read: vi.fn(),
  markPartial: vi.fn(),
  markReady: vi.fn(),
  list: vi.fn(),
  touch: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  clearUser: vi.fn(),
}));

vi.mock('../../../../packages/local-media/src/manifest-store', () => ({
  LocalMediaManifestStore: vi.fn(function LocalMediaManifestStore() {
    return manifestStore;
  }),
}));

import { LocalMediaCache, type LocalMediaDescriptor } from '../../../../packages/local-media/src';

class FakeWorker {
  static instances: FakeWorker[] = [];
  static behaviors: Array<'silent' | 'start-then-stall' | 'success'> = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: Array<Record<string, unknown>> = [];
  readonly behavior: 'silent' | 'start-then-stall' | 'success';
  terminated = false;

  constructor() {
    this.behavior = FakeWorker.behaviors.shift() ?? 'silent';
    FakeWorker.instances.push(this);
  }

  postMessage(message: Record<string, unknown>) {
    this.messages.push(message);
    if (message.type !== 'cache' || this.behavior === 'silent') return;
    const id = String(message.id);
    queueMicrotask(() => {
      this.onmessage?.({ data: { id, type: 'started', downloadedBytes: 0 } } as MessageEvent);
      if (this.behavior === 'start-then-stall') return;
      this.onmessage?.({ data: { id, type: 'progress', downloadedBytes: 4 } } as MessageEvent);
      this.onmessage?.({ data: { id, type: 'ready', downloadedBytes: 4 } } as MessageEvent);
    });
  }

  terminate() {
    this.terminated = true;
  }
}

const descriptor: LocalMediaDescriptor = {
  cacheKey: 'watchdog-video',
  revision: 'v1',
  variant: 'preview',
  mediaType: 'video',
  contentType: 'video/mp4',
  size: 4,
  url: '/api/media/watchdog-video',
  cachePolicy: 'on-demand',
};

describe('LocalMediaCache worker inactivity watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWorker.instances = [];
    FakeWorker.behaviors = [];
    manifestStore.read.mockResolvedValue(undefined);
    manifestStore.markPartial.mockResolvedValue(undefined);
    manifestStore.markReady.mockResolvedValue(undefined);
    manifestStore.list.mockResolvedValue([]);
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: vi.fn(),
        persist: vi.fn().mockResolvedValue(true),
        estimate: vi.fn().mockResolvedValue({ quota: 1024 ** 3, usage: 0 }),
        persisted: vi.fn().mockResolvedValue(true),
      },
    });
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('BroadcastChannel', undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rejects a silent worker, cleans it up, and permits a retry', async () => {
    FakeWorker.behaviors = ['silent', 'success'];
    const cache = new LocalMediaCache('user-watchdog', { transferInactivityTimeoutMs: 50 });
    const firstAttempt = cache.warm(descriptor);
    const firstRejection = expect(firstAttempt).rejects.toThrow('LOCAL_MEDIA_TRANSFER_STALLED');

    await vi.advanceTimersByTimeAsync(51);
    await firstRejection;

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'cancel' }),
    ]));
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
    expect(manifestStore.markPartial).not.toHaveBeenCalled();

    await expect(cache.warm(descriptor)).resolves.toBeUndefined();

    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1]?.terminated).toBe(true);
    expect(manifestStore.markReady).toHaveBeenCalledWith('user-watchdog', descriptor, 4);
    cache.close();
  });

  it('rejects when a started worker stops making progress', async () => {
    FakeWorker.behaviors = ['start-then-stall'];
    const cache = new LocalMediaCache('user-progress-watchdog', { transferInactivityTimeoutMs: 50 });
    const attempt = cache.warm({ ...descriptor, cacheKey: 'progress-watchdog-video' });
    const rejection = expect(attempt).rejects.toThrow('LOCAL_MEDIA_TRANSFER_STALLED');

    await vi.advanceTimersByTimeAsync(51);
    await rejection;

    expect(FakeWorker.instances[0]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'cancel' }),
    ]));
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
    cache.close();
  });
});
