import { createBuffer as createAudioBuffer } from '../../../engine/audio/audioBufferFactory';
import type { ClipAudioRenderClip, ClipAudioRenderEditOperation } from './clipAudioRenderModels';
import { dbToLinearGain, finiteNumber } from './audioRenderMath';
import { getOperationSampleRange } from './editOperationRanges';

export function fillRangeWithSilence(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
): void {
  for (const channel of channels) {
    buffer.getChannelData(channel).fill(0, range.start, range.end);
  }
}

function getRegionFadeEnvelope(
  sample: number,
  range: { start: number; end: number },
  fadeInSamples: number,
  fadeOutSamples: number,
): number {
  const length = Math.max(1, range.end - range.start);
  const local = Math.max(0, Math.min(length - 1, sample - range.start));
  const fadeIn = fadeInSamples > 0 ? Math.min(1, local / fadeInSamples) : 1;
  const fadeOut = fadeOutSamples > 0 ? Math.min(1, (length - 1 - local) / fadeOutSamples) : 1;
  return Math.max(0, Math.min(1, Math.min(fadeIn, fadeOut)));
}

export function applyGainRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioRenderEditOperation,
): void {
  const gainDb = Math.max(-120, Math.min(24, finiteNumber(operation.params.gainDb, 0)));
  if (Math.abs(gainDb) <= 0.01) return;

  const targetGain = gainDb <= -96 ? 0 : dbToLinearGain(gainDb);
  const fadeInSamples = Math.max(0, Math.round(finiteNumber(operation.params.fadeInSeconds, 0) * buffer.sampleRate));
  const fadeOutSamples = Math.max(0, Math.round(finiteNumber(operation.params.fadeOutSeconds, 0) * buffer.sampleRate));

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    for (let sample = range.start; sample < range.end; sample += 1) {
      const envelope = getRegionFadeEnvelope(sample, range, fadeInSamples, fadeOutSamples);
      const gain = 1 + (targetGain - 1) * envelope;
      data[sample] = (data[sample] ?? 0) * gain;
    }
  }
}

export function reverseRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
): void {
  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    let left = range.start;
    let right = range.end - 1;
    while (left < right) {
      const tmp = data[left] ?? 0;
      data[left] = data[right] ?? 0;
      data[right] = tmp;
      left += 1;
      right -= 1;
    }
  }
}

export function invertPolarityRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
): void {
  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    for (let sample = range.start; sample < range.end; sample += 1) {
      data[sample] = -(data[sample] ?? 0);
    }
  }
}

export function swapChannelsRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
): void {
  if (buffer.numberOfChannels < 2) return;
  const leftChannel = channels[0] ?? 0;
  const rightChannel = channels[1] ?? (leftChannel === 0 ? 1 : 0);
  if (leftChannel === rightChannel || leftChannel >= buffer.numberOfChannels || rightChannel >= buffer.numberOfChannels) {
    return;
  }

  const left = buffer.getChannelData(leftChannel);
  const right = buffer.getChannelData(rightChannel);
  for (let sample = range.start; sample < range.end; sample += 1) {
    const tmp = left[sample] ?? 0;
    left[sample] = right[sample] ?? 0;
    right[sample] = tmp;
  }
}

export function monoSumRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
): void {
  if (channels.length <= 1) return;
  const channelData = channels.map(channel => buffer.getChannelData(channel));
  for (let sample = range.start; sample < range.end; sample += 1) {
    let sum = 0;
    for (const data of channelData) {
      sum += data[sample] ?? 0;
    }
    const mono = sum / channelData.length;
    for (const data of channelData) {
      data[sample] = mono;
    }
  }
}

export function splitStereoRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioRenderEditOperation,
): void {
  if (buffer.numberOfChannels <= 0 || channels.length === 0) return;
  const sourceChannel = Math.max(
    0,
    Math.min(buffer.numberOfChannels - 1, Math.round(finiteNumber(operation.params.sourceChannel, channels[0] ?? 0))),
  );
  const source = buffer.getChannelData(sourceChannel).slice(range.start, range.end);

  for (const channel of channels) {
    const target = buffer.getChannelData(channel);
    for (let localIndex = 0; localIndex < source.length; localIndex += 1) {
      target[range.start + localIndex] = source[localIndex] ?? 0;
    }
  }
}


