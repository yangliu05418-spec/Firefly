import type { ClipAudioRenderEditOperation } from './clipAudioRenderModels';
import { dbToLinearGain, finiteNumber, rangeFeatherFactor } from './audioRenderMath';
import { applyNotchFilterRange } from './spectralBandFilters';

function applyHumNotchRepairRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioRenderEditOperation,
): void {
  const baseFrequencyHz = Math.max(20, finiteNumber(operation.params.baseFrequencyHz, 50));
  const harmonicCount = Math.max(1, Math.min(16, Math.round(finiteNumber(operation.params.harmonicCount, 6))));
  const q = finiteNumber(operation.params.q, 35);
  const featherSamples = Math.max(0, Math.min(
    Math.floor((range.end - range.start) / 2),
    Math.round(finiteNumber(operation.params.featherTime, 0.02) * buffer.sampleRate),
  ));

  for (let harmonic = 1; harmonic <= harmonicCount; harmonic += 1) {
    const frequencyHz = baseFrequencyHz * harmonic;
    if (frequencyHz >= buffer.sampleRate / 2 - 1) break;
    applyNotchFilterRange(buffer, range, channels, frequencyHz, q, featherSamples);
  }
}

function applyDeClickRepairRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioRenderEditOperation,
): void {
  if (range.end - range.start < 3) return;

  const threshold = Math.max(0.01, finiteNumber(operation.params.threshold, 0.35));
  const ratio = Math.max(1, finiteNumber(operation.params.ratio, 4));

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    const original = data.slice(range.start, range.end);
    for (let local = 1; local < original.length - 1; local += 1) {
      const previous = original[local - 1] ?? 0;
      const current = original[local] ?? 0;
      const next = original[local + 1] ?? 0;
      const prediction = (previous + next) / 2;
      const residual = Math.abs(current - prediction);
      const neighborEnergy = (Math.abs(previous) + Math.abs(next)) / 2;
      if (residual >= threshold && residual >= neighborEnergy * ratio) {
        data[range.start + local] = prediction;
      }
    }
  }
}

function applySpliceSmoothRepairRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioRenderEditOperation,
): void {
  const edgeSeconds = Math.max(0.001, finiteNumber(operation.params.edgeSeconds, 0.008));
  const edgeSamples = Math.max(1, Math.min(
    Math.floor((range.end - range.start) / 2),
    Math.round(edgeSeconds * buffer.sampleRate),
  ));
  if (edgeSamples <= 0) return;

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    if (range.start > 0) {
      const leftAnchor = data[range.start - 1] ?? 0;
      for (let index = 0; index < edgeSamples; index += 1) {
        const sample = range.start + index;
        const t = (index + 1) / (edgeSamples + 1);
        const smooth = t * t * (3 - 2 * t);
        data[sample] = leftAnchor * (1 - smooth) + (data[sample] ?? 0) * smooth;
      }
    }

    if (range.end < buffer.length) {
      const rightAnchor = data[range.end] ?? 0;
      for (let index = 0; index < edgeSamples; index += 1) {
        const sample = range.end - 1 - index;
        const t = (index + 1) / (edgeSamples + 1);
        const smooth = t * t * (3 - 2 * t);
        data[sample] = rightAnchor * (1 - smooth) + (data[sample] ?? 0) * smooth;
      }
    }
  }
}

function applyLoudnessMatchRepairRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioRenderEditOperation,
): void {
  let sum = 0;
  let count = 0;
  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    for (let sample = range.start; sample < range.end; sample += 1) {
      const value = data[sample] ?? 0;
      sum += value * value;
      count += 1;
    }
  }
  if (count === 0) return;

  const rms = Math.sqrt(sum / count);
  if (rms <= 0.000001) return;

  const targetDb = finiteNumber(operation.params.targetDb, finiteNumber(operation.params.targetLufs, -20));
  const minGain = dbToLinearGain(finiteNumber(operation.params.minGainDb, -24));
  const maxGain = dbToLinearGain(finiteNumber(operation.params.maxGainDb, 24));
  const targetRms = dbToLinearGain(targetDb);
  const gain = Math.max(minGain, Math.min(maxGain, targetRms / rms));
  if (Math.abs(gain - 1) < 0.001) return;

  const featherSamples = Math.max(0, Math.min(
    Math.floor((range.end - range.start) / 2),
    Math.round(finiteNumber(operation.params.featherTime, 0.01) * buffer.sampleRate),
  ));

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    for (let sample = range.start; sample < range.end; sample += 1) {
      const feather = rangeFeatherFactor(sample, range, featherSamples);
      data[sample] = (data[sample] ?? 0) * (1 + (gain - 1) * feather);
    }
  }
}

function applyTransientSoftenRepairRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioRenderEditOperation,
): void {
  const rangeLength = range.end - range.start;
  if (rangeLength <= 1) return;

  const requestedGainDb = finiteNumber(operation.params.gainDb, -6);
  const targetGain = dbToLinearGain(Math.min(0, Math.max(-36, requestedGainDb)));
  if (Math.abs(targetGain - 1) < 0.001) return;

  const halfRange = Math.max(1, Math.floor(rangeLength / 2));
  const attackSamples = Math.max(1, Math.min(
    halfRange,
    Math.round(finiteNumber(operation.params.attackSeconds, 0.002) * buffer.sampleRate),
  ));
  const releaseSamples = Math.max(1, Math.min(
    halfRange,
    Math.round(finiteNumber(operation.params.releaseSeconds, 0.018) * buffer.sampleRate),
  ));

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    for (let sample = range.start; sample < range.end; sample += 1) {
      const local = sample - range.start;
      const fromEnd = range.end - 1 - sample;
      const attack = Math.min(1, local / attackSamples);
      const release = Math.min(1, fromEnd / releaseSamples);
      const envelope = Math.max(0, Math.min(1, Math.min(attack, release)));
      const smooth = envelope * envelope * (3 - 2 * envelope);
      data[sample] = (data[sample] ?? 0) * (1 + (targetGain - 1) * smooth);
    }
  }
}

export function applyRepairRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioRenderEditOperation,
): void {
  switch (operation.params.repairType) {
    case 'hum-notch':
      applyHumNotchRepairRange(buffer, range, channels, operation);
      break;
    case 'de-click':
      applyDeClickRepairRange(buffer, range, channels, operation);
      break;
    case 'splice-smooth':
      applySpliceSmoothRepairRange(buffer, range, channels, operation);
      break;
    case 'loudness-match':
      applyLoudnessMatchRepairRange(buffer, range, channels, operation);
      break;
    case 'transient-soften':
      applyTransientSoftenRepairRange(buffer, range, channels, operation);
      break;
  }
}
