import type { PreviewQuality } from '../../stores/settingsStore';

export interface PreviewSize {
  width: number;
  height: number;
}

/**
 * Preview quality only controls the render target's backing resolution.
 * It must never be used for Viewer layout, zoom, clip transforms, or export.
 */
export function resolvePreviewRenderResolution(
  composition: PreviewSize,
  quality: PreviewQuality,
): PreviewSize {
  return {
    width: Math.max(1, Math.round(composition.width * quality)),
    height: Math.max(1, Math.round(composition.height * quality)),
  };
}

/**
 * Viewer geometry is derived only from the available panel and project aspect.
 * Keeping this separate from resolvePreviewRenderResolution prevents quality
 * changes from making the video appear larger or smaller.
 */
export function resolvePreviewDisplaySize(
  container: PreviewSize,
  composition: PreviewSize,
  fillContainer: boolean,
): PreviewSize {
  if (fillContainer) return { ...container };

  const compositionAspect = composition.width / Math.max(1, composition.height);
  const containerAspect = container.width / Math.max(1, container.height);

  if (containerAspect > compositionAspect) {
    return {
      width: Math.floor(container.height * compositionAspect),
      height: container.height,
    };
  }

  return {
    width: container.width,
    height: Math.floor(container.width / compositionAspect),
  };
}
