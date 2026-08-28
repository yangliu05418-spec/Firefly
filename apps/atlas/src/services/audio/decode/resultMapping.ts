import type { SignalMetadata } from '../../../signals/types';
import type {
  AudioDecodeChannelLayout,
  AudioDecodeRuntime,
  AudioDecodeWarning,
} from '../audioDecodeTypes';
import { AudioDecodeServiceError } from './errors';

const BYTES_PER_FLOAT32_SAMPLE = 4;

export function decodedPcmBytes(buffer: AudioBuffer): number {
  return buffer.numberOfChannels * buffer.length * BYTES_PER_FLOAT32_SAMPLE;
}

export function cloneMetadata(metadata?: SignalMetadata): SignalMetadata | undefined {
  if (!metadata) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(metadata)) as SignalMetadata;
}

export function cloneWarning(warning: AudioDecodeWarning): AudioDecodeWarning {
  return {
    ...warning,
    details: cloneMetadata(warning.details),
  };
}

export function describeChannelLayout(channelCount: number): AudioDecodeChannelLayout {
  if (channelCount === 1) {
    return { kind: 'mono', channelCount, labels: ['M'] };
  }

  if (channelCount === 2) {
    return { kind: 'stereo', channelCount, labels: ['L', 'R'] };
  }

  if (channelCount > 2 && channelCount <= 8) {
    return { kind: 'surround', channelCount };
  }

  if (channelCount > 8) {
    return { kind: 'discrete', channelCount };
  }

  return { kind: 'unknown', channelCount: Math.max(0, channelCount) };
}

export function fallbackWarning(runtime: AudioDecodeRuntime): AudioDecodeWarning {
  return {
    code: 'decode-fallback',
    message: 'Decoded audio with the bounded browser AudioContext fallback.',
    details: {
      decoderId: runtime.id,
      decoderVersion: runtime.version,
    },
  };
}

export function validateAudioBuffer(
  buffer: AudioBuffer,
  jobId: string,
  runtime: AudioDecodeRuntime,
): void {
  if (!buffer || typeof buffer !== 'object') {
    throw new AudioDecodeServiceError(`Decoder ${runtime.id} returned no AudioBuffer.`, {
      code: 'invalid-decode-result',
      jobId,
      recoverable: false,
    });
  }

  const { numberOfChannels, sampleRate, length, duration } = buffer;
  const fields = [numberOfChannels, sampleRate, length, duration];

  if (!fields.every((value) => typeof value === 'number' && Number.isFinite(value))
    || !Number.isInteger(numberOfChannels)
    || numberOfChannels <= 0
    || sampleRate <= 0
    || !Number.isInteger(length)
    || length < 0
    || duration < 0) {
    throw new AudioDecodeServiceError(`Decoder ${runtime.id} returned invalid AudioBuffer metadata.`, {
      code: 'invalid-decode-result',
      jobId,
      recoverable: false,
    });
  }

  const pcmBytes = decodedPcmBytes(buffer);
  if (!Number.isSafeInteger(pcmBytes) || pcmBytes < 0) {
    throw new AudioDecodeServiceError(`Decoder ${runtime.id} returned an AudioBuffer with unsafe PCM byte size.`, {
      code: 'invalid-decode-result',
      jobId,
      recoverable: false,
    });
  }
}

export function enforceDecodedPcmLimit(
  pcmBytes: number,
  limit: number,
  jobId: string,
  runtime: AudioDecodeRuntime,
): void {
  if (pcmBytes <= limit) {
    return;
  }

  throw new AudioDecodeServiceError(
    `Decoder ${runtime.id} produced ${pcmBytes} PCM bytes, above the ${limit} byte limit.`,
    {
      code: runtime.kind === 'browser-fallback'
        ? 'browser-fallback-output-too-large'
        : 'decode-output-too-large',
      jobId,
    },
  );
}
