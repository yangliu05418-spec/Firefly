import {
  encodeFloat32PcmChunksToWavBlob,
  type Float32PcmChunk,
} from '../../../engine/audio/AudioFileEncoder';
import { Logger } from '../../logger';
import type {
  AudioRecordingCapture,
  AudioRecordingCaptureBackend,
  AudioRecordingCaptureStartInput,
} from '../AudioRecordingService';
import {
  createAudioInputConstraints,
  disconnectAudioNode,
  getAudioContextConstructor,
  stopStream,
} from './captureShared';

const log = Logger.create('AudioRecordingService');
const AUDIO_WORKLET_PROCESSOR_NAME = 'masterselects-pcm-recorder';
const AUDIO_WORKLET_STOP_ACK_TIMEOUT_MS = 1000;
const AUDIO_WORKLET_PROCESSOR_SOURCE = `
class MasterSelectsPcmRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = true;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'stop') {
        this.recording = false;
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (output) {
      for (let channel = 0; channel < output.length; channel += 1) {
        output[channel].fill(0);
      }
    }

    const input = inputs[0];
    if (this.recording && input && input.length > 0 && input[0] && input[0].length > 0) {
      const channels = input.map((channelData) => {
        const copy = new Float32Array(channelData.length);
        copy.set(channelData);
        return copy;
      });
      this.port.postMessage({ type: 'pcm', channels }, channels.map((channelData) => channelData.buffer));
    }

    return this.recording;
  }
}

registerProcessor('${AUDIO_WORKLET_PROCESSOR_NAME}', MasterSelectsPcmRecorderProcessor);
`;

function isPcmChunkMessage(value: unknown): value is { type: 'pcm'; channels: Float32Array[] } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'pcm' &&
    Array.isArray((value as { channels?: unknown }).channels),
  );
}

function encodeInterleavedFloat32Chunk(
  chunks: readonly Float32PcmChunk[],
  channelCount: number,
  frameCount: number,
): ArrayBuffer {
  const output = new Float32Array(Math.max(0, frameCount) * Math.max(1, channelCount));
  let outputFrame = 0;

  for (const chunk of chunks) {
    if (outputFrame >= frameCount) break;
    const chunkFrameCount = Math.min(
      chunk.frameCount ?? chunk.channels.reduce((max, channel) => Math.max(max, channel.length), 0),
      frameCount - outputFrame,
    );
    for (let frame = 0; frame < chunkFrameCount; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        output[(outputFrame + frame) * channelCount + channel] = chunk.channels[channel]?.[frame] ?? 0;
      }
    }
    outputFrame += chunkFrameCount;
  }

  return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
}

function isAudioWorkletStoppedMessage(value: unknown): value is { type: 'stopped' } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'stopped',
  );
}

