export type TimelineSchemaVersion = 1;

export type TimelineSchemaSourceKind =
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

export type TimelineSchemaTrackKind =
  | 'video'
  | 'audio'
  | 'mixed'
  | 'data'
  | 'control';

export interface TimelineSchemaSourceRef {
  kind: TimelineSchemaSourceKind;
  sourceId?: string;
  mediaAssetId?: string;
  compositionId?: string;
}

export interface TimelineSchemaTiming {
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  speed: number;
  reversed: boolean;
}

export interface TimelineSchemaTrack {
  id: string;
  index: number;
  kind: TimelineSchemaTrackKind;
  name: string;
  locked: boolean;
  muted: boolean;
  hidden: boolean;
  expanded: boolean;
}

export interface TimelineSchemaClip {
  id: string;
  trackId: string;
  index: number;
  label: string;
  source: TimelineSchemaSourceRef;
  timing: TimelineSchemaTiming;
  locked: boolean;
  muted: boolean;
  disabled: boolean;
  linkedClipId?: string;
  linkedGroupId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface TimelineSchemaSnapshot {
  schemaVersion: TimelineSchemaVersion;
  tracks: readonly TimelineSchemaTrack[];
  clips: readonly TimelineSchemaClip[];
  selectedClipIds: readonly string[];
  primarySelectedClipId?: string | null;
}
