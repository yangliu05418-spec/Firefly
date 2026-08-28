import type { AudioEffectId } from '../AudioEffectRegistry';
import { createEQChain } from './eqNodeRenderer';
import {
  AUDIO_COMPRESSOR_EFFECT_ID,
  AUDIO_DE_ESSER_EFFECT_ID,
  AUDIO_EQ_EFFECT_ID,
  AUDIO_HIGH_PASS_EFFECT_ID,
  AUDIO_HUM_NOTCH_EFFECT_ID,
  AUDIO_LOW_PASS_EFFECT_ID,
  AUDIO_PAN_EFFECT_ID,
  AUDIO_PARAMETRIC_EQ_EFFECT_ID,
  AUDIO_VOLUME_EFFECT_ID,
  AUDIO_VOLUME_PARAM,
  automateEffectParam,
  automateParam,
  clamp,
  clampPan,
  dbToLinearGain,
  getNumericEffectParam,
  getNumericEffectParamDefault,
  hasEffectParamKeyframes,
  type EffectRenderKeyframe,
  type RenderableAudioEffectInstance,
} from './audioEffectRenderContracts';

export async function renderOfflineNodeEffects(
  buffer: AudioBuffer,
  effects: readonly RenderableAudioEffectInstance[],
  keyframes: EffectRenderKeyframe[],
  duration: number,
): Promise<AudioBuffer> {
  const offlineContext = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );

  const source = offlineContext.createBufferSource();
  source.buffer = buffer;

  let currentNode: AudioNode = source;

  for (const effect of effects) {
    switch (effect.descriptorId) {
      case AUDIO_EQ_EFFECT_ID:
        currentNode = createEQChain(offlineContext, currentNode, effect, keyframes, duration);
        break;
      case AUDIO_PARAMETRIC_EQ_EFFECT_ID:
        currentNode = createParametricEQNode(offlineContext, currentNode, effect, keyframes, duration);
        break;
      case AUDIO_VOLUME_EFFECT_ID:
        currentNode = createGainNode(offlineContext, currentNode, effect, keyframes, duration);
        break;
      case AUDIO_PAN_EFFECT_ID:
        currentNode = createPanNode(offlineContext, currentNode, effect, keyframes, duration);
        break;
      case AUDIO_HIGH_PASS_EFFECT_ID:
        currentNode = createFilterNode(offlineContext, currentNode, effect, 'highpass', keyframes, duration);
        break;
      case AUDIO_LOW_PASS_EFFECT_ID:
        currentNode = createFilterNode(offlineContext, currentNode, effect, 'lowpass', keyframes, duration);
        break;
      case AUDIO_HUM_NOTCH_EFFECT_ID:
        currentNode = createHumNotchChain(offlineContext, currentNode, effect, keyframes, duration);
        break;
      case AUDIO_COMPRESSOR_EFFECT_ID:
        currentNode = createCompressorChain(offlineContext, currentNode, effect, keyframes, duration);
        break;
      case AUDIO_DE_ESSER_EFFECT_ID:
        currentNode = createDeEsserChain(offlineContext, currentNode, effect, keyframes, duration);
        break;
    }
  }

  currentNode.connect(offlineContext.destination);
  source.start(0);
  return offlineContext.startRendering();
}

function createParametricEQNode(
  context: OfflineAudioContext,
  inputNode: AudioNode,
  eqEffect: RenderableAudioEffectInstance,
  keyframes: EffectRenderKeyframe[],
  duration: number,
): AudioNode {
  const filter = context.createBiquadFilter();
  filter.type = 'peaking';
  const frequency = getNumericEffectParam(eqEffect, 'frequencyHz', 1000);
  const gain = getNumericEffectParam(eqEffect, 'gainDb', 0);
  const q = getNumericEffectParam(eqEffect, 'q', 1);

  automateEffectParam(filter.frequency, eqEffect, 'frequencyHz', frequency, keyframes, duration);
  automateEffectParam(filter.gain, eqEffect, 'gainDb', gain, keyframes, duration);
  automateEffectParam(filter.Q, eqEffect, 'q', q, keyframes, duration);

  inputNode.connect(filter);
  return filter;
}

function createFilterNode(
  context: OfflineAudioContext,
  inputNode: AudioNode,
  filterEffect: RenderableAudioEffectInstance,
  type: BiquadFilterType,
  keyframes: EffectRenderKeyframe[],
  duration: number,
): AudioNode {
  const filter = context.createBiquadFilter();
  filter.type = type;
  const effectId = filterEffect.descriptorId as AudioEffectId;
  const defaultFrequency = getNumericEffectParamDefault(effectId, 'frequencyHz', type === 'highpass' ? 20 : 22000);
  const defaultQ = getNumericEffectParamDefault(effectId, 'q', 0.707);
  const frequency = getNumericEffectParam(filterEffect, 'frequencyHz', defaultFrequency);
  const q = getNumericEffectParam(filterEffect, 'q', defaultQ);

  automateEffectParam(filter.frequency, filterEffect, 'frequencyHz', frequency, keyframes, duration);
  automateEffectParam(filter.Q, filterEffect, 'q', q, keyframes, duration);

  inputNode.connect(filter);
  return filter;
}

