import type { ClipAudioStemLayer, ClipAudioStemState } from '../../../types/audio';
import type { ClipStemSeparationRunnerRequest } from '../../../stores/timeline/types';
import type { PreparedClipAudioAnalysisInput } from '../ClipAudioAnalysisOrchestrator';
import { STEM_SOURCE_LAYER_ID } from './stemSourceLayer';
import type {
  StemModelCatalogEntry,
  StemModelFileBuffer,
  StemSeparationInput,
  StemSeparationWorkerStemResult,
} from './types';

export interface StoredStemLayer {
  layer: ClipAudioStemLayer;
  sampleRate: number;
  channelCount: number;
  frameCount: number;
  duration: number;
}

export type StemModelLoadSource =
  | { kind: 'buffers'; buffers: StemModelFileBuffer[] }
  | { kind: 'url'; url: string };

export function stemLabel(kind: ClipAudioStemLayer['kind']): string {
  if (kind === 'sfx') return 'SFX';
  return `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`;
}

function cloneBufferChannels(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, channelIndex) =>
    new Float32Array(buffer.getChannelData(channelIndex))
  );
}

export function createStemSeparationWorkerInput(
  prepared: PreparedClipAudioAnalysisInput,
  modelId: string,
): StemSeparationInput {
  const channels = cloneBufferChannels(prepared.sourceBuffer);
  return {
    modelId,
    mediaFileId: prepared.mediaFileId,
    sourceFingerprint: prepared.sourceFingerprint,
    sampleRate: prepared.sourceBuffer.sampleRate,
    channelCount: prepared.sourceBuffer.numberOfChannels,
    frameCount: prepared.sourceBuffer.length,
    channels,
  };
}

export function getModelOrderedStemResults(
  model: StemModelCatalogEntry,
  results: readonly StemSeparationWorkerStemResult[],
): StemSeparationWorkerStemResult[] {
  const byKind = new Map(results.map(result => [result.kind, result]));
  const missingKinds = model.outputStemOrder.filter(kind => !byKind.has(kind));
  if (missingKinds.length > 0) {
    throw new Error(`Stem separation did not return expected stems: ${missingKinds.join(', ')}.`);
  }
  return model.outputStemOrder.map(kind => byKind.get(kind)!);
}

export function getPrimaryStemModelUrl(model: StemModelCatalogEntry): string {
  const url = model.files[0]?.url;
  if (!url) {
    throw new Error(`Stem separation model ${model.id} does not define a downloadable model URL.`);
  }
  return url;
}

export function createStemSeparationState(input: {
  request: ClipStemSeparationRunnerRequest;
  model: StemModelCatalogEntry;
  prepared: PreparedClipAudioAnalysisInput;
  storedLayers: readonly StoredStemLayer[];
  createdAt: number;
}): ClipAudioStemState | null {
  const firstLayer = input.storedLayers[0];
  if (!firstLayer) {
    return null;
  }

  return {
    activeSetId: `stem-set:${input.request.jobId}`,
    modelId: input.model.id,
    modelVersion: input.model.modelVersion,
    createdAt: input.createdAt,
    sourceFingerprint: input.prepared.sourceFingerprint,
    range: {
      start: 0,
      end: input.prepared.sourceBuffer.duration,
    },
    sampleRate: firstLayer.sampleRate,
    channelCount: firstLayer.channelCount,
    stems: input.storedLayers.map(stored => stored.layer),
    soloStemId: STEM_SOURCE_LAYER_ID,
    sourceGainDb: 0,
    mixMode: 'original',
  };
}
