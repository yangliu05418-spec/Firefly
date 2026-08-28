import type { AudioEffectRenderer } from '../../../engine/audio/AudioEffectRenderer';
import type { ClipAudioRenderProgress } from './renderProgress';
import { emitProgress } from './renderProgress';
import type { ClipAudioRenderClip, ClipAudioRenderEditOperation } from './clipAudioRenderModels';
import { cloneAudioBuffer } from './audioBufferPrimitives';
import {
  applyGainRange,
  deleteRangePreservingDuration,
  deleteRangesCompactingDuration,
  fillRangeWithSilence,
  insertSilencePreservingDuration,
  invertPolarityRange,
  monoSumRange,
  pasteRangePreservingDuration,
  reverseRange,
  splitStereoRange,
  swapChannelsRange,
} from './editStackBasicOperations';
import { getOperationChannelIndexes, getOperationSampleRange } from './editOperationRanges';
import { applyRepairRange } from './repairOperations';
import { renderRegionEffect } from './regionEffectRendering';
import { fillRangeWithRoomTone } from './roomToneFill';
import { applySpectralBandGainRange, applySpectralResynthesisRange } from './spectralEditOperations';

export async function renderEditStackOperations(
  effectRenderer: Pick<AudioEffectRenderer, 'renderEffectInstances'>,
  clip: ClipAudioRenderClip,
  buffer: AudioBuffer,
  operations: readonly ClipAudioRenderEditOperation[],
  onProgress?: (progress: ClipAudioRenderProgress) => void,
): Promise<AudioBuffer> {
  if (operations.length === 0) return buffer;

  emitProgress(onProgress, {
    phase: 'edit-stack',
    percent: 16,
    message: 'Rendering clip audio edit stack',
  });

  let edited = cloneAudioBuffer(buffer);
  const compactDeleteRanges: Array<{ start: number; end: number }> = [];
  for (const operation of operations) {
    const range = getOperationSampleRange(operation, clip, edited);
    if (range.end <= range.start && operation.type !== 'insert-silence') continue;
    const channels = getOperationChannelIndexes(operation, edited);
    if (channels.length === 0) continue;

    switch (operation.type) {
      case 'gain':
        applyGainRange(edited, range, channels, operation);
        break;
      case 'silence':
      case 'cut':
        fillRangeWithSilence(edited, range, channels);
        break;
      case 'paste':
        pasteRangePreservingDuration(edited, clip, range, channels, operation);
        break;
      case 'reverse':
        reverseRange(edited, range, channels);
        break;
      case 'invert-polarity':
        invertPolarityRange(edited, range, channels);
        break;
      case 'swap-channels':
        swapChannelsRange(edited, range, channels);
        break;
      case 'mono-sum':
        monoSumRange(edited, range, channels);
        break;
      case 'split-stereo':
        splitStereoRange(edited, range, channels, operation);
        break;
      case 'insert-silence':
        insertSilencePreservingDuration(edited, range, channels, operation);
        break;
      case 'delete-silence':
        if (operation.params.compactTimeline === true) {
          compactDeleteRanges.push(range);
        } else {
          deleteRangePreservingDuration(edited, range, channels);
        }
        break;
      case 'repair':
        applyRepairRange(edited, range, channels, operation);
        break;
      case 'effect':
        edited = await renderRegionEffect(effectRenderer, edited, range, channels, operation, onProgress);
        break;
      case 'room-tone-fill':
        fillRangeWithRoomTone(edited, clip, range, channels, operation);
        break;
      case 'spectral-mask':
        applySpectralBandGainRange(edited, range, channels, operation);
        break;
      case 'spectral-resynthesis':
        applySpectralResynthesisRange(edited, range, channels, operation);
        break;
    }
  }

  if (compactDeleteRanges.length > 0) {
    return deleteRangesCompactingDuration(edited, compactDeleteRanges);
  }

  return edited;
}