function createHumNotchChain(
  context: OfflineAudioContext,
  inputNode: AudioNode,
  humEffect: RenderableAudioEffectInstance,
  keyframes: EffectRenderKeyframe[],
  duration: number,
): AudioNode {
  const nyquist = Math.max(20, context.sampleRate / 2 - 1);
  const baseFrequency = clamp(getNumericEffectParam(humEffect, 'frequencyHz', 50), 20, nyquist);
  const q = clamp(getNumericEffectParam(humEffect, 'q', 30), 1, 80);
  const harmonicCount = Math.max(1, Math.min(8, Math.round(getNumericEffectParam(humEffect, 'harmonics', 2))));
  const mix = clamp(getNumericEffectParam(humEffect, 'mix', 1), 0, 1);
  const activeHarmonics = Array.from({ length: harmonicCount }, (_, index) => index + 1)
    .filter(harmonic => baseFrequency * harmonic < nyquist);

  if (activeHarmonics.length === 0) {
    return inputNode;
  }

  const dryGain = context.createGain();
  const wetGain = context.createGain();
  const output = context.createGain();
  const filters = activeHarmonics.map(harmonic => {
    const filter = context.createBiquadFilter();
    filter.type = 'notch';
    automateEffectParam(
      filter.frequency,
      humEffect,
      'frequencyHz',
      clamp(baseFrequency * harmonic, 20, nyquist),
      keyframes,
      duration,
      value => clamp(value * harmonic, 20, nyquist),
    );
    automateEffectParam(
      filter.Q,
      humEffect,
      'q',
      q,
      keyframes,
      duration,
      value => clamp(value, 1, 80),
    );
    return filter;
  });

  automateEffectParam(
    dryGain.gain,
    humEffect,
    'mix',
    1 - mix,
    keyframes,
    duration,
    value => 1 - clamp(value, 0, 1),
  );
  automateEffectParam(
    wetGain.gain,
    humEffect,
    'mix',
    mix,
    keyframes,
    duration,
    value => clamp(value, 0, 1),
  );

  inputNode.connect(dryGain);
  dryGain.connect(output);
  inputNode.connect(filters[0]);
  for (let index = 0; index < filters.length - 1; index += 1) {
    filters[index].connect(filters[index + 1]);
  }
  filters[filters.length - 1].connect(wetGain);
  wetGain.connect(output);

  return output;
}

function createCompressorChain(
  context: OfflineAudioContext,
  inputNode: AudioNode,
  compressorEffect: RenderableAudioEffectInstance,
  keyframes: EffectRenderKeyframe[],
  duration: number,
): AudioNode {
  const compressor = context.createDynamicsCompressor();
  const threshold = getNumericEffectParam(compressorEffect, 'thresholdDb', 0);
  const ratio = getNumericEffectParam(compressorEffect, 'ratio', 1);
  const knee = getNumericEffectParam(compressorEffect, 'kneeDb', 0);
  const attackSeconds = getNumericEffectParam(compressorEffect, 'attackMs', 10) / 1000;
  const releaseSeconds = getNumericEffectParam(compressorEffect, 'releaseMs', 120) / 1000;

  automateEffectParam(compressor.threshold, compressorEffect, 'thresholdDb', threshold, keyframes, duration);
  automateEffectParam(compressor.ratio, compressorEffect, 'ratio', ratio, keyframes, duration);
  automateEffectParam(compressor.knee, compressorEffect, 'kneeDb', knee, keyframes, duration);
  automateEffectParam(compressor.attack, compressorEffect, 'attackMs', attackSeconds, keyframes, duration, value => value / 1000);
  automateEffectParam(compressor.release, compressorEffect, 'releaseMs', releaseSeconds, keyframes, duration, value => value / 1000);

  inputNode.connect(compressor);

  const makeupGainDb = getNumericEffectParam(compressorEffect, 'makeupGainDb', 0);
  if (Math.abs(makeupGainDb) <= 0.001 && !hasEffectParamKeyframes(keyframes, compressorEffect.id, 'makeupGainDb')) {
    return compressor;
  }

  const makeupGain = context.createGain();
  automateEffectParam(
    makeupGain.gain,
    compressorEffect,
    'makeupGainDb',
    dbToLinearGain(makeupGainDb),
    keyframes,
    duration,
    dbToLinearGain,
  );
  compressor.connect(makeupGain);
  return makeupGain;
}

