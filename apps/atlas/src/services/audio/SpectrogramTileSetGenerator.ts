import { sha256ArrayBuffer } from '../../artifacts';
import type { JsonValue, SignalMetadata } from '../../signals';
import {
  createAudioAnalysisCacheKey,
  createAudioAnalysisManifestRefFromArtifact,
  type AudioAnalysisManifestRef,
} from './audioAnalysisManifestKeys';
import type { AudioArtifactStore } from './AudioArtifactStore';
import type {
  AudioAnalysisArtifact,
  AudioAnalysisWarning,
  AudioArtifactRef,
  AudioChannelLayout,
} from './audioArtifactTypes';
import {
  SPECTROGRAM_TILE_PAYLOAD_VERSION,
  SPECTROGRAM_TILE_SET_MANIFEST_VERSION,
  createSpectrogramTileSetManifest,
  type SpectrogramFftSize,
  type SpectrogramTileSetManifest,
} from './spectrogramTileManifest';
import { generateAndStoreSpectrogramTiles } from './spectrogram/payloadAssembly';

export { SPECTROGRAM_TILE_PAYLOAD_MIME_TYPE } from './spectrogram/payloadAssembly';

export const SPECTROGRAM_TILE_SET_GENERATOR_VERSION = 'masterselects.spectrogram-tile-set-generator@1.0.0';

export type SpectrogramTileSetGenerationPhase =
  | 'queued'
  | 'analyzing'
  | 'storing-payloads'
  | 'storing-manifest'
  | 'complete'
  | 'cancelled'
  | 'failed';

export type SpectrogramTileSetGeneratorErrorCode =
  | 'cancelled'
  | 'invalid-audio-buffer'
  | 'invalid-parameters'
  | 'artifact-store-failed';

export interface SpectrogramTileSetGenerationProgress {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  phase: SpectrogramTileSetGenerationPhase;
  percent: number;
  timestamp: string;
  cacheKey: string;
  tileIndex?: number;
  frameStart?: number;
  frameCount?: number;
  message?: string;
}

export interface SpectrogramTileSetGeneratorOptions {
  artifactStore: AudioArtifactStore;
  analyzerVersion?: string;
  now?: () => string;
  createJobId?: () => string;
}

export interface SpectrogramTileSetGenerateRequest {
  jobId?: string;
  mediaFileId: string;
  sourceFingerprint: string;
  buffer: AudioBuffer;
  clipAudioStateHash?: string;
  fftSize?: SpectrogramFftSize;
  hopSize?: number;
  targetMaxFrames?: number;
  tileWidthFrames?: number;
  minDb?: number;
  maxDb?: number;
  decoderId?: string;
  decoderVersion?: string;
  metadata?: SignalMetadata;
}

export interface SpectrogramTileSetGenerationResult {
  jobId: string;
  cacheKey: string;
  analysisRef: AudioAnalysisManifestRef;
  artifact: AudioAnalysisArtifact;
  manifest: SpectrogramTileSetManifest;
  payloadRefs: AudioArtifactRef[];
  warnings: AudioAnalysisWarning[];
}

interface GenerationContext {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  cacheKey: string;
  signal?: AbortSignal;
  onProgress?: (progress: SpectrogramTileSetGenerationProgress) => void;
}

interface NormalizedSpectrogramParameters {
  fftSize: SpectrogramFftSize;
  hopSize: number;
  targetMaxFrames: number;
  tileWidthFrames: number;
  minDb: number;
  maxDb: number;
  frequencyBinCount: number;
  frameCount: number;
}

const DEFAULT_FFT_SIZE: SpectrogramFftSize = 1024;
const DEFAULT_TARGET_MAX_FRAMES = 2048;
const DEFAULT_TILE_WIDTH_FRAMES = 512;
const DEFAULT_MIN_DB = -96;
const DEFAULT_MAX_DB = 0;
const MIN_HOP_SIZE = 256;
const DEFAULT_DECODER_ID = 'audio-buffer';
const DEFAULT_DECODER_VERSION = '1.0.0';
const textEncoder = new TextEncoder();

export class SpectrogramTileSetGeneratorError extends Error {
  readonly code: SpectrogramTileSetGeneratorErrorCode;
  readonly jobId: string;
  readonly recoverable: boolean;

