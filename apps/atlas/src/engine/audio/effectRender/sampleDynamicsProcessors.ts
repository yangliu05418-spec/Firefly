import { createSpectralGateState, processSpectralGateBlock } from '../spectralGateProcessor';
import {
  clamp,
  createMutableAudioBufferLike,
  createNumericSampleParamReader,
  dbToLinearGain,
  getNumericEffectParam,
  hasEffectParamKeyframes,
  type EffectRenderKeyframe,
  type RenderableAudioEffectInstance,
} from './audioEffectRenderContracts';

export function applyPeakLimiter(
  buffer: AudioBuffer,
  effect: RenderableAudioEffectInstance,
  keyframes: EffectRenderKeyframe[],
): AudioBuffer {
  const readCeiling = createNumericSampleParamReader(
    effect,
    'ceilingDb',
    0,
    keyframes,
    value => Math.max(0.000001, dbToLinearGain(value)),
  );
  const readInputGain = createNumericSampleParamReader(effect, 'inputGainDb', 0, keyframes, dbToLinearGain);
  const output = createMutableAudioBufferLike(buffer);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel);
    const target = output.getChannelData(channel);
    for (let index = 0; index < buffer.length; index += 1) {
      const time = index / buffer.sampleRate;
      const ceiling = readCeiling(time);
      const inputGain = readInputGain(time);
      const value = (input[index] ?? 0) * inputGain;
      target[index] = clamp(value, -ceiling, ceiling);
    }
  }

  return output;
}

export function applyNoiseGate(
  buffer: AudioBuffer,
  effect: RenderableAudioEffectInstance,
  keyframes: EffectRenderKeyframe[],
): AudioBuffer {
  const readThreshold = createNumericSampleParamReader(effect, 'thresholdDb', -120, keyframes, dbToLinearGain);
  const readFloorGain = createNumericSampleParamReader(effect, 'floorDb', -80, keyframes, dbToLinearGain);
  const readAttackMs = createNumericSampleParamReader(
    effect,
    'attackMs',
    2,
    keyframes,
    value => Math.max(0.001, value),
  );
  const readReleaseMs = createNumericSampleParamReader(
    effect,
    'releaseMs',
    80,
    keyframes,
    value => Math.max(0.001, value),
  );
  const output = createMutableAudioBufferLike(buffer);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel);
    const target = output.getChannelData(channel);
    let gain = 1;

    for (let index = 0; index < buffer.length; index += 1) {
      const time = index / buffer.sampleRate;
      const sample = input[index] ?? 0;
      const threshold = readThreshold(time);
      const floorGain = readFloorGain(time);
      const attackCoefficient = Math.exp(-1 / (buffer.sampleRate * readAttackMs(time) / 1000));
      const releaseCoefficient = Math.exp(-1 / (buffer.sampleRate * readReleaseMs(time) / 1000));
      const targetGain = Math.abs(sample) >= threshold ? 1 : floorGain;
      const coefficient = targetGain > gain ? attackCoefficient : releaseCoefficient;
      gain = targetGain + coefficient * (gain - targetGain);
      target[index] = sample * gain;
    }
  }

  return output;
}

export function applyExpander(
  buffer: AudioBuffer,
  effect: RenderableAudioEffectInstance,
  keyframes: EffectRenderKeyframe[],
): AudioBuffer {
  const readThresholdDb = createNumericSampleParamReader(
    effect,
    'thresholdDb',
    0,
    keyframes,
    value => clamp(value, -100, 0),
  );
  const readRatio = createNumericSampleParamReader(
    effect,
    'ratio',
    1,
    keyframes,
    value => clamp(value, 1, 20),
  );
  const readRangeDb = createNumericSampleParamReader(
    effect,
    'rangeDb',
    0,
    keyframes,
    value => clamp(value, 0, 80),
  );
  const readAttackMs = createNumericSampleParamReader(
    effect,
    'attackMs',
    2,
    keyframes,
    value => Math.max(0.001, value),
  );
  const readReleaseMs = createNumericSampleParamReader(
    effect,
    'releaseMs',
    120,
    keyframes,
    value => Math.max(0.001, value),
  );
  const output = createMutableAudioBufferLike(buffer);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel);
    const target = output.getChannelData(channel);
    let gain = 1;

    for (let index = 0; index < buffer.length; index += 1) {
      const time = index / buffer.sampleRate;
      const sample = input[index] ?? 0;
      const thresholdDb = readThresholdDb(time);
      const ratio = readRatio(time);
      const rangeDb = readRangeDb(time);
      const inputDb = 20 * Math.log10(Math.max(0.000001, Math.abs(sample)));
      const reductionDb = ratio <= 1.0001 || rangeDb <= 0.0001 || inputDb >= thresholdDb
        ? 0
        : Math.min(rangeDb, (thresholdDb - inputDb) * (ratio - 1));
      const targetGain = dbToLinearGain(-reductionDb);
      const attackCoefficient = Math.exp(-1 / (buffer.sampleRate * readAttackMs(time) / 1000));
      const releaseCoefficient = Math.exp(-1 / (buffer.sampleRate * readReleaseMs(time) / 1000));
      const coefficient = targetGain < gain ? attackCoefficient : releaseCoefficient;
      gain = targetGain + coefficient * (gain - targetGain);
      target[index] = sample * gain;
    }
  }

  return output;
}

