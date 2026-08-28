import type { AudioEffectRenderer } from '../../../engine/audio/AudioEffectRenderer';
import { createAudioRegionEffectInstance } from '../audioRegionEffectOperation';
import type { ClipAudioRenderProgress } from './renderProgress';
import { emitProgress } from './renderProgress';
import type { ClipAudioRenderEditOperation } from './clipAudioRenderModels';
import { cloneAudioBuffer } from './audioBufferPrimitives';
import { finiteNumber } from './audioRenderMath';
import { blendRenderedRegionIntoBuffer, copyAudioRangeToBuffer } from './editOperationRanges';

export async function renderRegionEffect(
  effectRenderer: Pick<AudioEffectRenderer, 'renderEffectInstances'>,
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioRenderEditOperation,
  onProgress?: (progress: ClipAudioRenderProgress) => void,
): Promise<AudioBuffer> {
  const effect = createAudioRegionEffectInstance(operation as Parameters<typeof createAudioRegionEffectInstance>[0]);
  if (!effect || effect.enabled === false) return buffer;

  const regionBuffer = copyAudioRangeToBuffer(buffer, range);
  const featherSamples = Math.max(0, Math.min(
    Math.floor((range.end - range.start) / 2),
    Math.round(finiteNumber(operation.params.featherTime, 0.015) * buffer.sampleRate),
  ));

  emitProgress(onProgress, {
    phase: 'edit-stack',
    percent: 18,
    message: `Rendering ${operation.params.label ?? 'region FX'}`,
  });

  const renderedRegion = await effectRenderer.renderEffectInstances(
    regionBuffer,
    [effect],
    [],
    regionBuffer.duration,
    effectsProgress => emitProgress(onProgress, {
      phase: 'edit-stack',
      percent: 18 + Math.round(effectsProgress.percent * 0.18),
      effects: effectsProgress,
      message: `Rendering ${operation.params.label ?? 'region FX'}`,
    }),
  );

  const edited = cloneAudioBuffer(buffer);
  blendRenderedRegionIntoBuffer(edited, renderedRegion, range, channels, featherSamples);
  return edited;
}
