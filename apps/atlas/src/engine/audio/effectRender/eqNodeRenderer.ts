import { normalizeAudioEqParams } from '../eq/AudioEqLegacy';
import type { AudioEqBand, AudioEqBandType } from '../eq/AudioEqTypes';
import {
  automateParamByProperties,
  type EffectRenderKeyframe,
  type RenderableAudioEffectInstance,
} from './audioEffectRenderContracts';

function getBiquadTypeForAudioEqBand(band: AudioEqBand): BiquadFilterType {
  const bandType: AudioEqBandType = band.type;
  switch (bandType) {
    case 'bell':
      return 'peaking';
    case 'low-shelf':
      return 'lowshelf';
    case 'high-shelf':
      return 'highshelf';
    case 'low-cut':
      return 'highpass';
    case 'high-cut':
      return 'lowpass';
    case 'notch':
      return 'notch';
    case 'band-pass':
      return 'bandpass';
    case 'all-pass':
      return 'allpass';
    case 'tilt-shelf':
      return band.gainDb >= 0 ? 'highshelf' : 'lowshelf';
    default:
      return 'peaking';
  }
}

export function createEQChain(
  context: OfflineAudioContext,
  inputNode: AudioNode,
  eqEffect: RenderableAudioEffectInstance,
  keyframes: EffectRenderKeyframe[],
  duration: number
): AudioNode {
  const eq = normalizeAudioEqParams(eqEffect.params);
  const activeBands = eq.audible.bands.filter(band => band.enabled !== false);
  if (activeBands.length === 0) {
    return inputNode;
  }

  const filters = activeBands.map((band) => {
    const filter = context.createBiquadFilter();
    filter.type = getBiquadTypeForAudioEqBand(band);
    automateParamByProperties(
      filter.frequency,
      [`effect.${eqEffect.id}.eq.audible.bands.${band.id}.frequencyHz`],
      band.frequencyHz,
      keyframes,
      duration,
      value => Math.max(20, Math.min(22000, value)),
    );
    automateParamByProperties(
      filter.Q,
      [`effect.${eqEffect.id}.eq.audible.bands.${band.id}.q`],
      band.q,
      keyframes,
      duration,
      value => Math.max(0.025, Math.min(100, value)),
    );
    automateParamByProperties(
      filter.gain,
      [
        `effect.${eqEffect.id}.eq.audible.bands.${band.id}.gainDb`,
        `effect.${eqEffect.id}.${band.id}`,
      ],
      band.gainDb,
      keyframes,
      duration,
    );

    return filter;
  });

  // Connect filters in series
  inputNode.connect(filters[0]);
  for (let i = 0; i < filters.length - 1; i++) {
    filters[i].connect(filters[i + 1]);
  }

  // Return last filter as output
  return filters[filters.length - 1];
}
