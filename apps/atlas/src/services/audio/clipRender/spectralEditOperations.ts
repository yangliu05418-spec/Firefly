import type { ClipAudioRenderEditOperation } from './clipAudioRenderModels';
import { dbToLinearGain, finiteNumber, rangeFeatherFactor } from './audioRenderMath';
import { createBandpassCoefficients } from './spectralBandFilters';
import { fftRadix2, hannWindow, isPowerOfTwo, nextPowerOfTwo } from './spectralFft';

export function applySpectralBandGainRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioRenderEditOperation,
): void {
  const frequencyMinHz = finiteNumber(operation.params.frequencyMinHz, 0);
  const frequencyMaxHz = finiteNumber(operation.params.frequencyMaxHz, 0);
  const gainDb = finiteNumber(operation.params.gainDb, operation.type === 'spectral-mask' ? -18 : 6);
  const bandGain = Math.max(0, Math.min(8, dbToLinearGain(gainDb)));
  const bandDelta = bandGain - 1;
  if (range.end <= range.start || Math.abs(bandDelta) < 0.001) return;

  const coefficients = createBandpassCoefficients(buffer.sampleRate, frequencyMinHz, frequencyMaxHz);
  if (!coefficients) return;

  const featherSamples = Math.max(0, Math.min(
    Math.floor((range.end - range.start) / 2),
    Math.round(finiteNumber(operation.params.featherTime, 0.015) * buffer.sampleRate),
  ));

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;

    for (let sample = range.start; sample < range.end; sample += 1) {
      const x0 = data[sample] ?? 0;
      const band = coefficients.b0 * x0 +
        coefficients.b1 * x1 +
        coefficients.b2 * x2 -
        coefficients.a1 * y1 -
        coefficients.a2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = band;

      const distanceToEdge = Math.min(sample - range.start, range.end - 1 - sample);
      const feather = featherSamples > 0
        ? Math.max(0, Math.min(1, distanceToEdge / featherSamples))
        : 1;
      data[sample] = x0 + band * bandDelta * feather;
    }
  }
}

function chooseSpectralResynthesisFftSize(
  operation: ClipAudioRenderEditOperation,
  sampleRate: number,
  rangeLength: number,
): number {
  const requested = finiteNumber(operation.params.fftSize, Number.NaN);
  if (isPowerOfTwo(requested) && requested >= 64 && requested <= 8192) {
    return requested;
  }

  const target = nextPowerOfTwo(Math.max(64, Math.round(sampleRate * 0.046)));
  const boundedByRange = Math.max(64, Math.min(4096, nextPowerOfTwo(Math.max(64, Math.min(rangeLength, target)))));
  return boundedByRange;
}

function frequencyBandWeight(
  frequencyHz: number,
  minHz: number,
  maxHz: number,
  featherHz: number,
): number {
  if (frequencyHz < minHz - featherHz || frequencyHz > maxHz + featherHz) return 0;
  if (frequencyHz >= minHz && frequencyHz <= maxHz) return 1;
  if (featherHz <= 0) return 0;

  if (frequencyHz < minHz) {
    return Math.max(0, Math.min(1, (frequencyHz - (minHz - featherHz)) / featherHz));
  }
  return Math.max(0, Math.min(1, ((maxHz + featherHz) - frequencyHz) / featherHz));
}

function spectralBrushWeight(
  operation: ClipAudioRenderEditOperation,
  frameCenterSeconds: number,
  frequencyHz: number,
  rangeDurationSeconds: number,
  minHz: number,
  maxHz: number,
): number {
  if (operation.params.selectionMode !== 'brush') return 1;

  const timeRadiusSeconds = Math.max(
    0.001,
    finiteNumber(operation.params.brushTimeRadiusSeconds, rangeDurationSeconds / 2),
  );
  const frequencyRadiusHz = Math.max(
    1,
    finiteNumber(operation.params.brushFrequencyRadiusHz, Math.max(1, (maxHz - minHz) / 2)),
  );
  const timeCenterSeconds = rangeDurationSeconds / 2;
  const frequencyCenterHz = (minHz + maxHz) / 2;
  const normalizedTime = Math.abs(frameCenterSeconds - timeCenterSeconds) / timeRadiusSeconds;
  const normalizedFrequency = Math.abs(frequencyHz - frequencyCenterHz) / frequencyRadiusHz;
  const distance = Math.sqrt(normalizedTime * normalizedTime + normalizedFrequency * normalizedFrequency);
  if (distance >= 1) return 0;
  if (distance <= 0.55) return 1;
  const edge = (distance - 0.55) / 0.45;
  return Math.max(0, Math.min(1, 1 - edge * edge * (3 - 2 * edge)));
}

