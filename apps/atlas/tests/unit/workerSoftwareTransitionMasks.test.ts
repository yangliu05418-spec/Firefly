import { describe, expect, it, vi } from 'vitest';

import { applyWorkerSoftwareTransitionMask } from '../../src/services/render/workerSoftwareTransitionMasks';

describe('worker software transition masks', () => {
  it('applies pattern masks to scratch alpha data', () => {
    const imageData = {
      data: new Uint8ClampedArray([
        10, 20, 30, 255,
        40, 50, 60, 255,
        70, 80, 90, 255,
        100, 110, 120, 255,
      ]),
    } as ImageData;
    const context = {
      clearRect: vi.fn(),
      getImageData: vi.fn(() => imageData),
      putImageData: vi.fn(),
    } as unknown as OffscreenCanvasRenderingContext2D;

    applyWorkerSoftwareTransitionMask(context, 4, 1, {
      kind: 'pattern-mask',
      pattern: 'zig-zag',
      progress: 0.5,
    });

    expect(context.getImageData).toHaveBeenCalledWith(0, 0, 4, 1);
    expect(imageData.data).toEqual(new Uint8ClampedArray([
      10, 20, 30, 255,
      40, 50, 60, 0,
      70, 80, 90, 0,
      100, 110, 120, 0,
    ]));
    expect(context.putImageData).toHaveBeenCalledWith(imageData, 0, 0);
  });
});

