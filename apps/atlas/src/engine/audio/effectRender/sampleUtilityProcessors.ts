import { analyzeAudioBufferLoudnessSummary } from '../../../services/audio/LoudnessEnvelopeGenerator';
import {
  clamp,
  createMutableAudioBufferLike,
  dbToLinearGain,
  getBooleanEffectParam,
  getNumericEffectParam,
  getStringEffectParam,
  linearToDb,
  type RenderableAudioEffectInstance,
} from './audioEffectRenderContracts';

export function applyNormalize(
  buffer: AudioBuffer,
  effect: RenderableAudioEffectInstance,
): AudioBuffer {
  const mode = getStringEffectParam(effect, 'mode', 'peak').toLowerCase();
  const allowBoost = getBooleanEffectParam(effect, 'allowBoost', true);
  const maxGainDb = clamp(getNumericEffectParam(effect, 'maxGainDb', 24), 0, 60);
  const ceilingDb = clamp(getNumericEffectParam(effect, 'truePeakCeilingDb', -1), -60, 0);

  let currentDb = -Infinity;
  let targetDb = -Infinity;

  if (mode === 'lufs') {
    const summary = analyzeAudioBufferLoudnessSummary(buffer);
    currentDb = typeof summary.integratedLufs === 'number' ? summary.integratedLufs : -Infinity;
    targetDb = clamp(getNumericEffectParam(effect, 'targetLufs', -23), -70, 0);
  } else if (mode === 'rms') {
    currentDb = linearToDb(getBufferRms(buffer));
    targetDb = clamp(getNumericEffectParam(effect, 'targetRmsDb', -18), -90, 0);
  } else {
    currentDb = linearToDb(getBufferPeak(buffer));
    targetDb = clamp(getNumericEffectParam(effect, 'targetPeakDb', -1), -60, 0);
  }

  if (!Number.isFinite(currentDb) || currentDb <= -120 || !Number.isFinite(targetDb)) {
    return buffer;
  }

  const upperGainDb = allowBoost ? maxGainDb : 0;
  const gainDb = clamp(targetDb - currentDb, -maxGainDb, upperGainDb);
  if (Math.abs(gainDb) <= 0.05) {
    return buffer;
  }

  const output = createMutableAudioBufferLike(buffer);
  const gain = dbToLinearGain(gainDb);
  let outputPeak = 0;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel);
    const target = output.getChannelData(channel);
    for (let index = 0; index < buffer.length; index += 1) {
      const sample = (input[index] ?? 0) * gain;
      target[index] = sample;
      outputPeak = Math.max(outputPeak, Math.abs(sample));
    }
  }

  const ceiling = dbToLinearGain(ceilingDb);
  if (outputPeak > ceiling) {
    scaleBuffer(output, ceiling / outputPeak);
  }

  return output;
}

function getBufferPeak(buffer: AudioBuffer): number {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      peak = Math.max(peak, Math.abs(data[index] ?? 0));
    }
  }
  return peak;
}

function getBufferRms(buffer: AudioBuffer): number {
  let sumSquares = 0;
  let totalSamples = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      const sample = data[index] ?? 0;
      sumSquares += sample * sample;
      totalSamples += 1;
    }
  }
  return totalSamples > 0 ? Math.sqrt(sumSquares / totalSamples) : 0;
}

function scaleBuffer(buffer: AudioBuffer, gain: number): void {
  if (!Number.isFinite(gain) || Math.abs(gain - 1) <= 0.000001) return;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      data[index] *= gain;
    }
  }
}

function getChannelMode(effect: RenderableAudioEffectInstance): 'all' | 'left' | 'right' {
  const mode = effect.params?.channelMode;
  return mode === 'left' || mode === 'right' ? mode : 'all';
}

export function applyPolarityInvert(
  buffer: AudioBuffer,
  effect: RenderableAudioEffectInstance,
): AudioBuffer {
  const channelMode = getChannelMode(effect);
  const output = createMutableAudioBufferLike(buffer);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel);
    const target = output.getChannelData(channel);
    const invert =
      channelMode === 'all' ||
      (channelMode === 'left' && channel === 0) ||
      (channelMode === 'right' && channel === 1);

    for (let index = 0; index < buffer.length; index += 1) {
      const sample = input[index] ?? 0;
      target[index] = invert ? -sample : sample;
    }
  }

  return output;
}

export function applyMonoSum(buffer: AudioBuffer): AudioBuffer {
  if (buffer.numberOfChannels <= 1) {
    return buffer;
  }

  const output = createMutableAudioBufferLike(buffer);
  const sourceChannels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));

  for (let index = 0; index < buffer.length; index += 1) {
    let sum = 0;
    for (const source of sourceChannels) {
      sum += source[index] ?? 0;
    }
    const mono = sum / sourceChannels.length;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      output.getChannelData(channel)[index] = mono;
    }
  }

  return output;
}

export function applyChannelSwap(buffer: AudioBuffer): AudioBuffer {
  if (buffer.numberOfChannels < 2) {
    return buffer;
  }

  const output = createMutableAudioBufferLike(buffer);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const sourceChannel = channel === 0 ? 1 : channel === 1 ? 0 : channel;
    output.getChannelData(channel).set(buffer.getChannelData(sourceChannel));
  }

  return output;
}

export function applyStereoSplit(
  buffer: AudioBuffer,
  effect: RenderableAudioEffectInstance,
): AudioBuffer {
  if (buffer.numberOfChannels <= 0) {
    return buffer;
  }

  const sourceChannel = Math.max(
    0,
    Math.min(buffer.numberOfChannels - 1, Math.round(getNumericEffectParam(effect, 'sourceChannel', 0))),
  );
  const output = createMutableAudioBufferLike(buffer);
  const source = buffer.getChannelData(sourceChannel);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    output.getChannelData(channel).set(source);
  }

  return output;
}
