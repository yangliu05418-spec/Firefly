import { Logger } from '../../logger';
import type {
  AudioRecordingCapture,
  AudioRecordingCaptureBackend,
  AudioRecordingCaptureStartInput,
} from '../AudioRecordingService';
import { MediaRecorderAudioCaptureBackend } from './mediaRecorderCaptureBackend';
import { AudioWorkletAudioCaptureBackend } from './workletCaptureBackend';

const log = Logger.create('AudioRecordingService');

export class FallbackAudioRecordingCaptureBackend implements AudioRecordingCaptureBackend {
  private readonly backends: AudioRecordingCaptureBackend[];

  constructor(backends: AudioRecordingCaptureBackend[]) {
    this.backends = backends;
  }

  async start(input: AudioRecordingCaptureStartInput): Promise<AudioRecordingCapture> {
    let lastError: unknown;

    for (const [index, backend] of this.backends.entries()) {
      try {
        return await backend.start(input);
      } catch (error) {
        lastError = error;
        if (index < this.backends.length - 1) {
          log.warn('Audio recording backend failed; trying fallback backend.', {
            backend: backend.constructor?.name ?? `backend-${index + 1}`,
            error,
          });
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('No audio recording backend could start.');
  }
}

export function createDefaultAudioRecordingCaptureBackend(): AudioRecordingCaptureBackend {
  return new FallbackAudioRecordingCaptureBackend([
    new AudioWorkletAudioCaptureBackend(),
    new MediaRecorderAudioCaptureBackend(),
  ]);
}
