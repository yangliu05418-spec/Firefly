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
  AudioArtifactRef,
  AudioChannelLayout,
} from './audioArtifactTypes';
import {
  AUDIO_EVENT_LIST_PAYLOAD_VERSION,
  BEAT_GRID_MANIFEST_VERSION,
  ONSET_MAP_MANIFEST_VERSION,
  createBeatGridManifest,
  createOnsetMapManifest,
  type BeatGridManifest,
  type OnsetMapManifest,
} from './beatOnsetManifest';
import {
  MAX_TEMPO_BPM,
  MIN_TEMPO_BPM,
  estimateBeatGrid,
} from './beatOnset/beatGridEstimation';
import type {
  BeatOnsetAnalysisContext,
  NormalizedBeatOnsetParameters,
} from './beatOnset/beatOnsetAnalysisTypes';
import { analyzeSpectralFlux } from './beatOnset/onsetDetection';
import {
  storeEventsPayload,
  summarizeOnsets,
} from './beatOnset/payloadAssembly';
export { AUDIO_EVENT_LIST_PAYLOAD_MIME_TYPE } from './beatOnset/payloadAssembly';

export const BEAT_ONSET_ANALYZER_VERSION = 'masterselects.beat-onset-analysis@1.0.0';

export type BeatOnsetAnalysisPhase =
  | 'queued'
  | 'analyzing'
  | 'storing-payloads'
  | 'storing-manifests'
  | 'complete'
  | 'cancelled'
  | 'failed';

export type BeatOnsetAnalysisErrorCode =
  | 'cancelled'
  | 'invalid-audio-buffer'
  | 'invalid-parameters'
  | 'artifact-store-failed';

export interface BeatOnsetAnalysisProgress {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  phase: BeatOnsetAnalysisPhase;
  percent: number;
  timestamp: string;
  onsetCacheKey: string;
  beatCacheKey: string;
  frameIndex?: number;
  frameCount?: number;
  message?: string;
}

export interface BeatOnsetAnalysisGeneratorOptions {
  artifactStore: AudioArtifactStore;
  analyzerVersion?: string;
  now?: () => string;
  createJobId?: () => string;
}

export interface BeatOnsetAnalysisRequest {
  jobId?: string;
  mediaFileId: string;
  sourceFingerprint: string;
  buffer: AudioBuffer;
  clipAudioStateHash?: string;
  fftSize?: 1024 | 2048 | 4096;
  hopSize?: number;
  decoderId?: string;
  decoderVersion?: string;
  metadata?: SignalMetadata;
}

export interface BeatOnsetAnalysisResult {
  jobId: string;
  onsetCacheKey: string;
  beatCacheKey: string;
  onsetAnalysisRef: AudioAnalysisManifestRef;
  beatAnalysisRef: AudioAnalysisManifestRef;
  onsetArtifact: AudioAnalysisArtifact;
  beatArtifact: AudioAnalysisArtifact;
  onsetManifest: OnsetMapManifest;
  beatManifest: BeatGridManifest;
  onsetPayloadRef: AudioArtifactRef;
  beatPayloadRef: AudioArtifactRef;
}

const DEFAULT_FFT_SIZE = 1024 as const;
const DEFAULT_HOP_SIZE = 512;
const DEFAULT_DECODER_ID = 'audio-buffer';
const DEFAULT_DECODER_VERSION = '1.0.0';
const textEncoder = new TextEncoder();

export class BeatOnsetAnalysisGeneratorError extends Error {
  readonly code: BeatOnsetAnalysisErrorCode;
  readonly jobId: string;
  readonly recoverable: boolean;