export function insertSilencePreservingDuration(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioRenderEditOperation,
): void {
  const seconds = finiteNumber(operation.params.durationSeconds, 0);
  const requestedSamples = seconds > 0
    ? Math.round(seconds * buffer.sampleRate)
    : Math.max(1, range.end - range.start);
  const insertionSamples = Math.max(1, Math.min(buffer.length - range.start, requestedSamples));

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    data.copyWithin(range.start + insertionSamples, range.start, buffer.length - insertionSamples);
    data.fill(0, range.start, Math.min(buffer.length, range.start + insertionSamples));
  }
}

export function deleteRangePreservingDuration(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
): void {
  const deletedSamples = Math.max(0, range.end - range.start);
  if (deletedSamples <= 0) return;

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    data.copyWithin(range.start, range.end);
    data.fill(0, Math.max(range.start, buffer.length - deletedSamples), buffer.length);
  }
}

function normalizeCompactDeleteRanges(
  ranges: readonly { start: number; end: number }[],
  bufferLength: number,
): Array<{ start: number; end: number }> {
  const normalized = ranges
    .map(range => ({
      start: Math.max(0, Math.min(bufferLength, Math.min(range.start, range.end))),
      end: Math.max(0, Math.min(bufferLength, Math.max(range.start, range.end))),
    }))
    .filter(range => range.end > range.start)
    .toSorted((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const range of normalized) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

export function deleteRangesCompactingDuration(
  buffer: AudioBuffer,
  ranges: readonly { start: number; end: number }[],
): AudioBuffer {
  const compactRanges = normalizeCompactDeleteRanges(ranges, buffer.length);
  const deletedSamples = compactRanges.reduce((sum, range) => sum + range.end - range.start, 0);
  if (deletedSamples <= 0) return buffer;

  const compacted = createAudioBuffer(
    buffer.numberOfChannels,
    Math.max(1, buffer.length - deletedSamples),
    buffer.sampleRate,
  );

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    const target = compacted.getChannelData(channel);
    let sourceCursor = 0;
    let targetCursor = 0;

    for (const range of compactRanges) {
      const copyEnd = Math.max(sourceCursor, range.start);
      if (copyEnd > sourceCursor) {
        target.set(source.subarray(sourceCursor, copyEnd), targetCursor);
        targetCursor += copyEnd - sourceCursor;
      }
      sourceCursor = Math.max(sourceCursor, range.end);
    }

    if (sourceCursor < buffer.length && targetCursor < target.length) {
      target.set(source.subarray(sourceCursor), targetCursor);
    }
  }

  return compacted;
}

export function pasteRangePreservingDuration(
  buffer: AudioBuffer,
  clip: ClipAudioRenderClip,
  destinationRange: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioRenderEditOperation,
): void {
  const sourceInPoint = finiteNumber(operation.params.sourceInPoint, Number.NaN);
  const sourceOutPoint = finiteNumber(operation.params.sourceOutPoint, Number.NaN);
  if (!Number.isFinite(sourceInPoint) || !Number.isFinite(sourceOutPoint)) return;

  const sourceRange = getOperationSampleRange({
    ...operation,
    timeRange: {
      start: Math.min(sourceInPoint, sourceOutPoint),
      end: Math.max(sourceInPoint, sourceOutPoint),
    },
  }, clip, buffer);
  const sourceLength = Math.max(0, sourceRange.end - sourceRange.start);
  const destinationLength = Math.max(0, destinationRange.end - destinationRange.start);
  const pasteLength = Math.min(sourceLength, destinationLength || sourceLength, buffer.length - destinationRange.start);
  if (pasteLength <= 0) return;

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    const sourceCopy = data.slice(sourceRange.start, sourceRange.start + pasteLength);
    if (operation.params.replaceSelection !== false && destinationLength > pasteLength) {
      data.fill(0, destinationRange.start, destinationRange.end);
    }
    data.set(sourceCopy, destinationRange.start);
  }
}
