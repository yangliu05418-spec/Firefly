import type { AudioStemKind, ClipAudioStemState, TimelineClip } from '../../../types';
import type { StemSeparationBackend } from '../../../services/audio/stemSeparation';

export type ClipStemSeparationJobPhase =
  | 'queued'
  | 'preparing'
  | 'downloading-model'
  | 'loading-model'
  | 'separating'
  | 'storing'
  | 'complete'
  | 'cancelled'
  | 'failed';

export interface ClipStemSeparationJobState {
  jobId: string;
  clipId: string;
  requestedClipId: string;
  sourceMediaFileId?: string;
  modelId: string;
  phase: ClipStemSeparationJobPhase;
  progress: number;
  stems?: ClipStemSeparationJobStemChoice[];
  backend?: StemSeparationBackend;
  message?: string;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

export interface ClipStemSeparationJobStemChoice {
  id: string;
  kind: AudioStemKind;
  label: string;
  mediaFileId: string;
}

export interface StartClipStemSeparationOptions {
  modelId?: string;
  force?: boolean;
  range?: { start: number; end: number };
}

export interface ClipStemSeparationProgressUpdate {
  phase?: ClipStemSeparationJobPhase;
  progress?: number;
  sourceMediaFileId?: string;
  stems?: ClipStemSeparationJobStemChoice[];
  backend?: StemSeparationBackend;
  message?: string;
  error?: string;
}

export interface ClipStemSeparationRunnerRequest {
  jobId: string;
  clip: TimelineClip;
  requestedClip: TimelineClip;
  options: StartClipStemSeparationOptions;
  signal: AbortSignal;
  updateProgress: (update: ClipStemSeparationProgressUpdate) => void;
}

export type ClipStemSeparationRunner = (
  request: ClipStemSeparationRunnerRequest,
) => Promise<ClipAudioStemState | null>;