function calculateNoiseReductionTargetGain(
  envelope: number,
  thresholdDb: number,
  reductionDb: number,
  sensitivity: number,
): number {
  if (reductionDb <= 0.0001 || sensitivity <= 0.0001) {
    return 1;
  }
  const envelopeDb = 20 * Math.log10(Math.max(0.000001, envelope));
  if (envelopeDb >= thresholdDb) {
    return 1;
  }
  const reductionRatio = clamp(((thresholdDb - envelopeDb) / 48) * sensitivity, 0, 1);
  return dbToLinearGain(-reductionDb * reductionRatio);
}

export function applyNoiseReduction(
  buffer: AudioBuffer,
  effect: RenderableAudioEffectInstance,
  keyframes: EffectRenderKeyframe[],
): AudioBuffer {
  const staticReductionDb = getNumericEffectParam(effect, 'reductionDb', 0);
  const staticMix = clamp(getNumericEffectParam(effect, 'mix', 0), 0, 1);
  if (
    (staticReductionDb <= 0.0001 || staticMix <= 0.0001) &&
    !hasEffectParamKeyframes(keyframes, effect.id, 'reductionDb') &&
    !hasEffectParamKeyframes(keyframes, effect.id, 'mix')
  ) {
    return buffer;
  }

  const readThresholdDb = createNumericSampleParamReader(
    effect,
    'thresholdDb',
    -60,
    keyframes,
    value => clamp(value, -100, 0),
  );
  const readReductionDb = createNumericSampleParamReader(
    effect,
    'reductionDb',
    0,
    keyframes,
    value => clamp(value, 0, 60),
  );
  const readSensitivity = createNumericSampleParamReader(
    effect,
    'sensitivity',
    1,
    keyframes,
    value => clamp(value, 0.1, 4),
  );
  const readAttackMs = createNumericSampleParamReader(
    effect,
    'attackMs',
    5,
    keyframes,
    value => Math.max(0.001, value),
  );
  const readReleaseMs = createNumericSampleParamReader(
    effect,
    'releaseMs',
    160,
    keyframes,
    value => Math.max(0.001, value),
  );
  const readMix = createNumericSampleParamReader(
    effect,
    'mix',
    0,
    keyframes,
    value => clamp(value, 0, 1),
  );
  const output = createMutableAudioBufferLike(buffer);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel);
    const target = output.getChannelData(channel);
    let envelope = 0;
    let gain = 1;

    for (let index = 0; index < buffer.length; index += 1) {
      const time = index / buffer.sampleRate;
      const dry = input[index] ?? 0;
      const attackCoefficient = Math.exp(-1 / (buffer.sampleRate * readAttackMs(time) / 1000));
      const releaseCoefficient = Math.exp(-1 / (buffer.sampleRate * readReleaseMs(time) / 1000));
      const amplitude = Math.abs(dry);
      const envelopeCoefficient = amplitude > envelope ? attackCoefficient : releaseCoefficient;
      envelope = amplitude + envelopeCoefficient * (envelope - amplitude);
      const targetGain = calculateNoiseReductionTargetGain(
        envelope,
        readThresholdDb(time),
        readReductionDb(time),
        readSensitivity(time),
      );
      const gainCoefficient = targetGain < gain ? attackCoefficient : releaseCoefficient;
      gain = targetGain + gainCoefficient * (gain - targetGain);
      const mix = readMix(time);
      target[index] = dry * (1 - mix) + dry * gain * mix;
    }
  }

  return output;
}

export function applySpectralGate(
  buffer: AudioBuffer,
  effect: RenderableAudioEffectInstance,
  keyframes: EffectRenderKeyframe[],
): AudioBuffer {
  const staticReductionDb = getNumericEffectParam(effect, 'reductionDb', 0);
  const staticMix = clamp(getNumericEffectParam(effect, 'mix', 1), 0, 1);
  if (
    (staticReductionDb <= 0.0001 || staticMix <= 0.0001) &&
    !hasEffectParamKeyframes(keyframes, effect.id, 'reductionDb') &&
    !hasEffectParamKeyframes(keyframes, effect.id, 'mix')
  ) {
    return buffer;
  }

  const readThresholdDb = createNumericSampleParamReader(
    effect,
    'thresholdDb',
    -60,
    keyframes,
    value => clamp(value, -100, 0),
  );
  const readReductionDb = createNumericSampleParamReader(
    effect,
    'reductionDb',
    0,
    keyframes,
    value => clamp(value, 0, 80),
  );
  const readLowFrequencyHz = createNumericSampleParamReader(
    effect,
    'lowFrequencyHz',
    250,
    keyframes,
    value => clamp(value, 20, buffer.sampleRate / 2 - 20),
  );
  const readHighFrequencyHz = createNumericSampleParamReader(
    effect,
    'highFrequencyHz',
    5000,
    keyframes,
    value => clamp(value, 40, buffer.sampleRate / 2 - 1),
  );
  const readAttackMs = createNumericSampleParamReader(
    effect,
    'attackMs',
    8,
    keyframes,
    value => Math.max(0.001, value),
  );
  const readReleaseMs = createNumericSampleParamReader(
    effect,
    'releaseMs',
    180,
    keyframes,
    value => Math.max(0.001, value),
  );
  const readMix = createNumericSampleParamReader(
    effect,
    'mix',
    1,
    keyframes,
    value => clamp(value, 0, 1),
  );
  const output = createMutableAudioBufferLike(buffer);

  processSpectralGateBlock(
    buffer,
    output,
    time => ({
      thresholdDb: readThresholdDb(time),
      reductionDb: readReductionDb(time),
      lowFrequencyHz: readLowFrequencyHz(time),
      highFrequencyHz: readHighFrequencyHz(time),
      attackMs: readAttackMs(time),
      releaseMs: readReleaseMs(time),
      mix: readMix(time),
    }),
    createSpectralGateState(),
  );
  return output;
}
