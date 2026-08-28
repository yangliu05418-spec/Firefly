import { AUDIO_EQ_DEFAULT_Q, AUDIO_EQ_LEGACY_BANDS } from '../../../engine/audio/eq/AudioEqDefaults';
import { normalizeAudioEqParams } from '../../../engine/audio/eq/AudioEqLegacy';
import type { AudioEqBand } from '../../../engine/audio/eq/AudioEqTypes';
import { createNeutralEffectSettings } from './routeSettingsMath';
import type { AudioRouteEffectSettings, LiveAudioRouteProcessor } from './routeSettingsModel';

const AUDIO_EQ_GAIN_EPSILON_DB = 0.0001;
const AUDIO_EQ_PARAM_EPSILON = 0.001;

function getExactLegacyGraphicBandIndex(band: AudioEqBand): number {
  if (
    band.enabled === false ||
    band.dynamic?.enabled === true ||
    band.spectralDynamics?.enabled === true ||
    band.type !== 'bell' ||
    band.stereoMode !== 'stereo' ||
    Math.abs(band.q - AUDIO_EQ_DEFAULT_Q) > AUDIO_EQ_PARAM_EPSILON
  ) {
    return -1;
  }

  return AUDIO_EQ_LEGACY_BANDS.findIndex(legacyBand => (
    legacyBand.id === band.id &&
    Math.abs(legacyBand.frequencyHz - band.frequencyHz) <= AUDIO_EQ_PARAM_EPSILON
  ));
}

function isDynamicAudioEqGainBand(band: AudioEqBand): boolean {
  return band.dynamic?.enabled === true && (
    band.type === 'bell' ||
    band.type === 'low-shelf' ||
    band.type === 'high-shelf' ||
    band.type === 'tilt-shelf'
  );
}

function audioEqSlopeStageCount(band: AudioEqBand): number {
  if (band.brickwall === true && (band.type === 'low-cut' || band.type === 'high-cut')) {
    return 8;
  }
  const slope = Number.isFinite(band.slopeDbPerOct) ? Math.abs(band.slopeDbPerOct ?? 12) : 12;
  if (
    band.type === 'low-cut' ||
    band.type === 'high-cut' ||
    band.type === 'low-shelf' ||
    band.type === 'high-shelf'
  ) {
    return Math.max(1, Math.min(8, Math.round(slope / 12)));
  }
  return 1;
}

function cascadeLiveProcessor(
  processor: LiveAudioRouteProcessor,
  band: AudioEqBand,
): LiveAudioRouteProcessor[] {
  if (processor.type !== 'biquad-filter') return [processor];
  const stages = audioEqSlopeStageCount(band);
  if (stages <= 1) return [processor];
  return Array.from({ length: stages }, (_, index) => ({
    ...processor,
    id: `${processor.id}:stage-${index + 1}`,
    gainDb: (band.type === 'low-shelf' || band.type === 'high-shelf' || band.type === 'tilt-shelf')
      ? processor.gainDb / stages
      : processor.gainDb,
    q: Math.max(0.025, Math.min(100, processor.q * (1 + index * 0.06))),
  }));
}

function audioEqBandToLiveProcessors(band: AudioEqBand): LiveAudioRouteProcessor[] {
  if (band.enabled === false || band.stereoMode !== 'stereo') {
    return [];
  }

  if (isDynamicAudioEqGainBand(band)) {
    return [{
      id: `band:${band.id}`,
      type: 'dynamic-eq-band',
      band,
    }];
  }

  const base = {
    id: `band:${band.id}`,
    frequencyHz: band.frequencyHz,
    q: band.q,
    gainDb: band.gainDb,
  };

  if (band.type === 'bell') {
    if (Math.abs(band.gainDb) <= AUDIO_EQ_GAIN_EPSILON_DB) return [];
    return cascadeLiveProcessor({ ...base, type: 'biquad-filter', filterType: 'peaking' }, band);
  }

  if (band.type === 'low-shelf') {
    if (Math.abs(band.gainDb) <= AUDIO_EQ_GAIN_EPSILON_DB) return [];
    return cascadeLiveProcessor({ ...base, type: 'biquad-filter', filterType: 'lowshelf' }, band);
  }

  if (band.type === 'high-shelf') {
    if (Math.abs(band.gainDb) <= AUDIO_EQ_GAIN_EPSILON_DB) return [];
    return cascadeLiveProcessor({ ...base, type: 'biquad-filter', filterType: 'highshelf' }, band);
  }

  if (band.type === 'tilt-shelf') {
    if (Math.abs(band.gainDb) <= AUDIO_EQ_GAIN_EPSILON_DB) return [];
    return cascadeLiveProcessor({
      ...base,
      type: 'biquad-filter',
      filterType: band.gainDb >= 0 ? 'highshelf' : 'lowshelf',
    }, band);
  }

  if (band.type === 'low-cut') {
    return cascadeLiveProcessor({ ...base, type: 'biquad-filter', filterType: 'highpass', gainDb: 0 }, band);
  }

  if (band.type === 'high-cut') {
    return cascadeLiveProcessor({ ...base, type: 'biquad-filter', filterType: 'lowpass', gainDb: 0 }, band);
  }

  if (band.type === 'notch') {
    return [{ ...base, type: 'biquad-filter', filterType: 'notch', gainDb: 0 }];
  }

  if (band.type === 'band-pass') {
    return [{ ...base, type: 'biquad-filter', filterType: 'bandpass', gainDb: 0 }];
  }

  if (band.type === 'all-pass') {
    return [{ ...base, type: 'biquad-filter', filterType: 'allpass', gainDb: 0 }];
  }

  return [];
}

export function readAudioEqRouteSettings(params: Record<string, unknown> | undefined): AudioRouteEffectSettings {
  const settings = createNeutralEffectSettings();
  const eq = normalizeAudioEqParams(params);
  const soloBandIds = new Set(eq.display.soloBandIds ?? []);
  const soloBands = soloBandIds.size > 0
    ? eq.audible.bands.filter(band => soloBandIds.has(band.id))
    : [];
  const liveBands = soloBands.length > 0 ? soloBands : eq.audible.bands;

  for (const band of liveBands) {
    const legacyIndex = getExactLegacyGraphicBandIndex(band);
    if (legacyIndex >= 0) {
      settings.eqGains[legacyIndex] += band.gainDb;
      continue;
    }

    settings.processors.push(...audioEqBandToLiveProcessors(band));
  }

  return settings;
}
