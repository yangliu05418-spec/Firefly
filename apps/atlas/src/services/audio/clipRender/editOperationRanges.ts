import { createBuffer as createAudioBuffer } from '../../../engine/audio/audioBufferFactory';
import type { ClipAudioRenderClip, ClipAudioRenderEditOperation } from './clipAudioRenderModels';
import { finiteNumber, rangeFeatherFactor } from './audioRenderMath';

export function getOperationChannelIndexes(
  operation: ClipAudioRenderEditOperation,
  buffer: AudioBuffer,
): number[] {
  const sourceChannels = operation.channelMask?.length
    ? operation.channelMask
    : Array.from({ length: buffer.numberOfChannels }, (_, index) => index);
  const unique = new Set<number>();
  for (const channel of sourceChannels) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= buffer.numberOfChannels) continue;
    unique.add(channel);
  }
  return Array.from(unique);
}

export function getOperationSampleRange(
  operation: ClipAudioRenderEditOperation,
  clip: ClipAudioRenderClip,
  buffer: AudioBuffer,
): { start: number; end: number } {
  if (!operation.timeRange) {
    return { start: 0, end: buffer.length };
  }

  const clipSourceStart = Math.max(0, finiteNumber(clip.inPoint, 0));
  const sourceStart = Math.min(operation.timeRange.start, operation.timeRange.end);
  const sourceEnd = Math.max(operation.timeRange.start, operation.timeRange.end);
  const localStartSeconds = Math.max(0, sourceStart - clipSourceStart);
  const localEndSeconds = Math.max(localStartSeconds, sourceEnd - clipSourceStart);
  const start = Math.max(0, Math.min(buffer.length, Math.floor(localStartSeconds * buffer.sampleRate)));
  const end = Math.max(start, Math.min(buffer.length, Math.ceil(localEndSeconds * buffer.sampleRate)));
  return { start, end };
}

export function copyAudioRangeToBuffer(
  buffer: AudioBuffer,
  range: { start: number; end: number },
): AudioBuffer {
  const length = Math.max(1, range.end - range.start);
  const copied = createAudioBuffer(buffer.numberOfChannels, length, buffer.sampleRate);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    copied.getChannelData(channel).set(
      buffer.getChannelData(channel).subarray(range.start, Math.min(buffer.length, range.end)),
    );
  }

  return copied;
}

export function blendRenderedRegionIntoBuffer(
  target: AudioBuffer,
  renderedRegion: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  featherSamples: number,
): void {
  const length = Math.min(renderedRegion.length, Math.max(0, range.end - range.start), target.length - range.start);
  if (length <= 0) return;

  for (const channel of channels) {
    if (channel >= renderedRegion.numberOfChannels) continue;
    const targetData = target.getChannelData(channel);
    const renderedData = renderedRegion.getChannelData(channel);

    for (let localIndex = 0; localIndex < length; localIndex += 1) {
      const targetIndex = range.start + localIndex;
      const blend = rangeFeatherFactor(targetIndex, range, featherSamples);
      targetData[targetIndex] = targetData[targetIndex] * (1 - blend) + (renderedData[localIndex] ?? 0) * blend;
    }
  }
}
