import type { Layer } from '../../types/layers';
import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import type { VectorAnimationClipSettings } from '../../types/vectorAnimation';
import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import { vectorAnimationRuntimeManager } from '../vectorAnimation/VectorAnimationRuntimeManager';
import { buildBackgroundClipLayer } from './clipLayerFactory';
import type { LayerCompState } from './layerPlaybackState';

type VectorAnimationSettingsResolver = (
  clipId: string,
  clipLocalTime: number
) => VectorAnimationClipSettings | undefined;

export function buildBackgroundInnerLayers(
  state: LayerCompState,
  playheadPosition: number,
  resolveVectorAnimationSettings: VectorAnimationSettingsResolver
): Layer[] {
  const layers: Layer[] = [];
  const videoTracks = state.tracks.filter(t => t.type === 'video' && t.visible !== false);
  const time = Math.max(0, Math.min(playheadPosition, state.duration));

  for (const track of videoTracks) {
    const clip = state.clips.find(
      c => c.trackId === track.id && time >= c.startTime && time < c.startTime + c.duration
    );
    if (!clip || clip.isLoading) continue;

    const clipLocalTime = time - clip.startTime;
    const transform = clip.transform || DEFAULT_TRANSFORM;
    if (isVectorAnimationSourceType(clip.source?.type)) {
      vectorAnimationRuntimeManager.renderClipAtTime(
        clip,
        time,
        resolveVectorAnimationSettings(clip.id, clipLocalTime),
      );
    }
    const clipTime = clip.reversed
      ? clip.outPoint - clipLocalTime
      : clipLocalTime + clip.inPoint;
    const layer = buildBackgroundClipLayer(clip, clipTime, transform);
    if (layer) {
      layers.push(layer);
    }
  }

  return layers;
}
