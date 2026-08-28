import type { AudioArtifactStore } from '../AudioArtifactStore';
import type { AudioAnalysisWarning, AudioArtifactRef } from '../audioArtifactTypes';
import {
  SPECTROGRAM_TILE_PAYLOAD_VERSION,
  encodeSpectrogramTilePayload,
  type SpectrogramFftSize,
  type SpectrogramTileRef,
} from '../spectrogramTileManifest';
import { hannWindow, writeFrameMagnitudes } from './spectrogramFrameMath';

export const SPECTROGRAM_TILE_PAYLOAD_MIME_TYPE = 'application/vnd.masterselects.spectrogram-tile';

export interface SpectrogramTileStorageParameters {
  fftSize: SpectrogramFftSize;
  hopSize: number;
  tileWidthFrames: number;
  minDb: number;
  maxDb: number;
  frequencyBinCount: number;
  frameCount: number;
}

export interface SpectrogramTileStorageProgressUpdate {
  phase: 'analyzing' | 'storing-payloads';
  percent: number;
  timestamp: string;
  tileIndex: number;
  frameStart: number;
  frameCount: number;
  message: string;
}

export async function generateAndStoreSpectrogramTiles(input: {
  artifactStore: AudioArtifactStore;
  buffer: AudioBuffer;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  cacheKey: string;
  parameters: SpectrogramTileStorageParameters;
  analyzerVersion: string;
  generatedAt: string;
  now: () => string;
  emitProgress: (update: SpectrogramTileStorageProgressUpdate) => void;
  throwIfCancelled: () => void;
}): Promise<{
  tiles: SpectrogramTileRef[];
  payloadRefs: AudioArtifactRef[];
  warnings: AudioAnalysisWarning[];
}> {
  const { buffer, parameters, analyzerVersion, generatedAt } = input;
  const payloadRefs: AudioArtifactRef[] = [];
  const tiles: SpectrogramTileRef[] = [];
  const channelData = Array.from({ length: buffer.numberOfChannels }, (_, index) => (
    buffer.getChannelData(index)
  ));
  const window = hannWindow(parameters.fftSize);
  const real = new Float32Array(parameters.fftSize);
  const imag = new Float32Array(parameters.fftSize);
  const tileCount = Math.max(1, Math.ceil(parameters.frameCount / parameters.tileWidthFrames));

  for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
    const frameStart = tileIndex * parameters.tileWidthFrames;
    const frameCount = Math.min(parameters.tileWidthFrames, parameters.frameCount - frameStart);
    const values = new Float32Array(frameCount * parameters.frequencyBinCount);

    input.emitProgress({
      phase: 'analyzing',
      percent: 5 + (tileIndex / tileCount) * 70,
      timestamp: input.now(),
      tileIndex,
      frameStart,
      frameCount,
      message: 'Analyzing spectrogram tile',
    });
    input.throwIfCancelled();

    for (let localFrame = 0; localFrame < frameCount; localFrame += 1) {
      writeFrameMagnitudes({
        channelData,
        frameIndex: frameStart + localFrame,
        hopSize: parameters.hopSize,
        fftSize: parameters.fftSize,
        frequencyBinCount: parameters.frequencyBinCount,
        window,
        minDb: parameters.minDb,
        maxDb: parameters.maxDb,
        real,
        imag,
        target: values,
        targetFrameOffset: localFrame,
      });
    }

    input.emitProgress({
      phase: 'storing-payloads',
      percent: 75 + (tileIndex / tileCount) * 20,
      timestamp: input.now(),
      tileIndex,
      frameStart,
      frameCount,
      message: 'Storing spectrogram tile payload',
    });
    input.throwIfCancelled();

    const payloadRef = await input.artifactStore.putPayload(encodeSpectrogramTilePayload({
      header: {
        schemaVersion: SPECTROGRAM_TILE_PAYLOAD_VERSION,
        tileIndex,
        channelIndex: 0,
        frameStart,
        frameCount,
        frequencyBinStart: 0,
        frequencyBinCount: parameters.frequencyBinCount,
        minDb: parameters.minDb,
        maxDb: parameters.maxDb,
        valueLayout: 'time-major',
        valueEncoding: 'normalized-db',
      },
      values,
    }), {
      mediaFileId: input.mediaFileId,
      kind: 'spectrogram-tiles',
      sourceFingerprint: input.sourceFingerprint,
      clipAudioStateHash: input.clipAudioStateHash,
      mimeType: SPECTROGRAM_TILE_PAYLOAD_MIME_TYPE,
      encoding: 'raw',
      analyzerVersion,
      createdAt: generatedAt,
      sourceRefs: [`audio-analysis-cache:${input.cacheKey}`],
      metadata: {
        cacheKey: input.cacheKey,
        tileIndex,
        channelIndex: 0,
        frameStart,
        frameCount,
        frequencyBinStart: 0,
        frequencyBinCount: parameters.frequencyBinCount,
        valueEncoding: 'normalized-db',
      },
    });

    payloadRefs.push(payloadRef);
    tiles.push({
      tileIndex,
      channelIndex: 0,
      frameStart,
      frameCount,
      frequencyBinStart: 0,
      frequencyBinCount: parameters.frequencyBinCount,
      payloadRef,
    });
  }

  return {
    tiles,
    payloadRefs,
    warnings: [],
  };
}
