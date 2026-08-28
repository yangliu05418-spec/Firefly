import { createBuffer as createAudioBuffer } from '../../../engine/audio/audioBufferFactory';
import { finiteNumber } from './audioRenderMath';

export function reverseAudioBuffer(buffer: AudioBuffer): AudioBuffer {
  const reversed = createAudioBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    const target = reversed.getChannelData(channel);
    for (let sample = 0; sample < buffer.length; sample += 1) {
      target[sample] = source[buffer.length - 1 - sample] ?? 0;
    }
  }

  return reversed;
}

export function createSilentLike(buffer: AudioBuffer): AudioBuffer {
  return createAudioBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
}

export function cloneAudioBuffer(buffer: AudioBuffer): AudioBuffer {
  const cloned = createAudioBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    cloned.getChannelData(channel).set(buffer.getChannelData(channel));
  }
  return cloned;
}

export function createGainAdjustedBuffer(buffer: AudioBuffer, gain: number): AudioBuffer {
  if (Math.abs(gain - 1) < 0.0001) return buffer;

  const adjusted = createAudioBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    const target = adjusted.getChannelData(channel);
    for (let sample = 0; sample < buffer.length; sample += 1) {
      target[sample] = (source[sample] ?? 0) * gain;
    }
  }
  return adjusted;
}

export function resampleAudioBuffer(buffer: AudioBuffer, targetSampleRate: number): AudioBuffer {
  if (Math.abs(buffer.sampleRate - targetSampleRate) < 1) return buffer;

  const outputLength = Math.max(1, Math.round((buffer.length * targetSampleRate) / buffer.sampleRate));
  const output = createAudioBuffer(buffer.numberOfChannels, outputLength, targetSampleRate);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    const target = output.getChannelData(channel);
    for (let index = 0; index < outputLength; index += 1) {
      const sourcePosition = (index * buffer.sampleRate) / targetSampleRate;
      const leftIndex = Math.min(source.length - 1, Math.floor(sourcePosition));
      const rightIndex = Math.min(source.length - 1, leftIndex + 1);
      const mix = sourcePosition - leftIndex;
      target[index] = (source[leftIndex] ?? 0) * (1 - mix) + (source[rightIndex] ?? 0) * mix;
    }
  }

  return output;
}

function getBufferChannel(buffer: AudioBuffer, channel: number): Float32Array {
  if (channel < buffer.numberOfChannels) return buffer.getChannelData(channel);
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  return new Float32Array(buffer.length);
}

export function mixAudioBuffers(first: AudioBuffer, second: AudioBuffer): AudioBuffer {
  const sampleRate = second.sampleRate;
  const firstAtRate = resampleAudioBuffer(first, sampleRate);
  const length = Math.max(firstAtRate.length, second.length);
  const channelCount = Math.max(firstAtRate.numberOfChannels, second.numberOfChannels);
  const output = createAudioBuffer(channelCount, length, sampleRate);

  for (let channel = 0; channel < channelCount; channel += 1) {
    const target = output.getChannelData(channel);
    const firstSource = getBufferChannel(firstAtRate, channel);
    const secondSource = getBufferChannel(second, channel);
    for (let sample = 0; sample < length; sample += 1) {
      target[sample] = (firstSource[sample] ?? 0) + (secondSource[sample] ?? 0);
    }
  }

  return output;
}

export function appendSilence(buffer: AudioBuffer, tailSeconds: number): AudioBuffer {
  const tailSamples = Math.max(0, Math.ceil(finiteNumber(tailSeconds, 0) * buffer.sampleRate));
  if (tailSamples <= 0) return buffer;

  const extended = createAudioBuffer(buffer.numberOfChannels, buffer.length + tailSamples, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    extended.getChannelData(channel).set(buffer.getChannelData(channel));
  }
  return extended;
}
