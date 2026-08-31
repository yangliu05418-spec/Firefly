import { describe, expect, it } from 'vitest';
import {
  resolvePreviewDisplaySize,
  resolvePreviewRenderResolution,
} from '../../src/components/preview/previewResolution';
import { resolveCompositorPixelGeometry } from '../../src/engine/render/compositorPixelGeometry';

describe('preview quality geometry contract', () => {
  const composition = { width: 1920, height: 1080 };
  const container = { width: 1000, height: 700 };

  it('changes only the backing render resolution', () => {
    expect(resolvePreviewRenderResolution(composition, 1)).toEqual({ width: 1920, height: 1080 });
    expect(resolvePreviewRenderResolution(composition, 0.5)).toEqual({ width: 960, height: 540 });
    expect(resolvePreviewRenderResolution(composition, 0.25)).toEqual({ width: 480, height: 270 });
    expect(resolvePreviewRenderResolution(composition, 0.125)).toEqual({ width: 240, height: 135 });
  });

  it('keeps Viewer dimensions invariant across every quality setting', () => {
    const display = resolvePreviewDisplaySize(container, composition, false);
    expect(display).toEqual({ width: 1000, height: 562 });

    for (const quality of [1, 0.5, 0.25, 0.125] as const) {
      resolvePreviewRenderResolution(composition, quality);
      expect(resolvePreviewDisplaySize(container, composition, false)).toEqual(display);
    }
  });

  it('preserves the project aspect ratio while filling the available Viewer axis', () => {
    expect(resolvePreviewDisplaySize({ width: 700, height: 1000 }, { width: 1080, height: 1920 }, false))
      .toEqual({ width: 562, height: 1000 });
  });

  it('keeps source geometry invariant when only the backing render resolution changes', () => {
    const original = resolveCompositorPixelGeometry({
      sourceWidth: 1920,
      sourceHeight: 1080,
      renderWidth: 1920,
      renderHeight: 1080,
      logicalWidth: 1920,
      logicalHeight: 1080,
    });

    for (const quality of [0.5, 0.25, 0.125] as const) {
      expect(resolveCompositorPixelGeometry({
        sourceWidth: 1920,
        sourceHeight: 1080,
        renderWidth: Math.round(1920 * quality),
        renderHeight: Math.round(1080 * quality),
        logicalWidth: 1920,
        logicalHeight: 1080,
      })).toEqual(original);
    }
  });
});