function createDeEsserChain(
  context: OfflineAudioContext,
  inputNode: AudioNode,
  deEsserEffect: RenderableAudioEffectInstance,
  keyframes: EffectRenderKeyframe[],
  duration: number,
): AudioNode {
  const splitFrequency = getNumericEffectParam(deEsserEffect, 'frequencyHz', 6500);
  const threshold = getNumericEffectParam(deEsserEffect, 'thresholdDb', 0);
  const ratio = getNumericEffectParam(deEsserEffect, 'ratio', 1);
  const knee = getNumericEffectParam(deEsserEffect, 'kneeDb', 6);
  const attackSeconds = getNumericEffectParam(deEsserEffect, 'attackMs', 1) / 1000;
  const releaseSeconds = getNumericEffectParam(deEsserEffect, 'releaseMs', 80) / 1000;
  const makeupGainDb = getNumericEffectParam(deEsserEffect, 'makeupGainDb', 0);
  const lowBand = context.createBiquadFilter();
  const highBand = context.createBiquadFilter();
  const compressor = context.createDynamicsCompressor();
  const makeupGain = context.createGain();
  const output = context.createGain();

  lowBand.type = 'lowpass';
  lowBand.Q.value = 0.707;
  highBand.type = 'highpass';
  highBand.Q.value = 0.707;

  automateEffectParam(lowBand.frequency, deEsserEffect, 'frequencyHz', splitFrequency, keyframes, duration);
  automateEffectParam(highBand.frequency, deEsserEffect, 'frequencyHz', splitFrequency, keyframes, duration);
  automateEffectParam(compressor.threshold, deEsserEffect, 'thresholdDb', threshold, keyframes, duration);
  automateEffectParam(compressor.ratio, deEsserEffect, 'ratio', ratio, keyframes, duration);
  automateEffectParam(compressor.knee, deEsserEffect, 'kneeDb', knee, keyframes, duration);
  automateEffectParam(compressor.attack, deEsserEffect, 'attackMs', attackSeconds, keyframes, duration, value => value / 1000);
  automateEffectParam(compressor.release, deEsserEffect, 'releaseMs', releaseSeconds, keyframes, duration, value => value / 1000);
  automateEffectParam(
    makeupGain.gain,
    deEsserEffect,
    'makeupGainDb',
    dbToLinearGain(makeupGainDb),
    keyframes,
    duration,
    dbToLinearGain,
  );

  inputNode.connect(lowBand);
  inputNode.connect(highBand);
  lowBand.connect(output);
  highBand.connect(compressor);
  compressor.connect(makeupGain);
  makeupGain.connect(output);

  return output;
}

function createGainNode(
  context: OfflineAudioContext,
  inputNode: AudioNode,
  volumeEffect: RenderableAudioEffectInstance,
  keyframes: EffectRenderKeyframe[],
  duration: number
): AudioNode {
  const gainNode = context.createGain();

  // Get default volume
  const defaultVolume = (volumeEffect.params?.[AUDIO_VOLUME_PARAM] as number) ??
    getNumericEffectParamDefault(AUDIO_VOLUME_EFFECT_ID, AUDIO_VOLUME_PARAM, 1);

  // Get keyframes for volume
  const property = `effect.${volumeEffect.id}.${AUDIO_VOLUME_PARAM}` as string;
  const volumeKeyframes = keyframes.filter(k => k.property === property);

  if (volumeKeyframes.length > 0) {
    // Automate the gain parameter
    automateParam(gainNode.gain, volumeKeyframes, defaultVolume, duration);
  } else {
    // Set constant value
    gainNode.gain.value = defaultVolume;
  }

  inputNode.connect(gainNode);
  return gainNode;
}

function createPanNode(
  context: OfflineAudioContext,
  inputNode: AudioNode,
  panEffect: RenderableAudioEffectInstance,
  keyframes: EffectRenderKeyframe[],
  duration: number
): AudioNode {
  const panNode = context.createStereoPanner();
  const pan = clampPan(getNumericEffectParam(panEffect, 'pan', 0));
  automateEffectParam(panNode.pan, panEffect, 'pan', pan, keyframes, duration, clampPan);
  inputNode.connect(panNode);
  return panNode;
}

export async function applyStaticEQ(
  buffer: AudioBuffer,
  gains: number[],
  frequencies: readonly number[],
): Promise<AudioBuffer> {
  if (gains.every(g => Math.abs(g) < 0.01)) {
    return buffer;
  }

  const offlineContext = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );

  const source = offlineContext.createBufferSource();
  source.buffer = buffer;

  const filters = frequencies.map((freq, i) => {
    const filter = offlineContext.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = freq;
    filter.Q.value = 1.4;
    filter.gain.value = gains[i] ?? 0;
    return filter;
  });

  source.connect(filters[0]);
  for (let i = 0; i < filters.length - 1; i++) {
    filters[i].connect(filters[i + 1]);
  }
  filters[filters.length - 1].connect(offlineContext.destination);

  source.start(0);
  return await offlineContext.startRendering();
}
