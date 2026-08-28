import type {
  AnomalyType,
  PlaybackHealthSnapshot,
  PlaybackHealthSnapshotVideoState,
  PlaybackHealthVideoSnapshot,
} from './contracts';

export function buildPlaybackHealthSnapshot(params: {
  isPlaying: boolean;
  startTime: number;
  now: number;
  anomalyCounts: Record<AnomalyType, number>;
  videoStates: PlaybackHealthSnapshotVideoState[];
}): PlaybackHealthSnapshot {
  const totalAnomalies = Object.values(params.anomalyCounts).reduce((a, b) => a + b, 0);
  const status = classifyPlaybackHealthStatus(totalAnomalies, params.isPlaying);

  return {
    status,
    uptime: Math.round((params.now - params.startTime) / 1000),
    anomalyCounts: { ...params.anomalyCounts },
    videoStates: params.videoStates,
  };
}

export function classifyPlaybackHealthStatus(
  totalAnomalies: number,
  isPlaying: boolean
): string {
  return totalAnomalies === 0 ? 'healthy' : isPlaying ? 'degraded' : 'idle-with-issues';
}

export function buildSnapshotVideoState(
  clipId: string,
  video: HTMLVideoElement
): PlaybackHealthSnapshotVideoState {
  return {
    clipId,
    currentTime: video.currentTime,
    readyState: video.readyState,
    seeking: video.seeking,
    paused: video.paused,
  };
}

export function buildVideoSnapshot(params: {
  clipId: string;
  video: HTMLVideoElement;
  warmingUp: boolean;
  gpuReady: boolean;
}): PlaybackHealthVideoSnapshot {
  const { clipId, video, warmingUp, gpuReady } = params;
  return {
    clipId,
    src: video.src?.split('/').pop() || video.currentSrc?.split('/').pop() || '(blob)',
    currentTime: video.currentTime,
    readyState: video.readyState,
    seeking: video.seeking,
    paused: video.paused,
    played: video.played.length,
    warmingUp,
    gpuReady,
  };
}
