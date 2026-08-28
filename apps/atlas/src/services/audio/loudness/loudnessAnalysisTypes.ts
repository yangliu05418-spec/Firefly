import type {
  LoudnessEnvelopeMetric,
  LoudnessEnvelopeSummary,
} from '../loudnessEnvelopeManifest';

export type LoudnessAnalysisPhase =
  | 'queued'
  | 'analyzing'
  | 'storing-payloads'
  | 'storing-manifest'
  | 'complete'
  | 'cancelled'
  | 'failed';

export interface NormalizedLoudnessParameters {
  metrics: LoudnessEnvelopeMetric[];
  windowDuration: number;
  hopDuration: number;
  shortTermWindowDuration: number;
}

export interface LoudnessCurveData {
  metric: LoudnessEnvelopeMetric;
  channelIndex?: number;
  windowDuration: number;
  hopDuration: number;
  values: Float32Array;
}

export interface LoudnessAnalysisProgress {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  phase: LoudnessAnalysisPhase;
  percent: number;
  timestamp: string;
  cacheKey: string;
  metric?: LoudnessEnvelopeMetric;
  pointCount?: number;
  message?: string;
}

export interface LoudnessAnalysisContext {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  cacheKey: string;
  signal?: AbortSignal;
  onProgress?: (progress: LoudnessAnalysisProgress) => void;
}

export interface LoudnessAnalysisResult {
  curves: LoudnessCurveData[];
  summary: LoudnessEnvelopeSummary;
}
