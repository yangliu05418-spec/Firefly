import type { ClipAudioRenderClip, ClipAudioRenderSpectralImageLayer, ClipAudioRenderSpectralImageLayerMask } from './clipAudioRenderModels';
import { dbToLinearGain, finiteNumber, rangeFeatherFactor } from './audioRenderMath';
import { createBandpassCoefficients } from './spectralBandFilters';
import { fftRadix2, hannWindow, nextPowerOfTwo } from './spectralFft';

const SPECTRAL_IMAGE_LAYER_SUBBANDS = 16;

type ClipAudioRenderSpectralImageLayerAutomatedProperty = 'opacity' | 'gainDb' | 'frequencyMin' | 'frequencyMax';

interface ClipAudioRenderSpectralImageLayerRenderState {
  opacity: number;
  gainDb: number;
  frequencyMin: number;
  frequencyMax: number;
}

interface ClipAudioRenderSpectralImageLayerAutomationPoint {
  time: number;
  value: number;
}

type ClipAudioRenderSpectralImageLayerAutomationTracks = Partial<Record<ClipAudioRenderSpectralImageLayerAutomatedProperty, ClipAudioRenderSpectralImageLayerAutomationPoint[]>>;

export function isSpectralLayerEnabled(layer: ClipAudioRenderSpectralImageLayer & { enabled?: boolean }): boolean {
  const hasAudibleKeyframe = (layer.keyframes ?? []).some(keyframe =>
    typeof keyframe.opacity === 'number' ? keyframe.opacity > 0 : false
  );
  return layer.enabled !== false && layer.duration > 0 && (layer.opacity > 0 || hasAudibleKeyframe);
}

