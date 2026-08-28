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
  createPowerLoudnessCurve,
  createRawMonoMix,
  createRawPeakEnvelope,
  createRawSquarePrefix,
  createRmsCurve,
  createSamplePeakCurve,
} from './loudness/envelopeDownsampling';
import {
  computeIntegratedLufs,
  computePreviewTruePeakDbtp,
  computeRawRmsDbfs,
  computeSamplePeakDbfs,
} from './loudness/gatingIntegration';
import { createWeightedKPower } from './loudness/kWeighting';
import { createPowerPrefix } from './loudness/loudnessMath';
import {
  type LoudnessAnalysisContext,
  type LoudnessAnalysisResult,
  type LoudnessCurveData,
  type NormalizedLoudnessParameters,
} from './loudness/loudnessAnalysisTypes';
import {
  LOUDNESS_CURVE_PAYLOAD_MIME_TYPE,
  storeLoudnessCurvePayloads,
} from './loudness/payloadAssembly';
import {
  LOUDNESS_CURVE_PAYLOAD_VERSION,
  LOUDNESS_ENVELOPE_MANIFEST_VERSION,
  createLoudnessEnvelopeManifest,
  type LoudnessEnvelopeManifest,
  type LoudnessEnvelopeMetric,
  type LoudnessEnvelopeSummary,
} from './loudnessEnvelopeManifest';

export const LOUDNESS_ENVELOPE_GENERATOR_VERSION = 'masterselects.loudness-envelope-generator@1.0.0';
export { LOUDNESS_CURVE_PAYLOAD_MIME_TYPE };

export type LoudnessEnvelopeGenerationPhase =
  | 'queued'
  | 'analyzing'
  | 'storing-payloads'
  | 'storing-manifest'
  | 'complete'
  | 'cancelled'
  | 'failed';

export type LoudnessEnvelopeGeneratorErrorCode =
  | 'cancelled'
  | 'invalid-audio-buffer'
  | 'invalid-parameters'
  | 'artifact-store-failed';

export interface LoudnessEnvelopeGenerationProgress {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  phase: LoudnessEnvelopeGenerationPhase;
  percent: number;
  timestamp: string;
  cacheKey: string;
  metric?: LoudnessEnvelopeMetric;
  pointCount?: number;
  message?: string;
}

export interface LoudnessEnvelopeGeneratorOptions {
  artifactStore: AudioArtifactStore;
  analyzerVersion?: string;
  now?: () => string;
  createJobId?: () => string;
}

export interface LoudnessEnvelopeGenerateRequest {
  jobId?: string;
  mediaFileId: string;
  sourceFingerprint: string;
  buffer: AudioBuffer;
  clipAudioStateHash?: string;
  metrics?: readonly LoudnessEnvelopeMetric[];
  windowDuration?: number;
  hopDuration?: number;
  shortTermWindowDuration?: number;
  decoderId?: string;
  decoderVersion?: string;
  metadata?: SignalMetadata;
}

export interface LoudnessEnvelopeGenerationResult {
  jobId: string;
  cacheKey: string;
  analysisRef: AudioAnalysisManifestRef;
  artifact: AudioAnalysisArtifact;
  manifest: LoudnessEnvelopeManifest;
  payloadRefs: AudioArtifactRef[];
  warnings: AudioAnalysisWarning[];
}

const DEFAULT_METRICS = [
  'momentary-lufs',
  'short-term-lufs',
  'rms-dbfs',
  'sample-peak-dbfs',
] as const satisfies readonly LoudnessEnvelopeMetric[];
const DEFAULT_WINDOW_DURATION = 0.4;
const DEFAULT_HOP_DURATION = 0.1;
const DEFAULT_SHORT_TERM_WINDOW_DURATION = 3;
const DEFAULT_DECODER_ID = 'audio-buffer';
const DEFAULT_DECODER_VERSION = '1.0.0';
const textEncoder = new TextEncoder();

export class LoudnessEnvelopeGeneratorError extends Error {
  readonly code: LoudnessEnvelopeGeneratorErrorCode;
  readonly jobId: string;
  readonly recoverable: boolean;

