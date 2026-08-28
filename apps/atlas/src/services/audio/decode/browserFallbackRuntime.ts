import type {
  AudioDecodeRuntime,
} from '../audioDecodeTypes';
import { AudioDecodeServiceError } from './errors';
import {
  decodedPcmBytes,
  enforceDecodedPcmLimit,
  validateAudioBuffer,
} from './resultMapping';

const MEBIBYTE = 1024 * 1024;

export const BROWSER_AUDIO_DECODE_DECODER_ID = 'browser.decodeAudioData';
export const BROWSER_AUDIO_DECODE_DECODER_VERSION = '1.0.0';

export const DEFAULT_BROWSER_AUDIO_DECODE_LIMITS = {
  maxSourceBytes: 256 * MEBIBYTE,
  maxDecodedPcmBytes: 768 * MEBIBYTE,
} as const;

export interface BrowserAudioDecodeLimits {
  maxSourceBytes: number;
  maxDecodedPcmBytes: number;
}

export interface BrowserAudioDecodeRuntimeOptions {
  limits?: Partial<BrowserAudioDecodeLimits>;
  createAudioContext?: () => AudioContext;
}

function cloneArrayBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return buffer.slice(0);
}

function normalizeByteLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}

export function normalizeBrowserLimits(
  limits?: Partial<BrowserAudioDecodeLimits>,
): BrowserAudioDecodeLimits {
  return {
    maxSourceBytes: normalizeByteLimit(
      limits?.maxSourceBytes,
      DEFAULT_BROWSER_AUDIO_DECODE_LIMITS.maxSourceBytes,
    ),
    maxDecodedPcmBytes: normalizeByteLimit(
      limits?.maxDecodedPcmBytes,
      DEFAULT_BROWSER_AUDIO_DECODE_LIMITS.maxDecodedPcmBytes,
    ),
  };
}

export function createBrowserAudioDecodeRuntime(
  options: BrowserAudioDecodeRuntimeOptions = {},
): AudioDecodeRuntime {
  const limits = normalizeBrowserLimits(options.limits);
  let audioContext: AudioContext | null = null;

  const getContext = (): AudioContext => {
    if (audioContext) {
      return audioContext;
    }

    if (options.createAudioContext) {
      audioContext = options.createAudioContext();
      return audioContext;
    }

    if (typeof AudioContext === 'undefined') {
      throw new AudioDecodeServiceError('Browser AudioContext is not available for fallback decoding.', {
        code: 'browser-fallback-unavailable',
        jobId: 'unassigned',
      });
    }

    audioContext = new AudioContext();
    return audioContext;
  };

  const runtime: AudioDecodeRuntime = {
    id: BROWSER_AUDIO_DECODE_DECODER_ID,
    version: BROWSER_AUDIO_DECODE_DECODER_VERSION,
    kind: 'browser-fallback',
    canDecode: (_request, context) => {
      if (context.sourceInfo.size > limits.maxSourceBytes) {
        return false;
      }

      return Boolean(options.createAudioContext || typeof AudioContext !== 'undefined');
    },
    decode: async (_request, context) => {
      if (context.sourceInfo.size > limits.maxSourceBytes) {
        throw new AudioDecodeServiceError(
          `Browser audio fallback is limited to ${limits.maxSourceBytes} bytes; source is ${context.sourceInfo.size} bytes.`,
          {
            code: 'browser-fallback-source-too-large',
            jobId: context.jobId,
          },
        );
      }

      context.throwIfCancelled();
      context.reportProgress({ phase: 'reading', percent: 5, message: 'Reading audio source' });
      const sourceBytes = await context.readSourceBytes();
      context.throwIfCancelled();
      context.reportProgress({ phase: 'decoding', percent: 20, message: 'Decoding with browser AudioContext' });

      const decoded = await getContext().decodeAudioData(cloneArrayBuffer(sourceBytes));
      context.throwIfCancelled();

      validateAudioBuffer(decoded, context.jobId, runtime);
      const pcmBytes = decodedPcmBytes(decoded);
      enforceDecodedPcmLimit(pcmBytes, limits.maxDecodedPcmBytes, context.jobId, runtime);

      context.reportProgress({ phase: 'finalizing', percent: 95, message: 'Finalizing decoded audio' });
      return { buffer: decoded };
    },
    dispose: () => {
      const closingContext = audioContext;
      audioContext = null;
      closingContext?.close().catch(() => {});
    },
  };

  return runtime;
}