function createSpectralLayerSampleRange(
  layer: ClipAudioRenderSpectralImageLayer,
  clip: ClipAudioRenderClip,
  buffer: AudioBuffer,
): { start: number; end: number } {
  const clipSourceStart = Math.max(0, finiteNumber(clip.inPoint, 0));
  const localStartSeconds = Math.max(0, layer.timeStart - clipSourceStart);
  const localEndSeconds = Math.max(localStartSeconds, layer.timeStart + layer.duration - clipSourceStart);
  const start = Math.max(0, Math.min(buffer.length, Math.floor(localStartSeconds * buffer.sampleRate)));
  const end = Math.max(start, Math.min(buffer.length, Math.ceil(localEndSeconds * buffer.sampleRate)));
  return { start, end };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sampleSpectralImageMaskPixel(mask: ClipAudioRenderSpectralImageLayerMask, x: number, y: number): number {
  const index = y * mask.width + x;
  const luminance = Math.max(0, Math.min(1, mask.luminance[index] ?? 0));
  const alpha = mask.alpha ? Math.max(0, Math.min(1, mask.alpha[index] ?? 1)) : 1;
  return luminance * alpha;
}

function sampleSpectralImageMask(mask: ClipAudioRenderSpectralImageLayerMask, xUnit: number, yUnit: number): number {
  if (mask.width <= 1 && mask.height <= 1) {
    return sampleSpectralImageMaskPixel(mask, 0, 0);
  }

  const xFloat = clamp01(xUnit) * Math.max(0, mask.width - 1);
  const yFloat = clamp01(yUnit) * Math.max(0, mask.height - 1);
  const x0 = Math.max(0, Math.min(mask.width - 1, Math.floor(xFloat)));
  const y0 = Math.max(0, Math.min(mask.height - 1, Math.floor(yFloat)));
  const x1 = Math.max(0, Math.min(mask.width - 1, x0 + 1));
  const y1 = Math.max(0, Math.min(mask.height - 1, y0 + 1));
  const tx = xFloat - x0;
  const ty = yFloat - y0;

  const top = sampleSpectralImageMaskPixel(mask, x0, y0) * (1 - tx) +
    sampleSpectralImageMaskPixel(mask, x1, y0) * tx;
  const bottom = sampleSpectralImageMaskPixel(mask, x0, y1) * (1 - tx) +
    sampleSpectralImageMaskPixel(mask, x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

function createSpectralLayerAutomationTracks(layer: ClipAudioRenderSpectralImageLayer): ClipAudioRenderSpectralImageLayerAutomationTracks {
  const tracks: ClipAudioRenderSpectralImageLayerAutomationTracks = {};
  for (const property of ['opacity', 'gainDb', 'frequencyMin', 'frequencyMax'] as const) {
    const points = (layer.keyframes ?? [])
      .filter(keyframe => typeof keyframe[property] === 'number' && Number.isFinite(keyframe[property]))
      .map(keyframe => ({
        time: keyframe.time,
        value: finiteNumber(keyframe[property], 0),
      }))
      .toSorted((a, b) => a.time - b.time);
    if (points.length > 0) {
      tracks[property] = points;
    }
  }
  return tracks;
}

function interpolateSpectralLayerProperty(
  tracks: ClipAudioRenderSpectralImageLayerAutomationTracks,
  property: ClipAudioRenderSpectralImageLayerAutomatedProperty,
  localTimeSeconds: number,
  fallback: number,
): number {
  const keyframes = tracks[property];
  if (!keyframes?.length) return fallback;

  const first = keyframes[0];
  const firstValue = first.value;
  if (localTimeSeconds <= first.time || keyframes.length === 1) return firstValue;

  const last = keyframes[keyframes.length - 1];
  const lastValue = last.value;
  if (localTimeSeconds >= last.time) return lastValue;

  for (let index = 1; index < keyframes.length; index += 1) {
    const prev = keyframes[index - 1];
    const next = keyframes[index];
    if (localTimeSeconds > next.time) continue;

    const span = Math.max(0.0001, next.time - prev.time);
    const mix = clamp01((localTimeSeconds - prev.time) / span);
    return prev.value + (next.value - prev.value) * mix;
  }

  return fallback;
}

function evaluateSpectralLayerRenderState(
  layer: ClipAudioRenderSpectralImageLayer,
  automationTracks: ClipAudioRenderSpectralImageLayerAutomationTracks,
  localTimeSeconds: number,
  nyquist: number,
): ClipAudioRenderSpectralImageLayerRenderState {
  const rawMin = interpolateSpectralLayerProperty(automationTracks, 'frequencyMin', localTimeSeconds, layer.frequencyMin);
  const rawMax = interpolateSpectralLayerProperty(automationTracks, 'frequencyMax', localTimeSeconds, layer.frequencyMax);
  const frequencyMin = Math.max(20, Math.min(nyquist - 1, Math.min(rawMin, rawMax)));
  const frequencyMax = Math.max(frequencyMin + 1, Math.min(nyquist - 1, Math.max(rawMin, rawMax)));

  return {
    opacity: clamp01(interpolateSpectralLayerProperty(automationTracks, 'opacity', localTimeSeconds, layer.opacity)),
    gainDb: Math.max(-60, Math.min(24, interpolateSpectralLayerProperty(automationTracks, 'gainDb', localTimeSeconds, layer.gainDb))),
    frequencyMin,
    frequencyMax,
  };
}

function spectralImageLayerFrequencyUnion(
  layer: ClipAudioRenderSpectralImageLayer,
  nyquist: number,
): { minHz: number; maxHz: number } {
  let minHz = Math.min(layer.frequencyMin, layer.frequencyMax);
  let maxHz = Math.max(layer.frequencyMin, layer.frequencyMax);
  for (const keyframe of layer.keyframes ?? []) {
    if (typeof keyframe.frequencyMin === 'number' && Number.isFinite(keyframe.frequencyMin)) {
      minHz = Math.min(minHz, keyframe.frequencyMin);
      maxHz = Math.max(maxHz, keyframe.frequencyMin);
    }
    if (typeof keyframe.frequencyMax === 'number' && Number.isFinite(keyframe.frequencyMax)) {
      minHz = Math.min(minHz, keyframe.frequencyMax);
      maxHz = Math.max(maxHz, keyframe.frequencyMax);
    }
  }

  const clampedMinHz = Math.max(20, Math.min(nyquist - 1, minHz));
  return {
    minHz: clampedMinHz,
    maxHz: Math.max(clampedMinHz + 1, Math.min(nyquist - 1, maxHz)),
  };
}

function spectralImageLayerGainDelta(
  layer: ClipAudioRenderSpectralImageLayer,
  state: ClipAudioRenderSpectralImageLayerRenderState,
  maskStrength: number,
): number {
  const strength = Math.max(0, Math.min(1, maskStrength * state.opacity));
  if (strength <= 0) return 0;

  switch (layer.blendMode) {
    case 'boost': {
      const targetGain = dbToLinearGain(Math.abs(finiteNumber(state.gainDb, 6)));
      return (targetGain - 1) * strength;
    }
    case 'gate':
    case 'sidechain-mask': {
      return strength - 1;
    }
    case 'replace': {
      const targetGain = dbToLinearGain(finiteNumber(state.gainDb, 0)) * strength;
      return targetGain - 1;
    }
    case 'attenuate':
    default: {
      const targetGain = dbToLinearGain(-Math.abs(finiteNumber(state.gainDb, -18)));
      return (targetGain - 1) * strength;
    }
  }
}

function spectralLayerFrequencyFeather(
  frequencyHz: number,
  minHz: number,
  maxHz: number,
  featherHz: number,
): number {
  if (featherHz <= 0) return 1;
  const low = Math.max(0, Math.min(1, (frequencyHz - minHz) / featherHz));
  const high = Math.max(0, Math.min(1, (maxHz - frequencyHz) / featherHz));
  return Math.min(low, high);
}

function chooseClipAudioRenderSpectralImageLayerFftSize(sampleRate: number, rangeLength: number): number {
  const target = nextPowerOfTwo(Math.max(512, Math.round(sampleRate * 0.046)));
  const bounded = nextPowerOfTwo(Math.max(64, Math.min(rangeLength, target)));
  return Math.max(64, Math.min(4096, bounded));
}

function deterministicSpectralImagePhase(channel: number, frameIndex: number, bin: number): number {
  const seed = (channel + 1) * 1013 + frameIndex * 9176 + bin * 37;
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * Math.PI * 2;
}

function wrapRadians(phase: number): number {
  const fullTurn = Math.PI * 2;
  const wrapped = phase % fullTurn;
  return wrapped < 0 ? wrapped + fullTurn : wrapped;
}

function synthesizedSpectralImagePhase(
  channel: number,
  frameIndex: number,
  bin: number,
  hopSize: number,
  fftSize: number,
): number {
  const initialPhase = deterministicSpectralImagePhase(channel, 0, bin);
  const phaseAdvance = (Math.PI * 2 * bin * hopSize * frameIndex) / Math.max(1, fftSize);
  return wrapRadians(initialPhase + phaseAdvance);
}

function setSymmetricFftBinMagnitude(
  real: Float32Array,
  imag: Float32Array,
  bin: number,
  magnitude: number,
  phase: number,
): void {
  const clampedMagnitude = Math.max(0, magnitude);
  real[bin] = Math.cos(phase) * clampedMagnitude;
  imag[bin] = Math.sin(phase) * clampedMagnitude;

  const positiveBinCount = Math.floor(real.length / 2);
  if (bin > 0 && bin < positiveBinCount) {
    const mirror = real.length - bin;
    real[mirror] = real[bin];
    imag[mirror] = -imag[bin];
  }
}

function applySpectralImageLayerResynthesis(
  buffer: AudioBuffer,
  clip: ClipAudioRenderClip,
  layer: ClipAudioRenderSpectralImageLayer,
  mask: ClipAudioRenderSpectralImageLayerMask,
): void {
  const range = createSpectralLayerSampleRange(layer, clip, buffer);
  const rangeLength = Math.max(0, range.end - range.start);
  if (rangeLength < 4) return;

  const nyquist = Math.max(20, buffer.sampleRate / 2 - 1);
  const frequencyUnion = spectralImageLayerFrequencyUnion(layer, nyquist);
  if (frequencyUnion.maxHz <= frequencyUnion.minHz) return;

  const fftSize = chooseClipAudioRenderSpectralImageLayerFftSize(buffer.sampleRate, rangeLength);
  const hopSize = Math.max(1, Math.floor(fftSize / 4));
  const window = hannWindow(fftSize);
  const automationTracks = createSpectralLayerAutomationTracks(layer);
  const featherSamples = Math.max(0, Math.min(
    Math.floor(rangeLength / 2),
    Math.round(finiteNumber(layer.featherTime, 0) * buffer.sampleRate),
  ));
  const featherHz = Math.max(0, finiteNumber(layer.featherFrequency, 0));
  const clipSourceStart = Math.max(0, finiteNumber(clip.inPoint, 0));
  const frameStartOffset = -Math.floor(fftSize / 2);
  const frameCount = Math.max(1, Math.ceil((rangeLength - frameStartOffset) / hopSize));
  const positiveBinCount = Math.floor(fftSize / 2);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    const output = new Float32Array(rangeLength);
    const normalization = new Float32Array(rangeLength);
    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const frameStart = frameStartOffset + frameIndex * hopSize;
      real.fill(0);
      imag.fill(0);
      let framePower = 0;
      let frameSampleCount = 0;

      for (let sampleOffset = 0; sampleOffset < fftSize; sampleOffset += 1) {
        const localIndex = frameStart + sampleOffset;
        const sample = localIndex >= 0 && localIndex < rangeLength ? data[range.start + localIndex] ?? 0 : 0;
        framePower += sample * sample;
        frameSampleCount += 1;
        real[sampleOffset] = sample * window[sampleOffset];
      }

      fftRadix2(real, imag);

      const frameCenter = frameStart + fftSize / 2;
      const frameCenterSourceSeconds = clipSourceStart + (range.start + frameCenter) / buffer.sampleRate;
      const localTimeSeconds = Math.max(0, frameCenterSourceSeconds - layer.timeStart);
      const state = evaluateSpectralLayerRenderState(layer, automationTracks, localTimeSeconds, nyquist);
      const timeFeather = rangeFeatherFactor(Math.max(0, Math.min(rangeLength - 1, Math.round(frameCenter))), { start: 0, end: rangeLength }, featherSamples);
      const xUnit = clamp01(frameCenter / Math.max(1, rangeLength - 1));
      const frameRms = Math.sqrt(framePower / Math.max(1, frameSampleCount));
      const floorMagnitude = Math.max(frameRms * fftSize * 0.25, 0.0015 * fftSize);
      const sourcePhaseThreshold = Math.max(0.000001, floorMagnitude * 0.02);
      const gain = Math.max(0, Math.min(8, dbToLinearGain(state.gainDb)));

      if (state.opacity > 0 && timeFeather > 0) {
        for (let bin = 0; bin <= positiveBinCount; bin += 1) {
          const frequencyHz = (bin * buffer.sampleRate) / fftSize;
          if (frequencyHz < state.frequencyMin || frequencyHz > state.frequencyMax) continue;
          const frequencyFeather = spectralLayerFrequencyFeather(
            frequencyHz,
            state.frequencyMin,
            state.frequencyMax,
            featherHz,
          );
          if (frequencyFeather <= 0) continue;

          const activeFrequencyUnit = clamp01((frequencyHz - state.frequencyMin) / Math.max(1, state.frequencyMax - state.frequencyMin));
          const imageY = 1 - activeFrequencyUnit;
          const maskStrength = sampleSpectralImageMask(mask, xUnit, imageY);
          const strength = clamp01(maskStrength * state.opacity * timeFeather * frequencyFeather);
          if (strength <= 0) continue;

          const currentReal = real[bin] ?? 0;
          const currentImag = imag[bin] ?? 0;
          const currentMagnitude = Math.hypot(currentReal, currentImag);
          const targetMagnitude = floorMagnitude * gain * maskStrength;
          const nextMagnitude = currentMagnitude * (1 - strength) + targetMagnitude * strength;
          const phase = currentMagnitude > sourcePhaseThreshold
            ? Math.atan2(currentImag, currentReal)
            : synthesizedSpectralImagePhase(channel, frameIndex, bin, hopSize, fftSize);
          setSymmetricFftBinMagnitude(real, imag, bin, nextMagnitude, phase);
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

    for (let localIndex = 0; localIndex < rangeLength; localIndex += 1) {
      const normalized = normalization[localIndex] > 0.000001
        ? output[localIndex] / normalization[localIndex]
        : data[range.start + localIndex] ?? 0;
      data[range.start + localIndex] = normalized;
    }
  }
}

export function applySpectralImageLayer(
  buffer: AudioBuffer,
  clip: ClipAudioRenderClip,
  layer: ClipAudioRenderSpectralImageLayer,
  mask: ClipAudioRenderSpectralImageLayerMask,
): void {
  if (layer.blendMode === 'replace') {
    applySpectralImageLayerResynthesis(buffer, clip, layer, mask);
    return;
  }

  const range = createSpectralLayerSampleRange(layer, clip, buffer);
  if (range.end <= range.start) return;

  const nyquist = Math.max(20, buffer.sampleRate / 2 - 1);
  const frequencyUnion = spectralImageLayerFrequencyUnion(layer, nyquist);
  if (frequencyUnion.maxHz <= frequencyUnion.minHz) return;

  const featherSamples = Math.max(0, Math.min(
    Math.floor((range.end - range.start) / 2),
    Math.round(finiteNumber(layer.featherTime, 0) * buffer.sampleRate),
  ));
  const featherHz = Math.max(0, finiteNumber(layer.featherFrequency, 0));
  const clipSourceStart = Math.max(0, finiteNumber(clip.inPoint, 0));
  const automationTracks = createSpectralLayerAutomationTracks(layer);
  const subbandCount = Math.max(1, Math.min(
    SPECTRAL_IMAGE_LAYER_SUBBANDS,
    mask.height,
    Math.ceil((frequencyUnion.maxHz - frequencyUnion.minHz) / 120),
  ));

  for (let subband = 0; subband < subbandCount; subband += 1) {
    const subStartUnit = subband / subbandCount;
    const subEndUnit = (subband + 1) / subbandCount;
    const subMinHz = frequencyUnion.minHz + (frequencyUnion.maxHz - frequencyUnion.minHz) * subStartUnit;
    const subMaxHz = frequencyUnion.minHz + (frequencyUnion.maxHz - frequencyUnion.minHz) * subEndUnit;
    const subCenterUnit = (subStartUnit + subEndUnit) / 2;
    const subCenterHz = frequencyUnion.minHz + (frequencyUnion.maxHz - frequencyUnion.minHz) * subCenterUnit;
    const coefficients = createBandpassCoefficients(buffer.sampleRate, subMinHz, subMaxHz);
    if (!coefficients) continue;

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
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

        const sourceTimeSeconds = clipSourceStart + sample / buffer.sampleRate;
        const localTimeSeconds = Math.max(0, sourceTimeSeconds - layer.timeStart);
        const state = evaluateSpectralLayerRenderState(layer, automationTracks, localTimeSeconds, nyquist);
        if (state.opacity <= 0 || subCenterHz < state.frequencyMin || subCenterHz > state.frequencyMax) continue;

        const frequencyFeather = spectralLayerFrequencyFeather(
          subCenterHz,
          state.frequencyMin,
          state.frequencyMax,
          featherHz,
        );
        if (frequencyFeather <= 0) continue;

        const xUnit = (sample - range.start) / Math.max(1, range.end - range.start - 1);
        const activeFrequencyUnit = clamp01((subCenterHz - state.frequencyMin) / Math.max(1, state.frequencyMax - state.frequencyMin));
        const imageY = 1 - activeFrequencyUnit;
        const maskStrength = sampleSpectralImageMask(mask, xUnit, imageY);
        const timeFeather = rangeFeatherFactor(sample, range, featherSamples);
        const delta = spectralImageLayerGainDelta(layer, state, maskStrength) * timeFeather * frequencyFeather;
        data[sample] = x0 + band * delta;
      }
    }
  }
}
