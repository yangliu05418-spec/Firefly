import type { Composition, MediaFile } from '../../../../stores/mediaStore';

export type FixtureRole = 'primary-motion' | 'blend-mask' | 'detail-nested';

export interface ImportedMediaResult {
  id: string;
  name: string;
  type: string;
  duration?: number;
  path: string;
}

export interface ImportLocalFilesData {
  imported?: ImportedMediaResult[];
  errors?: Array<{ path: string; error: string }>;
}

export interface FixtureClipSummary {
  id: string;
  name: string;
  startTime: number;
  duration: number;
  trackId: string;
  sourceType: string | undefined;
  isComposition: boolean;
  effectCount: number;
  maskCount: number;
  keyframeCount: number;
  hasTransitionIn: boolean;
  hasTransitionOut: boolean;
}

export interface FixtureCompositionSummary {
  id: string;
  name: string;
  duration: number;
  trackCount: number;
  clipCount: number;
  effectCount: number;
  maskCount: number;
  keyframeCount: number;
  compositionClipCount: number;
}

export interface FixtureBuildContext {
  primary: MediaFile;
  blend: MediaFile;
  detail: MediaFile;
  durationSeconds: number;
  width: number;
  height: number;
  frameRate: number;
}

export interface PreparedFixtureMedia {
  roles: Record<FixtureRole, MediaFile>;
  imported: ImportedMediaResult[];
  errors?: Array<{ path: string; error: string }>;
}

export type FixtureComposition = Composition;
