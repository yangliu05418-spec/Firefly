import { dbToLinearGain, finiteNumber } from '../../engine/audio/audioMath';
import type { LiveAudioRouteProcessor } from '../audio/audioGraphRouteSettings';

export function copyScrubInputToOutput(input: AudioBuffer, output: AudioBuffer): void {
  const fallbackChannel = input.numberOfChannels - 1;
  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const source = input.getChannelData(Math.max(0, Math.min(channel, fallbackChannel)));
    output.getChannelData(channel).set(source);
  }
}
export function processScrubSaturationFrame(
  input: AudioBuffer,
  output: AudioBuffer,
  processor: Extract<LiveAudioRouteProcessor, { type: 'saturation' }>,
): void {
  const driveDb = Math.max(0, Math.min(48, finiteNumber(processor.driveDb, 0)));
  const drive = dbToLinearGain(driveDb);
  const normalizer = driveDb <= 0.001 ? 1 : Math.tanh(drive) || 1;
  const mix = Math.max(0, Math.min(1, finiteNumber(processor.mix, 0)));
  const cutoff = Math.max(20, Math.min(input.sampleRate / 2 - 1, finiteNumber(processor.toneHz, 16000)));
  const toneAlpha = 1 - Math.exp(-2 * Math.PI * cutoff / input.sampleRate);
  const fallbackChannel = input.numberOfChannels - 1;

  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const source = input.getChannelData(Math.max(0, Math.min(channel, fallbackChannel)));
    const target = output.getChannelData(channel);
    let toneState = 0;

    for (let sampleIndex = 0; sampleIndex < target.length; sampleIndex += 1) {
      const dry = source[sampleIndex] ?? 0;
      const saturated = driveDb <= 0.001 ? dry : Math.tanh(dry * drive) / normalizer;
      toneState += toneAlpha * (saturated - toneState);
      target[sampleIndex] = Math.max(-1, Math.min(1, dry * (1 - mix) + toneState * mix));
    }
  }
}

export function processScrubPolarityInvertFrame(
  input: AudioBuffer,
  output: AudioBuffer,
  processor: Extract<LiveAudioRouteProcessor, { type: 'polarity-invert' }>,
): void {
  const fallbackChannel = input.numberOfChannels - 1;
  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const source = input.getChannelData(Math.max(0, Math.min(channel, fallbackChannel)));
    const target = output.getChannelData(channel);
    const invert =
      processor.channelMode === 'all' ||
      (processor.channelMode === 'left' && channel === 0) ||
      (processor.channelMode === 'right' && channel === 1);

    for (let sampleIndex = 0; sampleIndex < target.length; sampleIndex += 1) {
      const sample = source[sampleIndex] ?? 0;
      target[sampleIndex] = invert ? -sample : sample;
    }
  }
}

export function processScrubMonoSumFrame(input: AudioBuffer, output: AudioBuffer): void {
  const sourceChannels = Array.from({ length: input.numberOfChannels }, (_, channel) => input.getChannelData(channel));
  for (let sampleIndex = 0; sampleIndex < output.length; sampleIndex += 1) {
    let sum = 0;
    for (const source of sourceChannels) {
      sum += source[sampleIndex] ?? 0;
    }
    const mono = sourceChannels.length > 0 ? sum / sourceChannels.length : 0;
    for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
      output.getChannelData(channel)[sampleIndex] = mono;
    }
  }
}

export function processScrubChannelSwapFrame(input: AudioBuffer, output: AudioBuffer): void {
  const fallbackChannel = input.numberOfChannels - 1;
  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const sourceChannel = input.numberOfChannels >= 2
      ? channel === 0 ? 1 : channel === 1 ? 0 : channel
      : channel;
    const source = input.getChannelData(Math.max(0, Math.min(sourceChannel, fallbackChannel)));
    output.getChannelData(channel).set(source);
  }
}

export function processScrubDeClickFrame(
  input: AudioBuffer,
  output: AudioBuffer,
  processor: Extract<LiveAudioRouteProcessor, { type: 'de-click' }>,
): void {
  const fallbackChannel = input.numberOfChannels - 1;
  const threshold = Math.max(0.01, Math.min(1, finiteNumber(processor.threshold, 0.35)));
  const ratio = Math.max(1, finiteNumber(processor.ratio, 4));
  const mix = Math.max(0, Math.min(1, finiteNumber(processor.mix, 1)));

  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const source = input.getChannelData(Math.max(0, Math.min(channel, fallbackChannel)));
    const target = output.getChannelData(channel);
    if (target.length <= 2) {
      target.set(source);
      continue;
    }
    target[0] = source[0] ?? 0;
    target[target.length - 1] = source[target.length - 1] ?? 0;

    for (let sampleIndex = 1; sampleIndex < target.length - 1; sampleIndex += 1) {
      const previous = source[sampleIndex - 1] ?? 0;
      const dry = source[sampleIndex] ?? 0;
      const next = source[sampleIndex + 1] ?? 0;
      const prediction = (previous + next) / 2;
      const residual = Math.abs(dry - prediction);
      const neighborEnergy = (Math.abs(previous) + Math.abs(next)) / 2;
      const click = residual >= threshold && residual >= neighborEnergy * ratio;
      target[sampleIndex] = click ? dry * (1 - mix) + prediction * mix : dry;
    }
  }
}

export function processScrubStereoSplitFrame(
  input: AudioBuffer,
  output: AudioBuffer,
  processor: Extract<LiveAudioRouteProcessor, { type: 'stereo-split' }>,
): void {
  const sourceChannel = Math.max(
    0,
    Math.min(input.numberOfChannels - 1, Math.round(finiteNumber(processor.sourceChannel, 0))),
  );
  const source = input.getChannelData(sourceChannel);
  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    output.getChannelData(channel).set(source);
  }
}
