import type { SpectralImageLayer } from '../../../types';
import { generateClipId } from '../helpers/idGenerator';

export function spectralOperationLabel(type: 'spectral-mask' | 'spectral-resynthesis'): string {
  switch (type) {
    case 'spectral-mask': return 'Spectral mask';
    case 'spectral-resynthesis': return 'Spectral resynthesis';
  }
}

export function createSpectralLayerId(): string {
  return generateClipId('spectral-layer');
}

export function normalizeSpectralLayer(layer: SpectralImageLayer): SpectralImageLayer {
  const frequencyMin = Math.max(0, Math.min(layer.frequencyMin, layer.frequencyMax));
  const frequencyMax = Math.max(frequencyMin, Math.max(layer.frequencyMin, layer.frequencyMax));
  const { keyframes: rawKeyframes, ...layerWithoutKeyframes } = layer;
  const keyframes = (rawKeyframes ?? [])
    .map(keyframe => {
      const normalized = {
        ...keyframe,
        time: Math.max(0, Math.min(Math.max(0.001, layer.duration), keyframe.time)),
      };
      if (typeof normalized.opacity === 'number') {
        normalized.opacity = Math.max(0, Math.min(1, normalized.opacity));
      }
      if (typeof normalized.gainDb === 'number') {
        normalized.gainDb = Math.max(-60, Math.min(24, normalized.gainDb));
      }
      if (typeof normalized.frequencyMin === 'number') {
        normalized.frequencyMin = Math.max(0, normalized.frequencyMin);
      }
      if (typeof normalized.frequencyMax === 'number') {
        normalized.frequencyMax = Math.max(0, normalized.frequencyMax);
      }
      if (
        typeof normalized.frequencyMin === 'number' &&
        typeof normalized.frequencyMax === 'number' &&
        normalized.frequencyMin > normalized.frequencyMax
      ) {
        const min = normalized.frequencyMax;
        normalized.frequencyMax = normalized.frequencyMin;
        normalized.frequencyMin = min;
      }
      return normalized;
    })
    .filter(keyframe => keyframe.id)
    .toSorted((a, b) => a.time - b.time);
  return {
    ...layerWithoutKeyframes,
    timeStart: Math.max(0, layer.timeStart),
    duration: Math.max(0.001, layer.duration),
    frequencyMin,
    frequencyMax,
    opacity: Math.max(0, Math.min(1, layer.opacity)),
    gainDb: Math.max(-60, Math.min(24, layer.gainDb)),
    featherTime: Math.max(0, layer.featherTime),
    featherFrequency: Math.max(0, layer.featherFrequency),
    ...(keyframes.length > 0 ? { keyframes } : {}),
  };
}
