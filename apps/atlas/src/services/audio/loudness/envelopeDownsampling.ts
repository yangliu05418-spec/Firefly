import {
  amplitudeToDbfs,
  createPowerPrefix,
  pointCountFor,
  powerToLufs,
  safeSample,
} from './loudnessMath';

export function createRawMonoMix(buffer: AudioBuffer): Float32Array {
  const mix = new Float32Array(buffer.length);
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const data = buffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex += 1) {
      mix[sampleIndex] += safeSample(data[sampleIndex] ?? 0) / buffer.numberOfChannels;
    }
  }
  return mix;
}

export function createRawPeakEnvelope(buffer: AudioBuffer): Float32Array {
  const peak = new Float32Array(buffer.length);
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const data = buffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex += 1) {
      peak[sampleIndex] = Math.max(peak[sampleIndex], Math.abs(safeSample(data[sampleIndex] ?? 0)));
    }
  }
  return peak;
}

export function createPowerLoudnessCurve(input: {
  weightedPowerPrefix: Float64Array;
  bufferLength: number;
  sampleRate: number;
  windowDuration: number;
  hopDuration: number;
}): Float32Array {
  const windowSamples = Math.max(1, Math.round(input.windowDuration * input.sampleRate));
  const hopSamples = Math.max(1, Math.round(input.hopDuration * input.sampleRate));
  const pointCount = pointCountFor(input.bufferLength, input.sampleRate, input.hopDuration);
  const values = new Float32Array(pointCount);

  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const start = pointIndex * hopSamples;
    const end = Math.min(input.bufferLength, start + windowSamples);
    const count = Math.max(0, end - start);
    const power = count > 0
      ? ((input.weightedPowerPrefix[end] ?? 0) - (input.weightedPowerPrefix[start] ?? 0)) / count
      : 0;
    values[pointIndex] = powerToLufs(power);
  }

  return values;
}

export function createRmsCurve(input: {
  rawSquarePrefix: Float64Array;
  bufferLength: number;
  sampleRate: number;
  windowDuration: number;
  hopDuration: number;
}): Float32Array {
  const windowSamples = Math.max(1, Math.round(input.windowDuration * input.sampleRate));
  const hopSamples = Math.max(1, Math.round(input.hopDuration * input.sampleRate));
  const pointCount = pointCountFor(input.bufferLength, input.sampleRate, input.hopDuration);
  const values = new Float32Array(pointCount);

  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const start = pointIndex * hopSamples;
    const end = Math.min(input.bufferLength, start + windowSamples);
    const count = Math.max(0, end - start);
    const meanSquare = count > 0
      ? ((input.rawSquarePrefix[end] ?? 0) - (input.rawSquarePrefix[start] ?? 0)) / count
      : 0;
    values[pointIndex] = amplitudeToDbfs(Math.sqrt(meanSquare));
  }

  return values;
}

export function createSamplePeakCurve(input: {
  rawPeak: Float32Array;
  bufferLength: number;
  sampleRate: number;
  windowDuration: number;
  hopDuration: number;
}): Float32Array {
  const windowSamples = Math.max(1, Math.round(input.windowDuration * input.sampleRate));
  const hopSamples = Math.max(1, Math.round(input.hopDuration * input.sampleRate));
  const pointCount = pointCountFor(input.bufferLength, input.sampleRate, input.hopDuration);
  const values = new Float32Array(pointCount);

  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const start = pointIndex * hopSamples;
    const end = Math.min(input.bufferLength, start + windowSamples);
    let peak = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      peak = Math.max(peak, input.rawPeak[sampleIndex] ?? 0);
    }
    values[pointIndex] = amplitudeToDbfs(peak);
  }

  return values;
}

export function createRawSquarePrefix(mix: Float32Array): Float64Array {
  const squares = new Float64Array(mix.length);
  for (let index = 0; index < mix.length; index += 1) {
    const sample = mix[index] ?? 0;
    squares[index] = sample * sample;
  }
  return createPowerPrefix(squares);
}
