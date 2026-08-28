export type AnomalyType =
  | 'FRAME_STALL'
  | 'WARMUP_STUCK'
  | 'RVFC_ORPHANED'
  | 'SEEK_STUCK'
  | 'READYSTATE_DROP'
  | 'GPU_SURFACE_COLD'
  | 'RENDER_STALL'
  | 'HIGH_DROP_RATE'
  | 'PREVIEW_FREEZE';

export interface AnomalyEvent {
  type: AnomalyType;
  timestamp: number;
  clipId?: string;
  detail?: string;
  recovered: boolean;
}

export interface VideoTimeTracker {
  lastTime: number;
  staleCount: number;
}

export type PlaybackPurgeMode = 'targeted' | 'full';

export interface PlaybackPurgeOptions {
  reason?: string;
  mode?: PlaybackPurgeMode;
  resumePlayback?: boolean;
}

export interface PlaybackPurgeResult {
  reason: string;
  mode: PlaybackPurgeMode;
  playheadPosition: number;
  wasPlaying: boolean;
  resumeScheduled: boolean;
  clips: Array<{
    clipId: string;
    targetTime: number;
    hadVideoElement: boolean;
    webCodecsProvidersReset: number;
  }>;
}

export interface PlaybackHealthVideoSnapshot {
  clipId: string;
  src: string;
  currentTime: number;
  readyState: number;
  seeking: boolean;
  paused: boolean;
  played: number;
  warmingUp: boolean;
  gpuReady: boolean;
}

export interface PlaybackHealthSnapshotVideoState {
  clipId: string;
  currentTime: number;
  readyState: number;
  seeking: boolean;
  paused: boolean;
}

export interface PlaybackHealthSnapshot {
  status: string;
  uptime: number;
  anomalyCounts: Record<AnomalyType, number>;
  videoStates: PlaybackHealthSnapshotVideoState[];
}
