import type { AudioEvent } from '../beatOnsetManifest';
import type {
  BeatOnsetAnalysisContext,
  FluxAnalysis,
  NormalizedBeatOnsetParameters,
} from './beatOnsetAnalysisTypes';

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function safeSample(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  if (size <= 1) {
    window[0] = 1;
    return window;
  }

  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (size - 1)));
  }

  return window;
}

function fftRadix2(real: Float32Array, imag: Float32Array): void {
  const size = real.length;
  let reversed = 0;

  for (let index = 1; index < size; index += 1) {
    let bit = size >> 1;
    while ((reversed & bit) !== 0) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;

    if (index < reversed) {
      const tmpReal = real[index];
      real[index] = real[reversed];
      real[reversed] = tmpReal;
      const tmpImag = imag[index];
      imag[index] = imag[reversed];
      imag[reversed] = tmpImag;
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);

    for (let offset = 0; offset < size; offset += length) {
      let twiddleReal = 1;
      let twiddleImag = 0;

      for (let pair = 0; pair < length / 2; pair += 1) {
        const evenIndex = offset + pair;
        const oddIndex = evenIndex + length / 2;
        const oddReal = real[oddIndex] * twiddleReal - imag[oddIndex] * twiddleImag;
        const oddImag = real[oddIndex] * twiddleImag + imag[oddIndex] * twiddleReal;

        real[oddIndex] = real[evenIndex] - oddReal;
        imag[oddIndex] = imag[evenIndex] - oddImag;
        real[evenIndex] += oddReal;
        imag[evenIndex] += oddImag;

        const nextTwiddleReal = twiddleReal * stepReal - twiddleImag * stepImag;
        twiddleImag = twiddleReal * stepImag + twiddleImag * stepReal;
        twiddleReal = nextTwiddleReal;
      }
    }
  }
}

function createMonoMix(buffer: AudioBuffer): Float32Array {
  const mix = new Float32Array(buffer.length);
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const data = buffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex += 1) {
      mix[sampleIndex] += safeSample(data[sampleIndex] ?? 0) / buffer.numberOfChannels;
    }
  }
  return mix;
}

function mean(values: Float32Array): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
}

function standardDeviation(values: Float32Array, average: number): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) {
    const delta = value - average;
    sum += delta * delta;
  }
  return Math.sqrt(sum / values.length);
}

function movingAverage(values: Float32Array, radius: number): Float32Array {
  const output = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length, index + radius + 1);
    let sum = 0;
    for (let sample = start; sample < end; sample += 1) {
      sum += values[sample] ?? 0;
    }
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

export function analyzeSpectralFlux(
  buffer: AudioBuffer,
  parameters: NormalizedBeatOnsetParameters,
  context: BeatOnsetAnalysisContext,
  throwIfCancelled: (signal: AbortSignal | undefined, jobId: string) => void,
): FluxAnalysis {
  const mix = createMonoMix(buffer);
  const window = hannWindow(parameters.fftSize);
  const real = new Float32Array(parameters.fftSize);
  const imag = new Float32Array(parameters.fftSize);
  const previous = new Float32Array(parameters.fftSize / 2);
  const current = new Float32Array(parameters.fftSize / 2);
  const flux = new Float32Array(parameters.frameCount);

  for (let frameIndex = 0; frameIndex < parameters.frameCount; frameIndex += 1) {
    if (frameIndex % 64 === 0) {
      context.onProgress?.({
        jobId: context.jobId,
        mediaFileId: context.mediaFileId,
        sourceFingerprint: context.sourceFingerprint,
        onsetCacheKey: context.onsetCacheKey,
        beatCacheKey: context.beatCacheKey,
        phase: 'analyzing',
        percent: 5 + (frameIndex / parameters.frameCount) * 60,
        timestamp: new Date().toISOString(),
        frameIndex,
        frameCount: parameters.frameCount,
        message: 'Analyzing spectral flux',
      });
    }
    throwIfCancelled(context.signal, context.jobId);

    real.fill(0);
    imag.fill(0);
    const sampleStart = frameIndex * parameters.hopSize;
    for (let sampleOffset = 0; sampleOffset < parameters.fftSize; sampleOffset += 1) {
      real[sampleOffset] = (mix[sampleStart + sampleOffset] ?? 0) * (window[sampleOffset] ?? 1);
    }

    fftRadix2(real, imag);

    let frameFlux = 0;
    for (let binIndex = 0; binIndex < current.length; binIndex += 1) {
      const magnitude = Math.hypot(real[binIndex], imag[binIndex]);
      current[binIndex] = magnitude;
      frameFlux += Math.max(0, magnitude - (previous[binIndex] ?? 0));
    }
    flux[frameIndex] = frameFlux / current.length;
    previous.set(current);
  }

  const smoothed = movingAverage(flux, 2);
  const average = mean(smoothed);
  const deviation = standardDeviation(smoothed, average);
  const threshold = average + deviation * 1.15;
  let peakFlux = 0;
  for (const value of smoothed) {
    peakFlux = Math.max(peakFlux, value);
  }

  const onsets: AudioEvent[] = [];
  const minSpacingFrames = Math.max(1, Math.round(0.06 * buffer.sampleRate / parameters.hopSize));
  let lastOnsetFrame = -minSpacingFrames;
  for (let frameIndex = 1; frameIndex < smoothed.length - 1; frameIndex += 1) {
    const value = smoothed[frameIndex] ?? 0;
    if (
      value <= threshold
      || value < (smoothed[frameIndex - 1] ?? 0)
      || value < (smoothed[frameIndex + 1] ?? 0)
      || frameIndex - lastOnsetFrame < minSpacingFrames
    ) {
      continue;
    }

    const normalizedStrength = peakFlux > 0 ? value / peakFlux : 0;
    onsets.push({
      time: (frameIndex * parameters.hopSize) / buffer.sampleRate,
      strength: clamp01(normalizedStrength),
      confidence: clamp01((value - threshold) / Math.max(deviation, 1e-12)),
    });
    lastOnsetFrame = frameIndex;
  }

  return { flux: smoothed, onsets };
}
