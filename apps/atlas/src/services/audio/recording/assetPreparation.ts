import { encodeAudioBufferToWavBlob } from '../../../engine/audio/AudioFileEncoder';
import { Logger } from '../../logger';
import type {
  AudioRecordedAsset,
  AudioRecordingCapture,
  AudioRecordingRawResult,
} from '../AudioRecordingService';
import { getAudioContextConstructor } from './captureShared';

const log = Logger.create('AudioRecordingService');

interface RecordedAssetSession {
  sessionId: string;
  startedAt: number;
  startTime: number;
}

interface RecordedAssetCaptureGroup {
  inputDeviceId?: string;
  trackIds: string[];
  capture: AudioRecordingCapture;
}

function isWavMimeType(mimeType: string | undefined): boolean {
  return Boolean(mimeType?.toLowerCase().includes('wav'));
}

async function maybeEncodeBlobToWav(blob: Blob): Promise<{
  blob: Blob;
  duration?: number;
  sampleRate?: number;
  channelCount?: number;
}> {
  const AudioContextCtor = getAudioContextConstructor();
  if (!AudioContextCtor) {
    return { blob };
  }

  const audioContext = new AudioContextCtor();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    return {
      blob: encodeAudioBufferToWavBlob(decoded),
      duration: decoded.duration,
      sampleRate: decoded.sampleRate,
      channelCount: decoded.numberOfChannels,
    };
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}

export function createFileFromBlob(blob: Blob, name: string, lastModified: number): File {
  return new File([blob], name, {
    type: blob.type || 'audio/wav',
    lastModified,
  });
}

export async function prepareAudioRecordedAsset(
  session: RecordedAssetSession,
  group: RecordedAssetCaptureGroup,
  raw: AudioRecordingRawResult,
  stoppedAt: number,
  encodeToWav: boolean,
): Promise<AudioRecordedAsset> {
  let duration = Math.max(0.001, raw.duration ?? (stoppedAt - session.startedAt) / 1000);
  let blob = raw.blob;
  let sampleRate = raw.sampleRate;
  let channelCount = raw.channelCount;

  if (encodeToWav && raw.blob.size > 0 && !isWavMimeType(raw.blob.type || raw.mimeType)) {
    try {
      const encoded = await maybeEncodeBlobToWav(raw.blob);
      blob = encoded.blob;
      duration = Math.max(0.001, encoded.duration ?? duration);
      sampleRate = encoded.sampleRate;
      channelCount = encoded.channelCount;
    } catch (error) {
      log.warn('Could not transcode recording to WAV; keeping source recording blob.', error);
    }
  }

  const mimeType = blob.type || raw.mimeType || 'audio/wav';
  const extension = mimeType.includes('wav')
    ? 'wav'
    : mimeType.includes('ogg')
      ? 'ogg'
      : 'webm';
  const fileName = `Recording ${new Date(session.startedAt).toISOString().replace(/[:.]/g, '-')}.${extension}`;
  const file = createFileFromBlob(blob, fileName, stoppedAt);

  return {
    id: `${session.sessionId}:${group.inputDeviceId ?? 'default'}`,
    sessionId: session.sessionId,
    inputDeviceId: group.inputDeviceId,
    trackIds: group.trackIds,
    file,
    blob,
    mimeType,
    sourceMimeType: raw.mimeType,
    duration,
    startTime: session.startTime,
    startedAt: session.startedAt,
    stoppedAt,
    sampleRate,
    channelCount,
    chunkCount: raw.chunkCount,
  };
}