export class AudioWorkletAudioCaptureBackend implements AudioRecordingCaptureBackend {
  async start(input: AudioRecordingCaptureStartInput): Promise<AudioRecordingCapture> {
    if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
      throw new Error('Audio input capture is not available in this browser.');
    }
    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) {
      throw new Error('AudioWorklet recording requires Web Audio support.');
    }
    if (!globalThis.AudioWorkletNode) {
      throw new Error('AudioWorklet recording is not available in this browser.');
    }
    if (!globalThis.URL?.createObjectURL || !globalThis.URL?.revokeObjectURL) {
      throw new Error('AudioWorklet recording cannot load the capture processor in this browser.');
    }

    const audioContext = new AudioContextCtor();
    if (!audioContext.audioWorklet) {
      await audioContext.close().catch(() => undefined);
      throw new Error('AudioWorklet recording requires BaseAudioContext.audioWorklet.');
    }
    const stream = await globalThis.navigator.mediaDevices.getUserMedia(
      createAudioInputConstraints(input.inputDeviceId),
    );

    let processorUrl: string | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let processor: AudioWorkletNode | undefined;
    let sink: GainNode | undefined;
    let finalized = false;
    let acceptingChunks = input.initiallyPaused !== true;
    let captureStartedAt = input.startedAt;
    let captureStartTime = input.startTime;
    let stopAckResolve: (() => void) | undefined;
    let stopAckTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const chunks: Float32PcmChunk[] = [];
    const pendingRecoveryWrites: Promise<unknown>[] = [];
    let frameCount = 0;
    let channelCount = 0;
    let recoveryChunkIndex = 0;
    let recoveryCheckpointStartFrame = 0;
    let recoveryCheckpointFrameCount = 0;
    let recoveryCheckpointChannelCount = 0;
    let recoveryCheckpointChunks: Float32PcmChunk[] = [];

    const resolveStopAck = (): void => {
      if (stopAckTimer !== undefined) {
        globalThis.clearTimeout(stopAckTimer);
        stopAckTimer = undefined;
      }
      stopAckResolve?.();
      stopAckResolve = undefined;
    };

    const requestStopAck = (): Promise<void> => new Promise(resolve => {
      if (!processor || finalized) {
        resolve();
        return;
      }
      stopAckResolve = resolve;
      stopAckTimer = globalThis.setTimeout(() => {
        stopAckTimer = undefined;
        resolveStopAck();
      }, AUDIO_WORKLET_STOP_ACK_TIMEOUT_MS);
      processor.port.postMessage({ type: 'stop' });
    });

    const flushRecoveryCheckpoint = (): void => {
      if (
        !input.chunkSink ||
        recoveryCheckpointFrameCount <= 0 ||
        !input.sessionId ||
        typeof captureStartedAt !== 'number'
      ) {
        recoveryCheckpointChunks = [];
        recoveryCheckpointFrameCount = 0;
        recoveryCheckpointChannelCount = 0;
        recoveryCheckpointStartFrame = frameCount;
        return;
      }

      const sampleRate = audioContext.sampleRate;
      const checkpointChunks = recoveryCheckpointChunks;
      const checkpointFrameCount = recoveryCheckpointFrameCount;
      const checkpointChannelCount = Math.max(1, recoveryCheckpointChannelCount);
      const checkpointStartFrame = recoveryCheckpointStartFrame;
      const payload = encodeInterleavedFloat32Chunk(
        checkpointChunks,
        checkpointChannelCount,
        checkpointFrameCount,
      );
      const blob = new Blob([payload], {
        type: 'application/vnd.masterselects.audio-recording-pcm-f32',
      });
      const chunkIndex = recoveryChunkIndex;
      recoveryChunkIndex += 1;

      pendingRecoveryWrites.push(input.chunkSink.writeChunk({
        sessionId: input.sessionId,
        inputDeviceId: input.inputDeviceId,
        trackIds: input.trackIds ?? [],
        chunkIndex,
        kind: 'audio-worklet-pcm-f32',
        blob,
        mimeType: blob.type,
        startedAt: captureStartedAt,
        startTime: captureStartTime ?? 0,
        timeStart: checkpointStartFrame / sampleRate,
        duration: checkpointFrameCount / sampleRate,
        sampleRate,
        channelCount: checkpointChannelCount,
        frameCount: checkpointFrameCount,
      }).catch(error => {
        log.warn('AudioWorklet recording recovery chunk write failed', { chunkIndex, error });
      }));

      recoveryCheckpointChunks = [];
      recoveryCheckpointFrameCount = 0;
      recoveryCheckpointChannelCount = 0;
      recoveryCheckpointStartFrame = frameCount;
    };

    const cleanup = async (): Promise<void> => {
      if (finalized) return;
      finalized = true;
      acceptingChunks = false;

      try {
        processor?.port.postMessage({ type: 'stop' });
      } catch {
        // Port may already be closed by the browser when the worklet stops.
      }
      resolveStopAck();
      if (processor) {
        processor.port.onmessage = null;
      }
      disconnectAudioNode(source);
      disconnectAudioNode(processor);
      disconnectAudioNode(sink);
      stopStream(stream);
      if (processorUrl) {
        globalThis.URL.revokeObjectURL(processorUrl);
      }
      await audioContext.close().catch(() => undefined);
    };

    try {
      processorUrl = globalThis.URL.createObjectURL(new Blob([AUDIO_WORKLET_PROCESSOR_SOURCE], {
        type: 'text/javascript',
      }));
      await audioContext.audioWorklet.addModule(processorUrl);
      source = audioContext.createMediaStreamSource(stream);
      processor = new AudioWorkletNode(audioContext, AUDIO_WORKLET_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      sink = audioContext.createGain();
      sink.gain.value = 0;

      processor.port.onmessage = (event: MessageEvent<unknown>) => {
        if (isAudioWorkletStoppedMessage(event.data)) {
          resolveStopAck();
          return;
        }
        if (!acceptingChunks || !isPcmChunkMessage(event.data)) return;

        const channels = event.data.channels
          .filter((channel): channel is Float32Array => channel instanceof Float32Array);
        const chunkFrameCount = channels.reduce(
          (maxFrames, channel) => Math.max(maxFrames, channel.length),
          0,
        );
        if (channels.length === 0 || chunkFrameCount <= 0) return;

        chunks.push({ channels, frameCount: chunkFrameCount });
        frameCount += chunkFrameCount;
        channelCount = Math.max(channelCount, channels.length);

        if (input.chunkSink) {
          recoveryCheckpointChunks.push({ channels, frameCount: chunkFrameCount });
          recoveryCheckpointFrameCount += chunkFrameCount;
          recoveryCheckpointChannelCount = Math.max(recoveryCheckpointChannelCount, channels.length);
          const targetFrames = Math.max(1, Math.floor(audioContext.sampleRate * input.timesliceMs / 1000));
          if (recoveryCheckpointFrameCount >= targetFrames) {
            flushRecoveryCheckpoint();
          }
        }
      };

      source.connect(processor);
      processor.connect(sink);
      sink.connect(audioContext.destination);
      await audioContext.resume().catch(() => undefined);

      return {
        mimeType: 'audio/wav',
        stream,
        resume: (resumeInput) => {
          captureStartedAt = resumeInput?.startedAt ?? captureStartedAt;
          captureStartTime = resumeInput?.startTime ?? captureStartTime;
          acceptingChunks = true;
        },
        stop: async () => {
          await requestStopAck();
          acceptingChunks = false;
          flushRecoveryCheckpoint();
          await Promise.allSettled(pendingRecoveryWrites);

          const finalFrameCount = frameCount;
          const finalChannelCount = Math.max(1, channelCount);
          const sampleRate = audioContext.sampleRate;
          const blob = encodeFloat32PcmChunksToWavBlob({
            sampleRate,
            channelCount: finalChannelCount,
            chunks,
            frameCount: finalFrameCount,
          });
          await cleanup();

          return {
            blob,
            mimeType: 'audio/wav',
            chunkCount: chunks.length,
            duration: finalFrameCount > 0 ? finalFrameCount / sampleRate : undefined,
            sampleRate,
            channelCount: finalChannelCount,
          };
        },
        cancel: cleanup,
      };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }
}
