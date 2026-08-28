import type { AudioEffectParamValue } from '../../../types';
import {
  AUDIO_EQ_DEFAULT_BAND_DYNAMICS,
  AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS,
  AUDIO_EQ_LEGACY_BANDS,
} from '../../../engine/audio/eq/AudioEqDefaults';
import { normalizeAudioEqParams } from '../../../engine/audio/eq/AudioEqLegacy';
import { getAudioEffectParamPathValue } from '../../../utils/audioEffectParamPath';

type TimelineHeaderEffectClip = {
  effects?: Array<{ id: string; type?: string; name: string; params: Record<string, unknown> }>;
};

export type ParsedTimelineEffectProperty = {
  effectId: string;
  paramName: string;
  paramPath: string[];
};

export type AudioEqPropertyMeta = {
  effectId: string;
  bandId: string;
  paramName: string;
  frequencyHz: number;
  label: string;
  paramOrder: number;
};

const LEGACY_EQ_FREQUENCY_BY_ID = new Map(AUDIO_EQ_LEGACY_BANDS.map(band => [band.id, band.frequencyHz]));
const AUDIO_EQ_PARAM_ORDER: Record<string, number> = {
  frequencyHz: 0,
  gainDb: 1,
  q: 2,
  slopeDbPerOct: 3,
  thresholdDb: 4,
  rangeDb: 5,
  ratio: 6,
  attackMs: 7,
  releaseMs: 8,
};

function prettifyParamName(paramName: string): string {
  return paramName
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (char) => char.toUpperCase());
}

export function parseTimelineEffectProperty(prop: string): ParsedTimelineEffectProperty | null {
  const parts = prop.split('.');
  if (parts.length < 3 || parts[0] !== 'effect') return null;
  return {
    effectId: parts[1],
    paramName: parts.slice(2).join('.'),
    paramPath: parts.slice(2),
  };
}

export function formatEqFrequencyLabel(frequencyHz: number, fallback: string): string {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) {
    return fallback;
  }
  if (frequencyHz >= 1000) {
    const khz = frequencyHz / 1000;
    return `${Number.isInteger(khz) ? khz.toFixed(0) : khz.toFixed(1)}kHz`;
  }
  return `${Math.round(frequencyHz)}Hz`;
}

function getEqParamLabel(paramName: string): string {
  const lastSegment = paramName.split('.').pop() ?? paramName;
  if (lastSegment === 'frequencyHz') return 'Freq';
  if (lastSegment === 'gainDb') return 'Gain';
  if (lastSegment === 'q') return 'Q';
  if (lastSegment === 'thresholdDb') return 'Threshold';
  if (lastSegment === 'rangeDb') return 'Range';
  if (lastSegment === 'ratio') return 'Ratio';
  if (lastSegment === 'attackMs') return 'Attack';
  if (lastSegment === 'releaseMs') return 'Release';
  if (lastSegment === 'slopeDbPerOct') return 'Slope';
  return prettifyParamName(lastSegment);
}

export function getDefaultAudioEqTimelineValue(paramName: string, fallbackFrequencyHz: number): number {
  if (paramName.endsWith('frequencyHz')) return fallbackFrequencyHz || 1000;
  if (paramName.endsWith('gainDb')) return 0;
  if (paramName.endsWith('q')) return 1;
  if (paramName.endsWith('dynamic.thresholdDb')) return AUDIO_EQ_DEFAULT_BAND_DYNAMICS.thresholdDb;
  if (paramName.endsWith('dynamic.rangeDb')) return AUDIO_EQ_DEFAULT_BAND_DYNAMICS.rangeDb;
  if (paramName.endsWith('dynamic.ratio')) return AUDIO_EQ_DEFAULT_BAND_DYNAMICS.ratio;
  if (paramName.endsWith('dynamic.attackMs')) return AUDIO_EQ_DEFAULT_BAND_DYNAMICS.attackMs;
  if (paramName.endsWith('dynamic.releaseMs')) return AUDIO_EQ_DEFAULT_BAND_DYNAMICS.releaseMs;
  if (paramName.endsWith('spectralDynamics.thresholdDb')) return AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.thresholdDb;
  if (paramName.endsWith('spectralDynamics.rangeDb')) return AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.rangeDb;
  if (paramName.endsWith('spectralDynamics.ratio')) return AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.ratio;
  if (paramName.endsWith('spectralDynamics.attackMs')) return AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.attackMs;
  if (paramName.endsWith('spectralDynamics.releaseMs')) return AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.releaseMs;
  return 0;
}

export function getAudioEqPropertyMeta(prop: string, clip?: TimelineHeaderEffectClip | null): AudioEqPropertyMeta | null {
  const effectProperty = parseTimelineEffectProperty(prop);
  if (!effectProperty) return null;
  const [root, audible, bands, bandId, ...paramPath] = effectProperty.paramPath;
  if (root !== 'eq' || audible !== 'audible' || bands !== 'bands' || !bandId || paramPath.length === 0) {
    return null;
  }

  const effect = clip?.effects?.find(candidate => candidate.id === effectProperty.effectId);
  const normalized = effect ? normalizeAudioEqParams(effect.params) : null;
  const band = normalized?.audible.bands.find(candidate => candidate.id === bandId);
  const frequencyHz = band?.frequencyHz ?? LEGACY_EQ_FREQUENCY_BY_ID.get(bandId) ?? 0;
  const paramName = paramPath.join('.');
  const label = `${formatEqFrequencyLabel(frequencyHz, bandId)} ${getEqParamLabel(paramName)}`;

  return {
    effectId: effectProperty.effectId,
    bandId,
    paramName,
    frequencyHz,
    label,
    paramOrder: AUDIO_EQ_PARAM_ORDER[paramPath[paramPath.length - 1] ?? paramName] ?? 100,
  };
}

export function getValueFromEffects(
  effects: Array<{ id: string; type: string; name: string; params: Record<string, unknown> }>,
  prop: string,
): number {
  const effectProperty = parseTimelineEffectProperty(prop);
  if (!effectProperty) return 0;

  const effect = effects.find(e => e.id === effectProperty.effectId);
  if (!effect) return 0;

  if (effectProperty.paramPath.length > 1) {
    const directValue = getAudioEffectParamPathValue(
      effect.params as unknown as AudioEffectParamValue,
      effectProperty.paramPath,
    );
    if (typeof directValue === 'number') return directValue;

    if (effectProperty.paramPath[0] === 'eq') {
      const normalized = normalizeAudioEqParams(effect.params);
      const normalizedValue = getAudioEffectParamPathValue(
        normalized as unknown as AudioEffectParamValue,
        effectProperty.paramPath.slice(1),
      );
      if (typeof normalizedValue === 'number') return normalizedValue;

      const eqMeta = getAudioEqPropertyMeta(prop, {
        effects,
      });
      return eqMeta ? getDefaultAudioEqTimelineValue(eqMeta.paramName, eqMeta.frequencyHz) : 0;
    }

    return 0;
  }

  const value = effect.params[effectProperty.paramName];
  return typeof value === 'number' ? value : 0;
}
