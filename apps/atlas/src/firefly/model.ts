export type MediaKind = 'video' | 'audio' | 'image';
export type AssetStatus = 'local' | 'uploading' | 'ready' | 'failed';
export type TrackKind = 'video' | 'audio';
export type TransitionKind = 'none' | 'crossfade' | 'wipe-left' | 'wipe-right' | 'wipe-up' | 'wipe-down' | 'dip-black';

export interface AtlasUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface AtlasBootstrap {
  user: AtlasUser;
  capabilities: {
    agent: boolean;
    maxUploadBytes: number;
    partSize: number;
    uploadConcurrency: number;
  };
}

export interface AtlasProjectSummary {
  id: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  hasCheckpoint: boolean;
  leaseDeviceId?: string;
  leaseExpiresAt?: number;
  localOnly?: boolean;
}

export interface AtlasAsset {
  id: string;
  name: string;
  kind: MediaKind;
  mimeType: string;
  size: number;
  duration: number;
  width?: number;
  height?: number;
  status: AssetStatus;
  source: 'local' | 'firefly';
  sourceId?: string;
  mediaUrl?: string;
  objectUrl?: string;
  posterUrl?: string;
  error?: string;
}

export interface AtlasTrack {
  id: string;
  name: string;
  kind: TrackKind;
  muted: boolean;
  locked: boolean;
}

export interface AtlasClip {
  id: string;
  assetId: string;
  trackId: string;
  name: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  volume: number;
  muted: boolean;
  transitionIn: TransitionKind;
  transitionId?: string;
  transitionFromClipId?: string;
  transitionDuration?: number;
  transform: {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    opacity: number;
  };
}

export interface AtlasDocument {
  version: 1;
  projectId: string;
  title: string;
  revision: number;
  updatedAt: string;
  playhead: number;
  assets: AtlasAsset[];
  tracks: AtlasTrack[];
  clips: AtlasClip[];
}

export interface FireflyLibraryAsset {
  id: string;
  name: string;
  kind: MediaKind;
  previewUrl?: string;
  posterUrl?: string;
  size?: number;
  duration?: number;
  sourceType: 'user_asset' | 'generation' | 'generated' | 'canvas_project';
}

export interface AtlasAgentOperation {
  sequence: number;
  tool: string;
  args: Record<string, unknown>;
  risk: 'low' | 'medium' | 'destructive' | 'external';
  requiresConfirmation: boolean;
  operationKey: string;
  operationDigest: string;
}

export interface AtlasAgentPlan {
  version: 1;
  summary: string;
  catalogVersion: string;
  catalogDigest: string;
  baseRevision: number;
  operations: AtlasAgentOperation[];
  planDigest: string;
}

export interface AtlasAgentRun {
  id: string;
  projectId: string;
  status: 'queued' | 'planning' | 'awaiting_confirmation' | 'ready' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  instruction: string;
  baseRevision: number;
  catalogVersion: string;
  catalogDigest: string;
  plan?: AtlasAgentPlan;
  errorCode?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface AtlasAgentOperationResult {
  sequence: number;
  planDigest: string;
  status: 'succeeded' | 'failed';
  result: unknown;
  beforeRevision: number;
  afterRevision: number;
  historyNodeId?: string;
}

export interface AtlasAgentLedger {
  id: string;
  projectId: string;
  runId: string;
  planDigest: string;
  idempotencyKey: string;
  semanticFingerprint: string;
  status: 'applied' | 'awaiting_export' | 'reported';
  pendingReceipts: AtlasAgentOperationResult[];
  pendingExport?: {
    sequence: number;
    revision: number;
  };
  updatedAt: string;
}

export const createId = (prefix: string): string => {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
};

export function createEmptyDocument(projectId: string, title: string, revision = 0): AtlasDocument {
  return {
    version: 1,
    projectId,
    title,
    revision,
    updatedAt: new Date().toISOString(),
    playhead: 0,
    assets: [],
    tracks: [
      { id: createId('track-video'), name: '画面 1', kind: 'video', muted: false, locked: false },
      { id: createId('track-audio'), name: '声音 1', kind: 'audio', muted: false, locked: false },
    ],
    clips: [],
  };
}

export function stripRuntimeUrls(document: AtlasDocument): AtlasDocument {
  return {
    ...document,
    assets: document.assets.map(({ objectUrl: _objectUrl, ...asset }) => asset),
  };
}

export function documentDuration(document: AtlasDocument): number {
  return document.clips.reduce((maximum, clip) => Math.max(maximum, clip.startTime + clip.duration), 0);
}