export function applySpectralResynthesisRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioRenderEditOperation,
): void {
  const rangeLength = Math.max(0, range.end - range.start);
  if (rangeLength < 4) return;

  const nyquist = buffer.sampleRate / 2;
  const frequencyMinHz = Math.max(0, Math.min(nyquist, finiteNumber(operation.params.frequencyMinHz, 0)));
  const frequencyMaxHz = Math.max(frequencyMinHz, Math.min(nyquist, finiteNumber(operation.params.frequencyMaxHz, nyquist)));
  const gainDb = finiteNumber(operation.params.gainDb, 6);
  const spectralGain = Math.max(0, Math.min(8, dbToLinearGain(gainDb)));
  const gainDelta = spectralGain - 1;
  if (frequencyMaxHz <= frequencyMinHz || Math.abs(gainDelta) < 0.001) return;

  const fftSize = chooseSpectralResynthesisFftSize(operation, buffer.sampleRate, rangeLength);
  const hopSize = Math.max(1, Math.floor(finiteNumber(operation.params.hopSize, fftSize / 4)));
  const window = hannWindow(fftSize);
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  const output = new Float32Array(rangeLength);
  const normalization = new Float32Array(rangeLength);
  const featherHz = Math.max(0, finiteNumber(operation.params.featherFrequencyHz, Math.max(12, (frequencyMaxHz - frequencyMinHz) * 0.08)));
  const rangeDurationSeconds = rangeLength / buffer.sampleRate;
  const frameStartOffset = -Math.floor(fftSize / 2);
  const frameCount = Math.max(1, Math.ceil((rangeLength - frameStartOffset) / hopSize));

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    output.fill(0);
    normalization.fill(0);

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const frameStart = frameStartOffset + frameIndex * hopSize;
      real.fill(0);
      imag.fill(0);

      for (let sampleOffset = 0; sampleOffset < fftSize; sampleOffset += 1) {
        const localIndex = frameStart + sampleOffset;
        const sample = localIndex >= 0 && localIndex < rangeLength ? data[range.start + localIndex] ?? 0 : 0;
        real[sampleOffset] = sample * window[sampleOffset];
      }

      fftRadix2(real, imag);

      const frameCenterSeconds = (frameStart + fftSize / 2) / buffer.sampleRate;
      const positiveBinCount = Math.floor(fftSize / 2);
      for (let bin = 0; bin <= positiveBinCount; bin += 1) {
        const frequencyHz = (bin * buffer.sampleRate) / fftSize;
        const bandWeight = frequencyBandWeight(frequencyHz, frequencyMinHz, frequencyMaxHz, featherHz);
        if (bandWeight <= 0) continue;
        const brushWeight = spectralBrushWeight(
          operation,
          frameCenterSeconds,
          frequencyHz,
          rangeDurationSeconds,
          frequencyMinHz,
          frequencyMaxHz,
        );
        const weight = bandWeight * brushWeight;
        if (weight <= 0) continue;

        const scale = 1 + gainDelta * weight;
        real[bin] *= scale;
        imag[bin] *= scale;

        if (bin > 0 && bin < positiveBinCount) {
          const mirror = fftSize - bin;
          real[mirror] *= scale;
          imag[mirror] *= scale;
        }
      }

      fftRadix2(real, imag, true);

      for (let sampleOffset = 0; sampleOffset < fftSize; sampleOffset += 1) {
        const localIndex = frameStart + sampleOffset;
        if (localIndex < 0 || localIndex >= rangeLength) continue;
        const windowValue = window[sampleOffset];
        output[localIndex] += real[sampleOffset] * windowValue;
        normalization[localIndex] += windowValue * windowValue;
      }
    }

    const featherSamples = Math.max(0, Math.min(
      Math.floor(rangeLength / 2),
      Math.round(finiteNumber(operation.params.featherTime, 0.015) * buffer.sampleRate),
    ));
    for (let localIndex = 0; localIndex < rangeLength; localIndex += 1) {
      const normalized = normalization[localIndex] > 0.000001
        ? output[localIndex] / normalization[localIndex]
        : data[range.start + localIndex] ?? 0;
      const blend = rangeFeatherFactor(localIndex, { start: 0, end: rangeLength }, featherSamples);
      const source = data[range.start + localIndex] ?? 0;
      data[range.start + localIndex] = source * (1 - blend) + normalized * blend;
    }
  }
}
