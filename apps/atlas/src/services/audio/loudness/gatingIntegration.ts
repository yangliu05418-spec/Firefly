import {
  average,
  amplitudeToDbfs,
  LUFS_SILENCE_FLOOR,
  pointCountFor,
  powerToLufs,
  RMS_SILENCE_FLOOR_DBFS,
  safeSample,
} from './loudnessMath';

export function computeIntegratedLufs(
  weightedPowerPrefix: Float64Array,
  bufferLength: number,
  sampleRate: number,
): number {
  const blockDuration = 0.4;
  const hopDuration = 0.1;
  const windowSamples = Math.max(1, Math.round(blockDuration * sampleRate));
  const hopSamples = Math.max(1, Math.round(hopDuration * sampleRate));
  const pointCount = pointCountFor(bufferLength, sampleRate, hopDuration);
  const blocks: Array<{ power: number; loudness: number }> = [];

  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const start = pointIndex * hopSamples;
    const end = Math.min(bufferLength, start + windowSamples);
    const count = Math.max(0, end - start);
    const power = count > 0
      ? ((weightedPowerPrefix[end] ?? 0) - (weightedPowerPrefix[start] ?? 0)) / count
      : 0;
    blocks.push({ power, loudness: powerToLufs(power) });
  }

  const absoluteGated = blocks.filter(block => block.loudness >= -70);
  if (absoluteGated.length === 0) {
    return LUFS_SILENCE_FLOOR;
  }

  const preliminary = powerToLufs(average(absoluteGated.map(block => block.power)));
  const relativeGate = preliminary - 10;
  const gated = absoluteGated.filter(block => block.loudness >= relativeGate);
  if (gated.length === 0) {
    return preliminary;
  }

  return powerToLufs(average(gated.map(block => block.power)));
}

export function computeRawRmsDbfs(buffer: AudioBuffer): number {
  let squareSum = 0;
  let sampleCount = 0;
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const data = buffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex += 1) {
      const sample = safeSample(data[sampleIndex] ?? 0);
      squareSum += sample * sample;
      sampleCount += 1;
    }
  }

  return sampleCount > 0 ? amplitudeToDbfs(Math.sqrt(squareSum / sampleCount)) : RMS_SILENCE_FLOOR_DBFS;
}

export function computeSamplePeakDbfs(rawPeak: Float32Array): number {
  let peak = 0;
  for (const sample of rawPeak) {
    peak = Math.max(peak, sample);
  }
  return amplitudeToDbfs(peak);
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1
    + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

export function computePreviewTruePeakDbtp(buffer: AudioBuffer, oversample = 4): number {
  let peak = 0;

  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const data = buffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex += 1) {
      const p0 = safeSample(data[Math.max(0, sampleIndex - 1)] ?? 0);
      const p1 = safeSample(data[sampleIndex] ?? 0);
      const p2 = safeSample(data[Math.min(buffer.length - 1, sampleIndex + 1)] ?? 0);
      const p3 = safeSample(data[Math.min(buffer.length - 1, sampleIndex + 2)] ?? 0);
      peak = Math.max(peak, Math.abs(p1));

      for (let step = 1; step < oversample; step += 1) {
        peak = Math.max(peak, Math.abs(catmullRom(p0, p1, p2, p3, step / oversample)));
      }
    }
  }

  return amplitudeToDbfs(peak);
}
