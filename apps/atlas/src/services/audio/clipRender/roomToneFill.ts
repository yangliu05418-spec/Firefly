import type { ClipAudioRenderClip, ClipAudioRenderEditOperation } from './clipAudioRenderModels';
import { dbToLinearGain, finiteNumber, rangeFeatherFactor } from './audioRenderMath';
import { getOperationSampleRange } from './editOperationRanges';

function parseRoomToneSourceRanges(operation: ClipAudioRenderEditOperation): Array<{ start: number; end: number }> {
  const encoded = operation.params.roomToneSourceRanges;
  if (typeof encoded === 'string') {
    try {
      const parsed = JSON.parse(encoded) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map(range => {
            if (!range || typeof range !== 'object') return null;
            const current = range as { start?: unknown; end?: unknown };
            if (typeof current.start !== 'number' || typeof current.end !== 'number') return null;
            return {
              start: Math.min(current.start, current.end),
              end: Math.max(current.start, current.end),
            };
          })
          .filter((range): range is { start: number; end: number } => Boolean(range && range.end > range.start));
      }
    } catch {
      // Fall back to sourceInPoint/sourceOutPoint below.
    }
  }

  const sourceInPoint = finiteNumber(operation.params.sourceInPoint, Number.NaN);
  const sourceOutPoint = finiteNumber(operation.params.sourceOutPoint, Number.NaN);
  if (Number.isFinite(sourceInPoint) && Number.isFinite(sourceOutPoint) && Math.abs(sourceOutPoint - sourceInPoint) > 0.0005) {
    return [{
      start: Math.min(sourceInPoint, sourceOutPoint),
      end: Math.max(sourceInPoint, sourceOutPoint),
    }];
  }

  return [];
}

function deterministicNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function collectRoomToneSamples(
  buffer: AudioBuffer,
  clip: ClipAudioRenderClip,
  operation: ClipAudioRenderEditOperation,
  channel: number,
  targetRange: { start: number; end: number },
): Float32Array {
  const sourceRanges = parseRoomToneSourceRanges(operation)
    .map(sourceRange => getOperationSampleRange({ ...operation, timeRange: sourceRange }, clip, buffer))
    .filter(sourceRange =>
      sourceRange.end > sourceRange.start &&
      (sourceRange.end <= targetRange.start || sourceRange.start >= targetRange.end)
    );
  const sampleCount = sourceRanges.reduce((sum, sourceRange) => sum + sourceRange.end - sourceRange.start, 0);
  if (sampleCount <= 0) return new Float32Array();

  const source = buffer.getChannelData(channel);
  const samples = new Float32Array(sampleCount);
  let cursor = 0;
  for (const sourceRange of sourceRanges) {
    const slice = source.subarray(sourceRange.start, sourceRange.end);
    samples.set(slice, cursor);
    cursor += slice.length;
  }
  return samples;
}

function loopRoomToneSample(
  samples: Float32Array,
  index: number,
  crossfadeSamples: number,
): number {
  if (samples.length === 0) return 0;
  const position = index % samples.length;
  if (crossfadeSamples <= 0 || samples.length <= crossfadeSamples * 2 || position >= crossfadeSamples) {
    return samples[position] ?? 0;
  }

  const tailPosition = samples.length - crossfadeSamples + position;
  const mix = position / crossfadeSamples;
  return (samples[tailPosition] ?? 0) * (1 - mix) + (samples[position] ?? 0) * mix;
}

export function fillRangeWithRoomTone(
  buffer: AudioBuffer,
  clip: ClipAudioRenderClip,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioRenderEditOperation,
): void {
  const gain = dbToLinearGain(finiteNumber(operation.params.roomToneGainDb, 0));
  const generatedGain = dbToLinearGain(finiteNumber(operation.params.generatedNoiseDb, -66));
  const crossfadeSamples = Math.max(0, Math.round(finiteNumber(operation.params.crossfadeSeconds, 0.025) * buffer.sampleRate));

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    const toneSamples = collectRoomToneSamples(buffer, clip, operation, channel, range);
    for (let sample = range.start; sample < range.end; sample += 1) {
      const localIndex = sample - range.start;
      const edge = rangeFeatherFactor(sample, range, Math.min(crossfadeSamples, Math.floor((range.end - range.start) / 2)));
      const generated = deterministicNoise((channel + 1) * 100000 + localIndex) * generatedGain;
      const sourceTone = toneSamples.length > 0
        ? loopRoomToneSample(toneSamples, localIndex, crossfadeSamples) * gain
        : generated;
      data[sample] = sourceTone * edge + (data[sample] ?? 0) * (1 - edge);
    }
  }
}
