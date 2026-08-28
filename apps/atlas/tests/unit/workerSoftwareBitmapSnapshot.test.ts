import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWorkerSoftwareBitmapSnapshot } from '../../src/services/render/workerSoftwareBitmapSnapshot';

const originalCreateImageBitmap = globalThis.createImageBitmap;
const originalOffscreenCanvas = globalThis.OffscreenCanvas;

function restoreGlobal<T extends keyof typeof globalThis>(
  key: T,
  value: (typeof globalThis)[T] | undefined,
): void {
  if (value) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
    });
  } else {
    Reflect.deleteProperty(globalThis, key);
  }
}

describe('worker software bitmap snapshots', () => {
  afterEach(() => {
    restoreGlobal('createImageBitmap', originalCreateImageBitmap);
    restoreGlobal('OffscreenCanvas', originalOffscreenCanvas);
  });

  it('uses a scaled canvas fallback when createImageBitmap resize options are unavailable', async () => {
    const drawImage = vi.fn();
    const canvases: Array<{ width: number; height: number; getContext: ReturnType<typeof vi.fn> }> = [];
    class FakeOffscreenCanvas {
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        canvases.push(this);
      }

      getContext = vi.fn(() => ({ drawImage }));
    }
    const source = { tagName: 'VIDEO' } as unknown as HTMLVideoElement;
    const bitmap = { width: 320, height: 180, close: vi.fn() } as unknown as ImageBitmap;
    const createImageBitmapMock = vi.fn()
      .mockRejectedValueOnce(new Error('resize unsupported'))
      .mockResolvedValueOnce(bitmap);
    Object.defineProperty(globalThis, 'OffscreenCanvas', {
      configurable: true,
      value: FakeOffscreenCanvas,
    });
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: createImageBitmapMock,
    });

    const snapshot = await createWorkerSoftwareBitmapSnapshot({
      source,
      sourceWidth: 1280,
      sourceHeight: 720,
      maxSize: { width: 320, height: 180 },
      resizeQuality: 'low',
    });

    expect(snapshot).toEqual({ bitmap, width: 320, height: 180 });
    expect(createImageBitmapMock).toHaveBeenNthCalledWith(1, source, {
      resizeWidth: 320,
      resizeHeight: 180,
      resizeQuality: 'low',
    });
    expect(canvases[0]).toMatchObject({ width: 320, height: 180 });
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 320, 180);
    expect(createImageBitmapMock).toHaveBeenNthCalledWith(2, canvases[0]);
  });

  it('keeps native resize when createImageBitmap resize options work', async () => {
    const source = { tagName: 'VIDEO' } as unknown as HTMLVideoElement;
    const bitmap = { width: 320, height: 180, close: vi.fn() } as unknown as ImageBitmap;
    const createImageBitmapMock = vi.fn().mockResolvedValue(bitmap);
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: createImageBitmapMock,
    });

    const snapshot = await createWorkerSoftwareBitmapSnapshot({
      source,
      sourceWidth: 1280,
      sourceHeight: 720,
      maxSize: { width: 320, height: 180 },
      resizeQuality: 'low',
    });

    expect(snapshot).toEqual({ bitmap, width: 320, height: 180 });
    expect(createImageBitmapMock).toHaveBeenCalledTimes(1);
    expect(createImageBitmapMock).toHaveBeenCalledWith(source, {
      resizeWidth: 320,
      resizeHeight: 180,
      resizeQuality: 'low',
    });
  });
});