  constructor(
    message: string,
    options: {
      code: SpectrogramTileSetGeneratorErrorCode;
      jobId: string;
      recoverable?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = options.code === 'cancelled'
      ? 'SpectrogramTileSetGenerationCancelledError'
      : 'SpectrogramTileSetGeneratorError';
    this.code = options.code;
    this.jobId = options.jobId;
    this.recoverable = options.recoverable ?? options.code !== 'invalid-audio-buffer';
  }
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultJobId(): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `spectrogram-tile-set:${randomId}`;
}

function getAbortReason(signal: AbortSignal): unknown {
  return 'reason' in signal ? signal.reason : undefined;
}

function cancelledError(jobId: string, reason?: unknown): SpectrogramTileSetGeneratorError {
  const suffix = reason === undefined ? '' : `: ${String(reason)}`;
  return new SpectrogramTileSetGeneratorError(`Spectrogram tile set generation ${jobId} was cancelled${suffix}`, {
    code: 'cancelled',
    jobId,
    recoverable: true,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCancellationError(error: unknown): error is SpectrogramTileSetGeneratorError {
  return error instanceof SpectrogramTileSetGeneratorError && error.code === 'cancelled';
}

function throwIfCancelled(signal: AbortSignal | undefined, jobId: string): void {
  if (signal?.aborted) {
    throw cancelledError(jobId, getAbortReason(signal));
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function finiteNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function describeSourceChannelLayout(channelCount: number): AudioChannelLayout {
  if (channelCount === 1) return { kind: 'mono', channelCount, labels: ['M'] };
  if (channelCount === 2) return { kind: 'stereo', channelCount, labels: ['L', 'R'] };
  if (channelCount > 2 && channelCount <= 8) return { kind: 'surround', channelCount };
  if (channelCount > 8) return { kind: 'discrete', channelCount };
  return { kind: 'unknown', channelCount: Math.max(0, channelCount) };
}

function describeDisplayChannelLayout(): AudioChannelLayout {
  return { kind: 'mono', channelCount: 1, labels: ['Mix'] };
}

function validateAudioBuffer(buffer: AudioBuffer, jobId: string): void {
  if (!buffer || typeof buffer !== 'object') {
    throw new SpectrogramTileSetGeneratorError('Spectrogram tile set generation requires an AudioBuffer.', {
      code: 'invalid-audio-buffer',
      jobId,
      recoverable: false,
    });
  }

  if (
    !Number.isInteger(buffer.numberOfChannels)
    || buffer.numberOfChannels < 1
    || !Number.isInteger(buffer.length)
    || buffer.length < 0
    || !finiteNumber(buffer.sampleRate)
    || buffer.sampleRate <= 0
    || !finiteNumber(buffer.duration)
    || buffer.duration < 0
    || typeof buffer.getChannelData !== 'function'
  ) {
    throw new SpectrogramTileSetGeneratorError('AudioBuffer metadata is invalid for spectrogram tile set generation.', {
      code: 'invalid-audio-buffer',
      jobId,
      recoverable: false,
    });
  }
}

function normalizeFftSize(value: SpectrogramFftSize | undefined, jobId: string): SpectrogramFftSize {
  const fftSize = value ?? DEFAULT_FFT_SIZE;
  if (![1024, 2048, 4096, 8192].includes(fftSize)) {
    throw new SpectrogramTileSetGeneratorError('Spectrogram fftSize must be 1024, 2048, 4096, or 8192.', {
      code: 'invalid-parameters',
      jobId,
      recoverable: false,
    });
  }
  return fftSize;
}

function normalizeParameters(
  request: SpectrogramTileSetGenerateRequest,
  jobId: string,
): NormalizedSpectrogramParameters {
  const fftSize = normalizeFftSize(request.fftSize, jobId);
  const targetMaxFrames = Math.max(1, Math.floor(request.targetMaxFrames ?? DEFAULT_TARGET_MAX_FRAMES));
  const inferredHopSize = Math.max(MIN_HOP_SIZE, Math.ceil(Math.max(1, request.buffer.length) / targetMaxFrames));
  const hopSize = Math.max(1, Math.floor(request.hopSize ?? inferredHopSize));
  const tileWidthFrames = Math.max(1, Math.floor(request.tileWidthFrames ?? DEFAULT_TILE_WIDTH_FRAMES));
  const minDb = request.minDb ?? DEFAULT_MIN_DB;
  const maxDb = request.maxDb ?? DEFAULT_MAX_DB;

  if (!Number.isFinite(minDb) || !Number.isFinite(maxDb) || minDb >= maxDb) {
    throw new SpectrogramTileSetGeneratorError('Spectrogram minDb must be lower than maxDb.', {
      code: 'invalid-parameters',
      jobId,
      recoverable: false,
    });
  }

  return {
    fftSize,
    hopSize,
    targetMaxFrames,
    tileWidthFrames,
    minDb,
    maxDb,
    frequencyBinCount: fftSize / 2,
    frameCount: Math.max(1, Math.ceil(Math.max(1, request.buffer.length) / hopSize)),
  };
}

async function deterministicHashId(prefix: string, cacheKey: string): Promise<string> {
  const bytes = textEncoder.encode(cacheKey);
  const hash = await sha256ArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return `${prefix}:${hash}`;
}

export function createSpectrogramTileSetAnalyzerVersion(
  parameters: Pick<
    NormalizedSpectrogramParameters,
    'fftSize' | 'hopSize' | 'tileWidthFrames' | 'minDb' | 'maxDb'
  >,
  baseVersion = SPECTROGRAM_TILE_SET_GENERATOR_VERSION,
): string {
  return [
    baseVersion,
    `manifest=v${SPECTROGRAM_TILE_SET_MANIFEST_VERSION}`,
    `payload=v${SPECTROGRAM_TILE_PAYLOAD_VERSION}`,
    `fft=${parameters.fftSize}`,
    `hop=${parameters.hopSize}`,
    `window=hann`,
    `scale=linear`,
    `minDb=${parameters.minDb}`,
    `maxDb=${parameters.maxDb}`,
    `tileWidth=${parameters.tileWidthFrames}`,
    'channels=mono-mix',
  ].join(';');
}

export class SpectrogramTileSetGenerator {
  private readonly artifactStore: AudioArtifactStore;
  private readonly baseAnalyzerVersion: string;
  private readonly now: () => string;
  private readonly createJobId: () => string;

  constructor(options: SpectrogramTileSetGeneratorOptions) {
    this.artifactStore = options.artifactStore;
    this.baseAnalyzerVersion = options.analyzerVersion ?? SPECTROGRAM_TILE_SET_GENERATOR_VERSION;
    this.now = options.now ?? defaultNow;
    this.createJobId = options.createJobId ?? defaultJobId;
  }

  async generate(
    request: SpectrogramTileSetGenerateRequest,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: SpectrogramTileSetGenerationProgress) => void;
    } = {},
  ): Promise<SpectrogramTileSetGenerationResult> {
    const jobId = request.jobId ?? this.createJobId();
    const generatedAt = this.now();
    let progressContext: GenerationContext | null = null;

    try {
      validateAudioBuffer(request.buffer, jobId);
      const parameters = normalizeParameters(request, jobId);
      const analyzerVersion = createSpectrogramTileSetAnalyzerVersion(parameters, this.baseAnalyzerVersion);
      const channelLayout = describeDisplayChannelLayout();
      const cacheKey = createAudioAnalysisCacheKey({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        kind: 'spectrogram-tiles',
        analyzerVersion,
        channelLayout,
        sampleRate: request.buffer.sampleRate,
        duration: request.buffer.duration,
        clipAudioStateHash: request.clipAudioStateHash,
      });
      const context: GenerationContext = {
        jobId,
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        cacheKey,
        signal: options.signal,
        onProgress: options.onProgress,
      };
      progressContext = context;

      this.emitProgress(context, {
        phase: 'queued',
        percent: 0,
        timestamp: generatedAt,
        message: 'Queued spectrogram tile set generation',
      });
      throwIfCancelled(options.signal, jobId);

      const stored = await generateAndStoreSpectrogramTiles({
        artifactStore: this.artifactStore,
        buffer: request.buffer,
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        cacheKey: context.cacheKey,
        parameters,
        analyzerVersion,
        generatedAt,
        now: this.now,
        emitProgress: (update) => this.emitProgress(context, update),
        throwIfCancelled: () => throwIfCancelled(context.signal, context.jobId),
      });
      const manifest = createSpectrogramTileSetManifest({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        sampleRate: request.buffer.sampleRate,
        channelLayout,
        duration: request.buffer.duration,
        fftSize: parameters.fftSize,
        hopSize: parameters.hopSize,
        window: 'hann',
        frequencyScale: 'linear',
        minDb: parameters.minDb,
        maxDb: parameters.maxDb,
        tileWidthFrames: parameters.tileWidthFrames,
        tileHeightBins: parameters.frequencyBinCount,
        tiles: stored.tiles,
      });
      const artifactId = await deterministicHashId('audio:spectrogram-tiles', cacheKey);

      this.emitProgress(context, {
        phase: 'storing-manifest',
        percent: 98,
        timestamp: this.now(),
        message: 'Storing spectrogram tile set manifest',
      });
      throwIfCancelled(options.signal, jobId);

      const artifactResult = await this.artifactStore.putAnalysisArtifact({
        id: artifactId,
        kind: 'spectrogram-tiles',
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        decoderId: request.decoderId ?? DEFAULT_DECODER_ID,
        decoderVersion: request.decoderVersion ?? DEFAULT_DECODER_VERSION,
        analyzerVersion,
        sampleRate: request.buffer.sampleRate,
        channelLayout,
        duration: request.buffer.duration,
        payloadRefs: stored.payloadRefs,
        createdAt: toTimestamp(generatedAt),
        stale: false,
        warnings: stored.warnings.length > 0 ? stored.warnings : undefined,
        metadata: {
          ...(request.metadata ?? {}),
          analysisKind: 'spectrogram-tiles',
          cacheKey,
          sourceChannelLayout: describeSourceChannelLayout(request.buffer.numberOfChannels) as unknown as JsonValue,
          spectrogramTileSetManifest: manifest as unknown as JsonValue,
        },
      });
      const analysisRef = createAudioAnalysisManifestRefFromArtifact(artifactResult.artifact);

      this.emitProgress(context, {
        phase: 'complete',
        percent: 100,
        timestamp: this.now(),
        message: 'Spectrogram tile set generation complete',
      });

      return {
        jobId,
        cacheKey,
        analysisRef,
        artifact: artifactResult.artifact,
        manifest,
        payloadRefs: stored.payloadRefs,
        warnings: stored.warnings,
      };
    } catch (error) {
      if (isCancellationError(error) || options.signal?.aborted) {
        const cancellation = isCancellationError(error)
          ? error
          : cancelledError(jobId, options.signal ? getAbortReason(options.signal) : undefined);
        this.emitProgress(progressContext ?? {
          jobId,
          mediaFileId: request.mediaFileId,
          sourceFingerprint: request.sourceFingerprint,
          cacheKey: 'cancelled-before-cache-key',
          signal: options.signal,
          onProgress: options.onProgress,
        }, {
          phase: 'cancelled',
          percent: 0,
          timestamp: this.now(),
          message: cancellation.message,
        }, false);
        throw cancellation;
      }

      throw error instanceof SpectrogramTileSetGeneratorError
        ? error
        : new SpectrogramTileSetGeneratorError(
          `Spectrogram tile set generation ${jobId} failed: ${errorMessage(error)}`,
          {
            code: 'artifact-store-failed',
            jobId,
            cause: error,
          },
        );
    }
  }

  private emitProgress(
    context: GenerationContext,
    update: Omit<
      SpectrogramTileSetGenerationProgress,
      'jobId' | 'mediaFileId' | 'sourceFingerprint' | 'cacheKey'
    >,
    checkCancellation = true,
  ): void {
    const progress: SpectrogramTileSetGenerationProgress = {
      ...update,
      jobId: context.jobId,
      mediaFileId: context.mediaFileId,
      sourceFingerprint: context.sourceFingerprint,
      cacheKey: context.cacheKey,
      percent: clampPercent(update.percent),
    };
    context.onProgress?.(progress);

    if (checkCancellation) {
      throwIfCancelled(context.signal, context.jobId);
    }
  }
}
