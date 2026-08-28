import type { AudioEvent } from '../beatOnsetManifest';
import type { BeatOnsetAnalysisProgress } from '../BeatOnsetAnalysisGenerator';

export interface NormalizedBeatOnsetParameters {
  fftSize: 1024 | 2048 | 4096;
  hopSize: number;
  frameCount: number;
}

export interface FluxAnalysis {
  flux: Float32Array;
  onsets: AudioEvent[];
}

export interface BeatEstimate {
  tempoBpm?: number;
  confidence: number;
  beats: AudioEvent[];
}

export interface BeatOnsetAnalysisContext {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  onsetCacheKey: string;
  beatCacheKey: string;
  signal?: AbortSignal;
  onProgress?: (progress: BeatOnsetAnalysisProgress) => void;
}