  constructor(
    message: string,
    options: {
      code: BeatOnsetAnalysisErrorCode;
      jobId: string;
      recoverable?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = options.code === 'cancelled'
      ? 'BeatOnsetAnalysisCancelledError'
      : 'BeatOnsetAnalysisGeneratorError';
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
  return `beat-onset:${randomId}`;
}

function getAbortReason(signal: AbortSignal): unknown {
  return 'reason' in signal ? signal.reason : undefined;
}

function cancelledError(jobId: string, reason?: unknown): BeatOnsetAnalysisGeneratorError {
  const suffix = reason === undefined ? '' : `: ${String(reason)}`;
  return new BeatOnsetAnalysisGeneratorError(`Beat/onset analysis ${jobId} was cancelled${suffix}`, {
    code: 'cancelled',
    jobId,
    recoverable: true,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCancellationError(error: unknown): error is BeatOnsetAnalysisGeneratorError {
  return error instanceof BeatOnsetAnalysisGeneratorError && error.code === 'cancelled';
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

function describeDisplayChannelLayout(): AudioChannelLayout {
  return { kind: 'mono', channelCount: 1, labels: ['Mix'] };
}

function describeSourceChannelLayout(channelCount: number): AudioChannelLayout {
  if (channelCount === 1) return { kind: 'mono', channelCount, labels: ['M'] };
  if (channelCount === 2) return { kind: 'stereo', channelCount, labels: ['L', 'R'] };
  if (channelCount > 2 && channelCount <= 8) return { kind: 'surround', channelCount };
  if (channelCount > 8) return { kind: 'discrete', channelCount };
  return { kind: 'unknown', channelCount: Math.max(0, channelCount) };
}

function validateAudioBuffer(buffer: AudioBuffer, jobId: string): void {
  if (!buffer || typeof buffer !== 'object') {
    throw new BeatOnsetAnalysisGeneratorError('Beat/onset analysis requires an AudioBuffer.', {
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
    throw new BeatOnsetAnalysisGeneratorError('AudioBuffer metadata is invalid for beat/onset analysis.', {
      code: 'invalid-audio-buffer',
      jobId,
      recoverable: false,
    });
  }
}

function normalizeParameters(
  request: BeatOnsetAnalysisRequest,
  jobId: string,
): NormalizedBeatOnsetParameters {
  const fftSize = request.fftSize ?? DEFAULT_FFT_SIZE;
  if (![1024, 2048, 4096].includes(fftSize)) {
    throw new BeatOnsetAnalysisGeneratorError('Beat/onset fftSize must be 1024, 2048, or 4096.', {
      code: 'invalid-parameters',
      jobId,
      recoverable: false,
    });
  }

  const hopSize = Math.max(1, Math.floor(request.hopSize ?? Math.min(DEFAULT_HOP_SIZE, fftSize / 2)));
  return {
    fftSize,
    hopSize,
    frameCount: Math.max(1, Math.ceil(Math.max(1, request.buffer.length) / hopSize)),
  };
}

async function deterministicHashId(prefix: string, cacheKey: string): Promise<string> {
  const bytes = textEncoder.encode(cacheKey);
  const hash = await sha256ArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return `${prefix}:${hash}`;
}

export function createBeatOnsetAnalyzerVersion(
  parameters: Pick<NormalizedBeatOnsetParameters, 'fftSize' | 'hopSize'>,
  baseVersion = BEAT_ONSET_ANALYZER_VERSION,
): string {
  return [
    baseVersion,
    `onsetManifest=v${ONSET_MAP_MANIFEST_VERSION}`,
    `beatManifest=v${BEAT_GRID_MANIFEST_VERSION}`,
    `payload=v${AUDIO_EVENT_LIST_PAYLOAD_VERSION}`,
    `fft=${parameters.fftSize}`,
    `hop=${parameters.hopSize}`,
    'window=hann',
    'onset=spectral-flux-adaptive',
    `tempo=${MIN_TEMPO_BPM}-${MAX_TEMPO_BPM}`,
    'channels=mono-mix',
  ].join(';');
}

export class BeatOnsetAnalysisGenerator {
  private readonly artifactStore: AudioArtifactStore;
  private readonly baseAnalyzerVersion: string;
  private readonly now: () => string;
  private readonly createJobId: () => string;

  constructor(options: BeatOnsetAnalysisGeneratorOptions) {
    this.artifactStore = options.artifactStore;
    this.baseAnalyzerVersion = options.analyzerVersion ?? BEAT_ONSET_ANALYZER_VERSION;
    this.now = options.now ?? defaultNow;
    this.createJobId = options.createJobId ?? defaultJobId;
  }

  async generate(
    request: BeatOnsetAnalysisRequest,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: BeatOnsetAnalysisProgress) => void;
    } = {},
  ): Promise<BeatOnsetAnalysisResult> {
    const jobId = request.jobId ?? this.createJobId();
    const generatedAt = this.now();
    let progressContext: BeatOnsetAnalysisContext | null = null;

    try {
      validateAudioBuffer(request.buffer, jobId);
      const parameters = normalizeParameters(request, jobId);
      const analyzerVersion = createBeatOnsetAnalyzerVersion(parameters, this.baseAnalyzerVersion);
      const channelLayout = describeDisplayChannelLayout();
      const onsetCacheKey = createAudioAnalysisCacheKey({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        kind: 'onset-map',
        analyzerVersion,
        channelLayout,
        sampleRate: request.buffer.sampleRate,
        duration: request.buffer.duration,
        clipAudioStateHash: request.clipAudioStateHash,
      });
      const beatCacheKey = createAudioAnalysisCacheKey({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        kind: 'beat-grid',
        analyzerVersion,
        channelLayout,
        sampleRate: request.buffer.sampleRate,
        duration: request.buffer.duration,
        clipAudioStateHash: request.clipAudioStateHash,
      });
      const context: BeatOnsetAnalysisContext = {
        jobId,
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        onsetCacheKey,
        beatCacheKey,
        signal: options.signal,
        onProgress: options.onProgress,
      };
      progressContext = context;

      this.emitProgress(context, {
        phase: 'queued',
        percent: 0,
        timestamp: generatedAt,
        message: 'Queued beat/onset analysis',
      });

      const fluxAnalysis = analyzeSpectralFlux(request.buffer, parameters, context, throwIfCancelled);
      const beatEstimate = estimateBeatGrid(fluxAnalysis.onsets, request.buffer.duration);

      const onsetPayloadRef = await storeEventsPayload({
        artifactStore: this.artifactStore,
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        kind: 'onset-map',
        cacheKey: onsetCacheKey,
        analyzerVersion,
        generatedAt,
        events: fluxAnalysis.onsets,
        context,
        now: this.now,
        throwIfCancelled,
      });
      const onsetManifest = createOnsetMapManifest({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        sampleRate: request.buffer.sampleRate,
        channelLayout,
        duration: request.buffer.duration,
        fftSize: parameters.fftSize,
        hopSize: parameters.hopSize,
        detectionFunction: 'spectral-flux',
        eventCount: fluxAnalysis.onsets.length,
        eventsPayloadRef: onsetPayloadRef,
        summary: summarizeOnsets(fluxAnalysis.onsets),
      });

      const onsetArtifactId = await deterministicHashId('audio:onset-map', onsetCacheKey);
      this.emitProgress(context, {
        phase: 'storing-manifests',
        percent: 86,
        timestamp: this.now(),
        message: 'Storing onset manifest',
      });
      const onsetArtifactResult = await this.artifactStore.putAnalysisArtifact({
        id: onsetArtifactId,
        kind: 'onset-map',
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        decoderId: request.decoderId ?? DEFAULT_DECODER_ID,
        decoderVersion: request.decoderVersion ?? DEFAULT_DECODER_VERSION,
        analyzerVersion,
        sampleRate: request.buffer.sampleRate,
        channelLayout,
        duration: request.buffer.duration,
        payloadRefs: [onsetPayloadRef],
        createdAt: toTimestamp(generatedAt),
        stale: false,
        metadata: {
          ...(request.metadata ?? {}),
          analysisKind: 'onset-map',
          cacheKey: onsetCacheKey,
          sourceChannelLayout: describeSourceChannelLayout(request.buffer.numberOfChannels) as unknown as JsonValue,
          onsetMapManifest: onsetManifest as unknown as JsonValue,
        },
      });

      const beatPayloadRef = await storeEventsPayload({
        artifactStore: this.artifactStore,
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        kind: 'beat-grid',
        cacheKey: beatCacheKey,
        analyzerVersion,
        generatedAt,
        events: beatEstimate.beats,
        context,
        now: this.now,
        throwIfCancelled,
      });
      const beatManifest = createBeatGridManifest({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        sampleRate: request.buffer.sampleRate,
        channelLayout,
        duration: request.buffer.duration,
        tempoBpm: beatEstimate.tempoBpm,
        beatCount: beatEstimate.beats.length,
        beatsPayloadRef: beatPayloadRef,
        sourceOnsetMapArtifactId: onsetArtifactResult.artifact.manifestRef.artifactId,
        summary: {
          beatCount: beatEstimate.beats.length,
          tempoBpm: beatEstimate.tempoBpm,
          confidence: beatEstimate.confidence,
        },
      });
      const beatArtifactId = await deterministicHashId('audio:beat-grid', beatCacheKey);

      this.emitProgress(context, {
        phase: 'storing-manifests',
        percent: 96,
        timestamp: this.now(),
        message: 'Storing beat grid manifest',
      });
      const beatArtifactResult = await this.artifactStore.putAnalysisArtifact({
        id: beatArtifactId,
        kind: 'beat-grid',
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        decoderId: request.decoderId ?? DEFAULT_DECODER_ID,
        decoderVersion: request.decoderVersion ?? DEFAULT_DECODER_VERSION,
        analyzerVersion,
        sampleRate: request.buffer.sampleRate,
        channelLayout,
        duration: request.buffer.duration,
        payloadRefs: [beatPayloadRef],
        createdAt: toTimestamp(generatedAt),
        stale: false,
        metadata: {
          ...(request.metadata ?? {}),
          analysisKind: 'beat-grid',
          cacheKey: beatCacheKey,
          sourceChannelLayout: describeSourceChannelLayout(request.buffer.numberOfChannels) as unknown as JsonValue,
          beatGridManifest: beatManifest as unknown as JsonValue,
        },
      });

      this.emitProgress(context, {
        phase: 'complete',
        percent: 100,
        timestamp: this.now(),
        message: 'Beat/onset analysis complete',
      });

      return {
        jobId,
        onsetCacheKey,
        beatCacheKey,
        onsetAnalysisRef: createAudioAnalysisManifestRefFromArtifact(onsetArtifactResult.artifact),
        beatAnalysisRef: createAudioAnalysisManifestRefFromArtifact(beatArtifactResult.artifact),
        onsetArtifact: onsetArtifactResult.artifact,
        beatArtifact: beatArtifactResult.artifact,
        onsetManifest,
        beatManifest,
        onsetPayloadRef,
        beatPayloadRef,
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
          onsetCacheKey: 'cancelled-before-onset-cache-key',
          beatCacheKey: 'cancelled-before-beat-cache-key',
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

      throw error instanceof BeatOnsetAnalysisGeneratorError
        ? error
        : new BeatOnsetAnalysisGeneratorError(
          `Beat/onset analysis ${jobId} failed: ${errorMessage(error)}`,
          {
            code: 'artifact-store-failed',
            jobId,
            cause: error,
          },
        );
    }
  }

  private emitProgress(
    context: BeatOnsetAnalysisContext,
    update: Omit<
      BeatOnsetAnalysisProgress,
      'jobId' | 'mediaFileId' | 'sourceFingerprint' | 'onsetCacheKey' | 'beatCacheKey'
    >,
    checkCancellation = true,
  ): void {
    const progress: BeatOnsetAnalysisProgress = {
      ...update,
      jobId: context.jobId,
      mediaFileId: context.mediaFileId,
      sourceFingerprint: context.sourceFingerprint,
      onsetCacheKey: context.onsetCacheKey,
      beatCacheKey: context.beatCacheKey,
      percent: clampPercent(update.percent),
    };
    context.onProgress?.(progress);

    if (checkCancellation) {
      throwIfCancelled(context.signal, context.jobId);
    }
  }
}
