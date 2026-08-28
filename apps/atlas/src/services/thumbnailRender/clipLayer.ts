import type { Effect } from '../../types/effects';
import type { Layer } from '../../types/layers';
import { getEffectiveScale } from '../../utils/transformScale';
import type { ThumbnailClipRenderInput } from './contracts';

export function buildThumbnailLayerFromClip(clip: ThumbnailClipRenderInput): Layer | null {
  if (!clip.source) return null;

  const transform = clip.transform || {};
  return {
    id: `thumb-${clip.id}`,
    name: clip.id,
    visible: true,
    opacity: transform.opacity ?? 1,
    blendMode: 'normal',
    source: clip.source as Layer['source'],
    effects: (clip.effects || []) as Effect[],
    position: { x: transform.position?.x || 0, y: transform.position?.y || 0, z: transform.position?.z || 0 },
    scale: getEffectiveScale(transform.scale),
    rotation: typeof transform.rotation === 'number'
      ? transform.rotation
      : (transform.rotation?.z || 0),
  };
}
