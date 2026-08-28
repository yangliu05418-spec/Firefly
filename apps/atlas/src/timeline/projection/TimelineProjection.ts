export type TimelineProjectionVersion = 1;

export type TimelineProjectionSourceKind =
  | 'video'
  | 'audio'
  | 'image'
  | 'text'
  | 'solid'
  | 'camera'
  | 'composition'
  | 'model'
  | 'gaussian-splat'
  | 'vector-animation'
  | 'midi'
  | 'data'
  | 'unknown';

export type TimelineProjectionTrackKind =
  | 'video'
  | 'audio'
  | 'mixed'
  | 'data'
  | 'control';

export type TimelineProjectionStatus =
  | 'none'
  | 'queued'
  | 'generating'
  | 'ready'
  | 'error'
  | 'missing';

export interface TimelineProgressState {
  status: TimelineProjectionStatus;
  progress?: number;
  errorCode?: string;
}

export interface TimelineProjectionPalette {
  fill: string;
  stroke?: string;
  text?: string;
  accent?: string;
  mutedFill?: string;
}

export interface TimelineProjectionTrack {
  id: string;
  index: number;
  name: string;
  kind: TimelineProjectionTrackKind;
  color: string;
  locked: boolean;
  muted: boolean;
  hidden: boolean;
  expanded: boolean;
  dimmed: boolean;
  baseHeightPx: number;
  heightPx: number;
}

export interface TimelinePassiveBadgeState {
  proxy?: TimelineProgressState;
  audioProxy?: TimelineProgressState;
  download?: TimelineProgressState;
  stem?: TimelineProgressState & {
    activeStemId?: string;
    stemCount?: number;
  };
  reloadRequired?: boolean;
  reversed?: boolean;
  linked?: {
    linkedClipId?: string;
    linkedGroupId?: string;
  };
  transcript?: TimelineProgressState & {
    markerCount?: number;
  };
  analysis?: TimelineProgressState & {
    markerCount?: number;
  };
  nestedComposition?: {
    compositionId: string;
    hasMixdown: boolean;
    boundaryCount?: number;
  };
}

export interface TimelineThumbnailCacheRef {
  sourceId: string;
  mediaFileId?: string;
  fileHash?: string;
  frameCount?: number;
  durationSeconds?: number;
}

export interface TimelineWaveformCacheRef {
  sourceRefId: string;
  processedRefId?: string;
  channelCount?: number;
  referencePeak?: number;
}

export interface TimelineSpectrogramCacheRef {
  sourceRefId: string;
  processedRefId?: string;
  tileSetId?: string;
  tileCount?: number;
}

export interface TimelineAudioAnalysisCacheRef {
  refId: string;
  sourceRefId?: string;
  processedRefId?: string;
}

export interface TimelineClipCacheRefs {
  thumbnails?: TimelineThumbnailCacheRef;
  waveform?: TimelineWaveformCacheRef;
  spectrogram?: TimelineSpectrogramCacheRef;
  loudness?: TimelineAudioAnalysisCacheRef;
  beatOnset?: TimelineAudioAnalysisCacheRef;
  frequencyPhase?: TimelineAudioAnalysisCacheRef;
  analysisMarkers?: TimelineAudioAnalysisCacheRef;
}

export interface TimelineMarkerSummary {
  id: string;
  time: number;
  duration?: number;
  kind: 'transcript' | 'analysis' | 'beat' | 'onset' | 'custom';
  label?: string;
  confidence?: number;
}

export interface TimelineFadeSummary {
  fadeInDuration: number;
  fadeOutDuration: number;
  opacityKeyframeCount?: number;
}

export interface TimelineProjectionClipState {
  selected: boolean;
  hovered: boolean;
  locked: boolean;
  muted: boolean;
  linked: boolean;
  inLinkedGroup: boolean;
  dimmed: boolean;
  disabled: boolean;
}

export interface TimelineProjectionClip {
  id: string;
  trackId: string;
  index: number;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  speed: number;
  reversed: boolean;
  sourceKind: TimelineProjectionSourceKind;
  sourceId?: string;
  mediaFileId?: string;
  label: string;
  palette: TimelineProjectionPalette;
  state: TimelineProjectionClipState;
  badges: TimelinePassiveBadgeState;
  cacheRefs: TimelineClipCacheRefs;
  markers: TimelineMarkerSummary[];
  fade?: TimelineFadeSummary;
  keyframeCount?: number;
}

export interface TimelineProjectionTiming {
  clips: TimelineProjectionClip[];
  primarySelectedClipId?: string | null;
  hoveredClipId?: string | null;
}

export interface TimelineProjectionLayout {
  tracks: TimelineProjectionTrack[];
  selectedClipIds: string[];
}

export interface TimelineProjection extends TimelineProjectionLayout, TimelineProjectionTiming {
  schemaVersion: TimelineProjectionVersion;
  generatedAtMs?: number;
}

export interface TimelineRuntimeReferenceIssue {
  path: string;
  code:
    | 'function'
    | 'symbol'
    | 'object-url'
    | 'non-plain-object'
    | 'cycle';
  valueTag: string;
}

export type TimelineRenderModelVersion = TimelineProjectionVersion;
export type TimelineSourceKind = TimelineProjectionSourceKind;
export type TimelineRenderTrackKind = TimelineProjectionTrackKind;
export type TimelineRenderStatus = TimelineProjectionStatus;
export type TimelineRenderPalette = TimelineProjectionPalette;
export type TimelineRenderTrack = TimelineProjectionTrack;
export type TimelineRenderClipState = TimelineProjectionClipState;
export type TimelineRenderClip = TimelineProjectionClip;
export type TimelineRenderModel = TimelineProjection;
