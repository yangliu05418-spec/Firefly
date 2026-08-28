import type { SplatRenderTargetPool } from '../SplatRenderTargetPool';

export interface CachedSplatRenderTarget {
  texture: GPUTexture;
  width: number;
  height: number;
}

export function resolveSplatRenderTarget(
  renderTargetPool: SplatRenderTargetPool,
  lastRenderTargets: Map<string, CachedSplatRenderTarget>,
  clipId: string,
  viewport: { width: number; height: number },
  outputView?: GPUTextureView,
): GPUTextureView {
  if (outputView) {
    lastRenderTargets.delete(clipId);
    return outputView;
  }

  const pooledTarget = renderTargetPool.acquire(viewport.width, viewport.height);
  lastRenderTargets.set(clipId, {
    texture: pooledTarget.texture,
    width: viewport.width,
    height: viewport.height,
  });

  return pooledTarget.view;
}
