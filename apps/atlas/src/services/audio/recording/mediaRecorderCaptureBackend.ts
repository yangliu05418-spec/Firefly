import { Logger } from '../../logger';
import type {
  AudioRecordingCapture,
  AudioRecordingCaptureBackend,
  AudioRecordingCaptureStartInput,
  AudioRecordingRawResult,
} from '../AudioRecordingService';
import { createAudioInputConstraints, stopStream } from './captureShared';

const log = Logger.create('AudioRecordingService');

function selectRecorderMimeType(mimeTypes: string[]): string | undefined {
  const recorder = globalThis.MediaRecorder;
  if (!recorder?.isTypeSupported) return undefined;
  return mimeTypes.find(type => recorder.isTypeSupported(type));
}

export class MediaRecorderAudioCaptureBackend implements AudioRecordingCaptureBackend {
  async start(input: AudioRecordingCaptureStartInput): Promise<AudioRecordingCapture> {
    if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
      throw new Error('Audio input capture is not available in this browser.');
    }
    if (!globalThis.MediaRecorder) {
      throw new Error('MediaRecorder audio capture is not available in this browser.');
    }

    const stream = await globalThis.navigator.mediaDevices.getUserMedia(
      createAudioInputConstraints(input.inputDeviceId),
    );
    const mimeType = selectRecorderMimeType(input.mimeTypes);
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const pendingRecoveryWrites: Promise<unknown>[] = [];
    let chunkIndex = 0;
    let captureStartedAt = input.startedAt;
    let captureStartTime = input.startTime;
    let hasStartedRecorder = false;

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        const currentChunkIndex = chunkIndex;
        chunkIndex += 1;
        chunks.push(event.data);
        if (input.chunkSink && input.sessionId && typeof captureStartedAt === 'number') {
          const chunkMimeType = event.data.type || recorder.mimeType || mimeType || 'audio/webm';
          pendingRecoveryWrites.push(input.chunkSink.writeChunk({
            sessionId: input.sessionId,
            inputDeviceId: input.inputDeviceId,
            trackIds: input.trackIds ?? [],
            chunkIndex: currentChunkIndex,
            kind: 'media-recorder',
            blob: event.data,
            mimeType: chunkMimeType,
            startedAt: captureStartedAt,
            startTime: captureStartTime ?? 0,
            timeStart: (currentChunkIndex * input.timesliceMs) / 1000,
            duration: input.timesliceMs / 1000,
          }).catch(error => {
            log.warn('MediaRecorder recovery chunk write failed', { chunkIndex: currentChunkIndex, error });
          }));
        }
      }
    });

    const startRecorder = (): void => {
      if (hasStartedRecorder || recorder.state !== 'inactive') return;
      recorder.start(input.timesliceMs);
      hasStartedRecorder = true;
    };

    if (input.initiallyPaused !== true) {
      startRecorder();
    }

    return {
      mimeType: recorder.mimeType || mimeType || '',
      stream,
      resume: (resumeInput) => {
        captureStartedAt = resumeInput?.startedAt ?? captureStartedAt;
        captureStartTime = resumeInput?.startTime ?? captureStartTime;
        startRecorder();
      },
      stop: () => new Promise<AudioRecordingRawResult>((resolve, reject) => {
        const finish = async () => {
          stopStream(stream);
          await Promise.allSettled(pendingRecoveryWrites);
          const sourceMimeType = recorder.mimeType || mimeType || chunks[0]?.type || 'audio/webm';
          resolve({
            blob: new Blob(chunks, { type: sourceMimeType }),
            mimeType: sourceMimeType,
            chunkCount: chunks.length,
          });
        };
        recorder.addEventListener('stop', finish, { once: true });
        recorder.addEventListener('error', (event) => {
          stopStream(stream);
          const eventError = (event as Event & { error?: unknown }).error;
          reject(eventError instanceof Error ? eventError : new Error('Audio recording failed.'));
        }, { once: true });

        if (!hasStartedRecorder || recorder.state === 'inactive') {
          void finish();
          return;
        }

        try {
          recorder.requestData();
          recorder.stop();
        } catch (error) {
          stopStream(stream);
          reject(error);
        }
      }),
      cancel: async () => {
        if (hasStartedRecorder && recorder.state !== 'inactive') {
          recorder.stop();
        }
        stopStream(stream);
      },
    };
  }
}
