import {
  encodeFloat32PcmChunksToWavBlob,
  type Float32PcmChunk,
} from '../../../engine/audio/AudioFileEncoder';
import { Logger } from '../../logger';
import type {
  AudioRecordedAsset,
  AudioRecordingRecoveryBlobStore,
  AudioRecordingService,
} from '../AudioRecordingService';
import { createFileFromBlob } from './assetPreparation';

const log = Logger.create('AudioRecordingService');
type AudioRecordingRecoveryEntry = ReturnType<AudioRecordingService['listRecoveryEntries']>[number];
type AudioRecordingRecoveryChunkRef = Awaited<ReturnType<AudioRecordingRecoveryBlobStore['putChunk']>>;

async function decodeInterleavedFloat32Chunk(
  blob: Blob,
  channelCount: number,
  frameCount: number,
): Promise<Float32PcmChunk> {
  const arrayBuffer = await blob.arrayBuffer();
  const interleaved = new Float32Array(arrayBuffer);
  const channels = Array.from({ length: Math.max(1, channelCount) }, () => new Float32Array(Math.max(0, frameCount)));

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels.length; channel += 1) {
      channels[channel][frame] = interleaved[frame * channels.length + channel] ?? 0;
    }
  }

  return { channels, frameCount };
}

export async function restoreAudioRecordingRecoveryAssets(
  entry: AudioRecordingRecoveryEntry,
  recoveryBlobStore: AudioRecordingRecoveryBlobStore,
): Promise<AudioRecordedAsset[]> {
  if (entry.assets && entry.assets.length > 0) {
    return restoreRecoveryAssetRefs(entry, recoveryBlobStore);
  }
  if (entry.chunks && entry.chunks.length > 0) {
    return restoreRecoveryChunkRefs(entry, recoveryBlobStore);
  }
  return [];
}

async function restoreRecoveryAssetRefs(
  entry: AudioRecordingRecoveryEntry,
  recoveryBlobStore: AudioRecordingRecoveryBlobStore,
): Promise<AudioRecordedAsset[]> {
  const refs = entry.assets ?? [];
  const assets: AudioRecordedAsset[] = [];
  for (const assetRef of refs) {
    const blob = await recoveryBlobStore.getAsset(assetRef);
    if (!blob) {
      throw new Error(`Recovered recording asset "${assetRef.fileName}" is missing.`);
    }
    const file = createFileFromBlob(blob, assetRef.fileName, assetRef.stoppedAt);
    assets.push({
      id: assetRef.id,
      sessionId: entry.sessionId,
      inputDeviceId: assetRef.inputDeviceId,
      trackIds: assetRef.trackIds,
      file,
      blob,
      mimeType: assetRef.mimeType,
      sourceMimeType: assetRef.sourceMimeType,
      duration: assetRef.duration,
      startTime: assetRef.startTime,
      startedAt: assetRef.startedAt,
      stoppedAt: assetRef.stoppedAt,
      sampleRate: assetRef.sampleRate,
      channelCount: assetRef.channelCount,
      chunkCount: assetRef.chunkCount,
    });
  }

  return assets;
}

async function restoreRecoveryChunkRefs(
  entry: AudioRecordingRecoveryEntry,
  recoveryBlobStore: AudioRecordingRecoveryBlobStore,
): Promise<AudioRecordedAsset[]> {
  const groups = new Map<string, AudioRecordingRecoveryChunkRef[]>();
  for (const chunk of entry.chunks ?? []) {
    const key = chunk.inputDeviceId ?? 'default';
    groups.set(key, [...(groups.get(key) ?? []), chunk]);
  }

  const assets: AudioRecordedAsset[] = [];
  for (const [inputKey, chunks] of groups.entries()) {
    const sortedChunks = chunks.toSorted((a, b) => a.chunkIndex - b.chunkIndex);
    const first = sortedChunks[0];
    if (!first) continue;

    const restoredBlobs = await Promise.all(sortedChunks.map(async chunk => ({
      ref: chunk,
      blob: await recoveryBlobStore.getChunk(chunk),
    })));
    const missing = restoredBlobs.find(item => !item.blob);
    if (missing) {
      throw new Error(`Recovered recording chunk ${missing.ref.chunkIndex} is missing.`);
    }

    let blob: Blob;
    let mimeType = first.mimeType;
    let duration = sortedChunks.reduce((total, chunk) => total + (chunk.duration ?? 0), 0);
    let sampleRate = first.sampleRate;
    let channelCount = first.channelCount;
    const chunkCount = sortedChunks.length;
    if (first.kind === 'audio-worklet-pcm-f32') {
      sampleRate = first.sampleRate ?? 48000;
      channelCount = Math.max(1, ...sortedChunks.map(chunk => chunk.channelCount ?? 1));
      const pcmChunks = await Promise.all(restoredBlobs.map(async ({ ref, blob: chunkBlob }) => (
        decodeInterleavedFloat32Chunk(
          chunkBlob!,
          ref.channelCount ?? channelCount!,
          ref.frameCount ?? 0,
        )
      )));
      const frameCount = sortedChunks.reduce((total, chunk) => total + (chunk.frameCount ?? 0), 0);
      blob = encodeFloat32PcmChunksToWavBlob({
        sampleRate,
        channelCount,
        chunks: pcmChunks,
        frameCount,
      });
      mimeType = 'audio/wav';
      duration = frameCount > 0 ? frameCount / sampleRate : duration;
    } else {
      blob = new Blob(restoredBlobs.map(item => item.blob!), { type: first.mimeType || 'audio/webm' });
    }

    const extension = mimeType.includes('wav')
      ? 'wav'
      : mimeType.includes('ogg')
        ? 'ogg'
        : 'webm';
    const fileName = `Recovered Recording ${new Date(entry.startedAt).toISOString().replace(/[:.]/g, '-')}.${extension}`;
    const stoppedAt = Math.max(entry.startedAt, entry.startedAt + Math.max(0.001, duration) * 1000);
    const file = createFileFromBlob(blob, fileName, stoppedAt);
    const inputDeviceId = inputKey === 'default' ? undefined : inputKey;
    assets.push({
      id: `${entry.sessionId}:${inputKey}:chunks`,
      sessionId: entry.sessionId,
      inputDeviceId,
      trackIds: first.trackIds,
      file,
      blob,
      mimeType,
      sourceMimeType: first.mimeType,
      duration: Math.max(0.001, duration),
      startTime: entry.startTime,
      startedAt: entry.startedAt,
      stoppedAt,
      sampleRate,
      channelCount,
      chunkCount,
    });
  }

  return assets;
}

export async function persistAudioRecordingRecoveryAssets(
  assets: readonly AudioRecordedAsset[],
  recoveryBlobStore: AudioRecordingRecoveryBlobStore,
): Promise<Awaited<ReturnType<AudioRecordingRecoveryBlobStore['putAsset']>>[] | undefined> {
  if (assets.length === 0) return undefined;

  const refs: Awaited<ReturnType<AudioRecordingRecoveryBlobStore['putAsset']>>[] = [];
  for (const asset of assets) {
    try {
      refs.push(await recoveryBlobStore.putAsset(asset));
    } catch (error) {
      log.warn('Could not persist recording recovery asset', {
        sessionId: asset.sessionId,
        fileName: asset.file.name,
        error,
      });
    }
  }

  return refs.length > 0 ? refs : undefined;
}
