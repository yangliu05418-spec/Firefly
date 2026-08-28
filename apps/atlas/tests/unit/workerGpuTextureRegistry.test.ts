import { describe, expect, it, vi } from 'vitest';

import {
  WorkerGpuTextureRegistry,
  estimateWorkerGpuTextureBytes,
  type WorkerGpuTextureLike,
} from '../../src/services/render/workerGpuTextureRegistry';

interface FakeTexture extends WorkerGpuTextureLike {
  readonly destroy: () => void;
}

function fakeTexture(label: string): FakeTexture {
  return {
    label,
    destroy: vi.fn(),
  };
}

function fakeClock(start = 1000): () => number {
  let now = start;
  return () => {
    now += 1;
    return now;
  };
}

function expectNoFunctions(value: unknown): void {
  expect(typeof value).not.toBe('function');
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) expectNoFunctions(item);
    return;
  }
  for (const item of Object.values(value)) expectNoFunctions(item);
}

describe('WorkerGpuTextureRegistry', () => {
  it('allocates placeholders, attaches imported handles, and exposes cloneable snapshots', () => {
    const registry = new WorkerGpuTextureRegistry<FakeTexture>(fakeClock());

    const placeholder = registry.allocatePlaceholder({
      id: 'texture:clip-a:frame-42',
      owner: 'provider-frame',
      ownerId: 'provider-a',
      sourceKind: 'video',
      sourceKey: 'clip-a',
      frameKey: 42,
      cacheKey: 'clip-a@42',
      width: 1920,
      height: 1080,
      format: 'rgba8unorm',
      label: 'pending video frame',
      createdAt: 10,
      lastUsedAt: 11,
    });

    expect(placeholder.entry).toMatchObject({
      id: 'texture:clip-a:frame-42',
      lifecycle: 'placeholder',
      owner: 'provider-frame',
      ownerId: 'provider-a',
      sourceKind: 'video',
      sourceKey: 'clip-a',
      frameKey: 42,
      cacheKey: 'clip-a@42',
      bytes: 1920 * 1080 * 4,
      refCount: 1,
      hasTexture: false,
    });

    const texture = fakeTexture('imported video frame');
    const attached = registry.attachTexture(placeholder.id, texture, {
      lifecycle: 'imported',
      label: 'imported video frame',
      lastUsedAt: 12,
    });

    expect(attached).toMatchObject({
      id: placeholder.id,
      lifecycle: 'imported',
      refCount: 1,
      hasTexture: true,
      label: 'imported video frame',
    });
    expect(registry.getTexture(placeholder.id)).toBe(texture);

    const snapshot = registry.snapshot();
    expect(snapshot).toMatchObject({
      entries: 1,
      textures: 1,
      bytes: 1920 * 1080 * 4,
      vramBytes: 1920 * 1080 * 4,
      peakVramBytes: 1920 * 1080 * 4,
      bytesByOwner: { 'provider-frame': 1920 * 1080 * 4 },
      entriesByOwner: { 'provider-frame': 1 },
      counters: {
        allocations: 1,
        placeholders: 1,
        imports: 1,
        retains: 1,
      },
    });
    expect(snapshot.items[0]).not.toHaveProperty('texture');
    expectNoFunctions(snapshot);
    expect(structuredClone(snapshot)).toEqual(snapshot);
  });

  it('registers fake GPU textures and releases ownership by id', () => {
    const texture = fakeTexture('transient pass texture');
    const registry = new WorkerGpuTextureRegistry<FakeTexture>(fakeClock());
    const lease = registry.registerTexture({
      texture,
      owner: 'intermediate',
      ownerId: 'pass-a',
      sourceKind: 'render-pass',
      sourceKey: 'comp-a:pass-a',
      frameKey: 'frame-10',
      width: 64,
      height: 32,
      format: 'rgba16float',
      cacheable: false,
    });
    const secondLease = registry.retain(lease.id, 'compositor');

    expect(secondLease?.entry.refCount).toBe(2);
    expect(registry.release(lease.id)).toBe(true);

    const destroy = texture.destroy as ReturnType<typeof vi.fn>;
    const snapshot = registry.snapshot();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(snapshot.entries).toBe(0);
    expect(snapshot.counters.retains).toBe(2);
    expect(snapshot.counters.releases).toBe(2);
    expect(snapshot.counters.destructions).toBe(1);
  });

  it('reuses cache-keyed imports and evicts unused GPU textures deterministically', () => {
    const texture = fakeTexture('cached source frame');
    const registry = new WorkerGpuTextureRegistry<FakeTexture>(fakeClock());
    const imported = registry.importTexture({
      texture,
      owner: 'source-frame',
      ownerId: 'provider-a',
      sourceKind: 'video-frame',
      sourceKey: 'clip-a',
      frameKey: 'time:1.25',
      cacheKey: 'clip-a:time:1.25',
      width: 320,
      height: 180,
      format: 'bgra8unorm',
      cacheable: true,
    });

    expect(registry.release(imported.token)).toBe(true);
    expect(texture.destroy).not.toHaveBeenCalled();

    const reused = registry.reuseByKey({
      cacheKey: 'clip-a:time:1.25',
      retainOwnerId: 'compositor',
    });

    expect(reused).toMatchObject({
      id: imported.id,
      refCount: 1,
    });
    expect(registry.release(reused?.token ?? '')).toBe(true);
    expect(registry.evictUnused({ owner: 'source-frame' })).toBe(1);

    const snapshot = registry.snapshot();
    expect(texture.destroy).toHaveBeenCalledTimes(1);
    expect(snapshot.entries).toBe(0);
    expect(snapshot.counters.reuses).toBe(1);
    expect(snapshot.counters.releases).toBe(2);
    expect(snapshot.counters.evictions).toBe(1);
    expect(snapshot.counters.destructions).toBe(1);
  });

  it('tracks leak checks against active source ownership', () => {
    const registry = new WorkerGpuTextureRegistry<FakeTexture>(fakeClock());
    const stale = registry.importTexture({
      texture: fakeTexture('stale source frame'),
      owner: 'source-frame',
      ownerId: 'provider-stale',
      sourceKind: 'video-frame',
      sourceKey: 'clip-stale',
      frameKey: 90,
      width: 16,
      height: 16,
      format: 'rgba8unorm',
    });
    const active = registry.importTexture({
      texture: fakeTexture('active source frame'),
      owner: 'source-frame',
      ownerId: 'provider-active',
      sourceKind: 'video-frame',
      sourceKey: 'clip-active',
      frameKey: 91,
      width: 16,
      height: 16,
      format: 'rgba8unorm',
    });

    registry.release(active.token);
    const leaks = registry.checkForLeaks({
      activeSourceKeys: new Set(['clip-active']),
    });

    expect(leaks.map((entry) => entry.id)).toEqual([stale.id]);
    const snapshot = registry.snapshot();
    expect(snapshot.counters.leakChecks).toBe(1);
    expect(snapshot.counters.leaks).toBe(1);
  });

  it('estimates common GPU texture formats without constructing real GPUTexture objects', () => {
    expect(estimateWorkerGpuTextureBytes({
      width: 10,
      height: 10,
      format: 'rgba8unorm',
    })).toBe(400);
    expect(estimateWorkerGpuTextureBytes({
      width: 10,
      height: 10,
      format: 'rgba16float',
    })).toBe(800);
    expect(estimateWorkerGpuTextureBytes({
      width: 10,
      height: 10,
      format: 'rgba8unorm',
      sampleCount: 4,
    })).toBe(1600);
    expect(estimateWorkerGpuTextureBytes({
      width: 10,
      height: 10,
      bytes: 123,
    })).toBe(123);
  });
});