  constructor(
    message: string,
    options: {
      code: LoudnessEnvelopeGeneratorErrorCode;
      jobId: string;
      recoverable?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = options.code === 'cancelled'
      ? 'LoudnessEnvelopeGenerationCancelledError'
      : 'LoudnessEnvelopeGeneratorError';
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
  return `loudness-envelope:${randomId}`;
}

function getAbortReason(signal: AbortSignal): unknown {
  return 'reason' in signal ? signal.reason : undefined;
}

function cancelledError(jobId: string, reason?: unknown): LoudnessEnvelopeGeneratorError {
  const suffix = reason === undefined ? '' : `: ${String(reason)}`;
  return new LoudnessEnvelopeGeneratorError(`Loudness envelope generation ${jobId} was cancelled${suffix}`, {
    code: 'cancelled',
    jobId,
    recoverable: true,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCancellationError(error: unknown): error is LoudnessEnvelopeGeneratorError {
  return error instanceof LoudnessEnvelopeGeneratorError && error.code === 'cancelled';
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

function assertPositiveFinite(value: number, label: string, jobId: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new LoudnessEnvelopeGeneratorError(`${label} must be a positive finite number.`, {
      code: 'invalid-parameters',
      jobId,
      recoverable: false,
    });
  }
}

function validateAudioBuffer(buffer: AudioBuffer, jobId: string): void {
  if (!buffer || typeof buffer !== 'object') {
    throw new LoudnessEnvelopeGeneratorError('Loudness envelope generation requires an AudioBuffer.', {
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
    throw new LoudnessEnvelopeGeneratorError('AudioBuffer metadata is invalid for loudness envelope generation.', {
      code: 'invalid-audio-buffer',
      jobId,
      recoverable: false,
    });
  }
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

function normalizeParameters(
  request: LoudnessEnvelopeGenerateRequest,
  jobId: string,
): NormalizedLoudnessParameters {
  const metrics = [...new Set(request.metrics ?? DEFAULT_METRICS)]
    .toSorted((a, b) => a.localeCompare(b));
  if (metrics.length === 0) {
    throw new LoudnessEnvelopeGeneratorError('Loudness generation requires at least one metric.', {
      code: 'invalid-parameters',
      jobId,
      recoverable: false,
    });
  }

  const windowDuration = request.windowDuration ?? DEFAULT_WINDOW_DURATION;
  const hopDuration = request.hopDuration ?? DEFAULT_HOP_DURATION;
  const shortTermWindowDuration = request.shortTermWindowDuration ?? DEFAULT_SHORT_TERM_WINDOW_DURATION;
  assertPositiveFinite(windowDuration, 'windowDuration', jobId);
  assertPositiveFinite(hopDuration, 'hopDuration', jobId);
  assertPositiveFinite(shortTermWindowDuration, 'shortTermWindowDuration', jobId);

  if (shortTermWindowDuration < windowDuration) {
    throw new LoudnessEnvelopeGeneratorError('shortTermWindowDuration must be at least windowDuration.', {
      code: 'invalid-parameters',
      jobId,
      recoverable: false,
    });
  }

  return {
    metrics,
    windowDuration,
    hopDuration,
    shortTermWindowDuration,
  };
}

export function analyzeAudioBufferLoudnessSummary(buffer: AudioBuffer): LoudnessEnvelopeSummary {
  validateAudioBuffer(buffer, 'loudness-summary');
  const context: LoudnessAnalysisContext = {
    jobId: 'loudness-summary',
    mediaFileId: 'preflight',
    sourceFingerprint: 'preflight',
    cacheKey: 'preflight',
  };
  const weightedPower = createWeightedKPower(buffer, context, throwIfCancelled);
  const weightedPowerPrefix = createPowerPrefix(weightedPower);
  const rawPeak = createRawPeakEnvelope(buffer);

  return {
    integratedLufs: computeIntegratedLufs(weightedPowerPrefix, buffer.length, buffer.sampleRate),
    truePeakDbtp: computePreviewTruePeakDbtp(buffer),
    samplePeakDbfs: computeSamplePeakDbfs(rawPeak),
    rmsDbfs: computeRawRmsDbfs(buffer),
  };
}

async function deterministicHashId(prefix: string, cacheKey: string): Promise<string> {
  const bytes = textEncoder.encode(cacheKey);
  const hash = await sha256ArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return `${prefix}:${hash}`;
}

export function createLoudnessEnvelopeAnalyzerVersion(
  parameters: NormalizedLoudnessParameters,
  baseVersion = LOUDNESS_ENVELOPE_GENERATOR_VERSION,
): string {
  return [
    baseVersion,
    `manifest=v${LOUDNESS_ENVELOPE_MANIFEST_VERSION}`,
    `payload=v${LOUDNESS_CURVE_PAYLOAD_VERSION}`,
    `metrics=${parameters.metrics.join(',')}`,
    `window=${parameters.windowDuration}`,
    `hop=${parameters.hopDuration}`,
    `shortWindow=${parameters.shortTermWindowDuration}`,
    'lufs=bs1770-k-weighted-gated-integrated',
    'truePeak=4x-cubic-preview',
    'channels=mono-mix',
  ].join(';');
}

export class LoudnessEnvelopeGenerator {
  private readonly artifactStore: AudioArtifactStore;
  private readonly baseAnalyzerVersion: string;
  private readonly now: () => string;
  private readonly createJobId: () => string;

  constructor(options: LoudnessEnvelopeGeneratorOptions) {
    this.artifactStore = options.artifactStore;
    this.baseAnalyzerVersion = options.analyzerVersion ?? LOUDNESS_ENVELOPE_GENERATOR_VERSION;
    this.now = options.now ?? defaultNow;
    this.createJobId = options.createJobId ?? defaultJobId;
  }

  async generate(
    request: LoudnessEnvelopeGenerateRequest,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: LoudnessEnvelopeGenerationProgress) => void;
    } = {},
  ): Promise<LoudnessEnvelopeGenerationResult> {
    const jobId = request.jobId ?? this.createJobId();
    const generatedAt = this.now();
    let progressContext: LoudnessAnalysisContext | null = null;

    try {
      validateAudioBuffer(request.buffer, jobId);
      const parameters = normalizeParameters(request, jobId);
      const analyzerVersion = createLoudnessEnvelopeAnalyzerVersion(parameters, this.baseAnalyzerVersion);
      const channelLayout = describeDisplayChannelLayout();
      const cacheKey = createAudioAnalysisCacheKey({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        kind: 'loudness-envelope',
        analyzerVersion,
        channelLayout,
        sampleRate: request.buffer.sampleRate,
        duration: request.buffer.duration,
        clipAudioStateHash: request.clipAudioStateHash,
      });
      const context: LoudnessAnalysisContext = {
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
        message: 'Queued loudness envelope generation',
      });
      throwIfCancelled(options.signal, jobId);

      const analyzed = this.analyzeCurves(request.buffer, parameters, context);
      const stored = await storeLoudnessCurvePayloads({
        artifactStore: this.artifactStore,
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        analyzerVersion,
        generatedAt,
        context,
        curves: analyzed.curves,
        now: this.now,
        throwIfCancelled,
      });
      const manifest = createLoudnessEnvelopeManifest({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        sampleRate: request.buffer.sampleRate,
        channelLayout,
        duration: request.buffer.duration,
        curves: stored.curves,
        summary: analyzed.summary,
      });
      const artifactId = await deterministicHashId('audio:loudness-envelope', cacheKey);

      this.emitProgress(context, {
        phase: 'storing-manifest',
        percent: 98,
        timestamp: this.now(),
        message: 'Storing loudness envelope manifest',
      });
      throwIfCancelled(options.signal, jobId);

      const warnings: AudioAnalysisWarning[] = [{
        code: 'partial',
        message: 'True peak is stored as a 4x cubic-interpolated preview meter value.',
        details: {
          truePeakMode: '4x-cubic-interpolated-preview',
          integratedLufsMode: 'bs1770-k-weighted-relative-gated',
        },
      }];
      const artifactResult = await this.artifactStore.putAnalysisArtifact({
        id: artifactId,
        kind: 'loudness-envelope',
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
        warnings,
        metadata: {
          ...(request.metadata ?? {}),
          analysisKind: 'loudness-envelope',
          cacheKey,
          sourceChannelLayout: describeSourceChannelLayout(request.buffer.numberOfChannels) as unknown as JsonValue,
          loudnessEnvelopeManifest: manifest as unknown as JsonValue,
          integratedLufsMode: 'bs1770-k-weighted-relative-gated',
          truePeakMode: '4x-cubic-interpolated-preview',
        },
      });
      const analysisRef = createAudioAnalysisManifestRefFromArtifact(artifactResult.artifact);

      this.emitProgress(context, {
        phase: 'complete',
        percent: 100,
        timestamp: this.now(),
        message: 'Loudness envelope generation complete',
      });

      return {
        jobId,
        cacheKey,
        analysisRef,
        artifact: artifactResult.artifact,
        manifest,
        payloadRefs: stored.payloadRefs,
        warnings,
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

      throw error instanceof LoudnessEnvelopeGeneratorError
        ? error
        : new LoudnessEnvelopeGeneratorError(
          `Loudness envelope generation ${jobId} failed: ${errorMessage(error)}`,
          {
            code: 'artifact-store-failed',
            jobId,
            cause: error,
          },
        );
    }
  }

  private analyzeCurves(
    buffer: AudioBuffer,
    parameters: NormalizedLoudnessParameters,
    context: LoudnessAnalysisContext,
  ): LoudnessAnalysisResult {
    this.emitProgress(context, {
      phase: 'analyzing',
      percent: 5,
      timestamp: this.now(),
      message: 'Preparing loudness analysis buffers',
    });

    const weightedPower = createWeightedKPower(buffer, context, throwIfCancelled);
    const weightedPowerPrefix = createPowerPrefix(weightedPower);
    const rawMix = createRawMonoMix(buffer);
    const rawSquarePrefix = createRawSquarePrefix(rawMix);
    const rawPeak = createRawPeakEnvelope(buffer);
    const curves: LoudnessCurveData[] = [];
    const metricCount = parameters.metrics.length;

    for (let metricIndex = 0; metricIndex < metricCount; metricIndex += 1) {
      const metric = parameters.metrics[metricIndex];
      this.emitProgress(context, {
        phase: 'analyzing',
        percent: 45 + (metricIndex / Math.max(1, metricCount)) * 35,
        timestamp: this.now(),
        metric,
        message: 'Computing loudness curve',
      });
      throwIfCancelled(context.signal, context.jobId);

      if (metric === 'momentary-lufs') {
        curves.push({
          metric,
          channelIndex: 0,
          windowDuration: parameters.windowDuration,
          hopDuration: parameters.hopDuration,
          values: createPowerLoudnessCurve({
            weightedPowerPrefix,
            bufferLength: buffer.length,
            sampleRate: buffer.sampleRate,
            windowDuration: parameters.windowDuration,
            hopDuration: parameters.hopDuration,
          }),
        });
      } else if (metric === 'short-term-lufs') {
        curves.push({
          metric,
          channelIndex: 0,
          windowDuration: parameters.shortTermWindowDuration,
          hopDuration: parameters.hopDuration,
          values: createPowerLoudnessCurve({
            weightedPowerPrefix,
            bufferLength: buffer.length,
            sampleRate: buffer.sampleRate,
            windowDuration: parameters.shortTermWindowDuration,
            hopDuration: parameters.hopDuration,
          }),
        });
      } else if (metric === 'rms-dbfs') {
        curves.push({
          metric,
          channelIndex: 0,
          windowDuration: parameters.windowDuration,
          hopDuration: parameters.hopDuration,
          values: createRmsCurve({
            rawSquarePrefix,
            bufferLength: buffer.length,
            sampleRate: buffer.sampleRate,
            windowDuration: parameters.windowDuration,
            hopDuration: parameters.hopDuration,
          }),
        });
      } else if (metric === 'sample-peak-dbfs') {
        curves.push({
          metric,
          channelIndex: 0,
          windowDuration: parameters.windowDuration,
          hopDuration: parameters.hopDuration,
          values: createSamplePeakCurve({
            rawPeak,
            bufferLength: buffer.length,
            sampleRate: buffer.sampleRate,
            windowDuration: parameters.windowDuration,
            hopDuration: parameters.hopDuration,
          }),
        });
      } else if (metric === 'true-peak-dbtp') {
        curves.push({
          metric,
          channelIndex: 0,
          windowDuration: buffer.duration || parameters.windowDuration,
          hopDuration: buffer.duration || parameters.hopDuration,
          values: Float32Array.from([computePreviewTruePeakDbtp(buffer)]),
        });
      } else if (metric === 'integrated-lufs') {
        curves.push({
          metric,
          channelIndex: 0,
          windowDuration: buffer.duration || parameters.windowDuration,
          hopDuration: buffer.duration || parameters.hopDuration,
          values: Float32Array.from([computeIntegratedLufs(weightedPowerPrefix, buffer.length, buffer.sampleRate)]),
        });
      }
    }

    const summary: LoudnessEnvelopeSummary = {
      integratedLufs: computeIntegratedLufs(weightedPowerPrefix, buffer.length, buffer.sampleRate),
      truePeakDbtp: computePreviewTruePeakDbtp(buffer),
      samplePeakDbfs: computeSamplePeakDbfs(rawPeak),
      rmsDbfs: computeRawRmsDbfs(buffer),
    };

    return { curves, summary };
  }

  private emitProgress(
    context: LoudnessAnalysisContext,
    update: Omit<
      LoudnessEnvelopeGenerationProgress,
      'jobId' | 'mediaFileId' | 'sourceFingerprint' | 'cacheKey'
    >,
    checkCancellation = true,
  ): void {
    const progress: LoudnessEnvelopeGenerationProgress = {
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
