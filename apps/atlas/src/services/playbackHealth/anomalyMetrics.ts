import {
  COOLDOWN_MS,
  MAX_ANOMALY_LOG,
} from './constants';
import type { AnomalyEvent, AnomalyType } from './contracts';

export interface AnomalyMetricsState {
  anomalyLog: AnomalyEvent[];
  anomalyCounts: Record<AnomalyType, number>;
  lastAnomalyTime: Partial<Record<AnomalyType, number>>;
}

export function createInitialAnomalyCounts(): Record<AnomalyType, number> {
  return {
    FRAME_STALL: 0,
    WARMUP_STUCK: 0,
    RVFC_ORPHANED: 0,
    SEEK_STUCK: 0,
    READYSTATE_DROP: 0,
    GPU_SURFACE_COLD: 0,
    RENDER_STALL: 0,
    HIGH_DROP_RATE: 0,
    PREVIEW_FREEZE: 0,
  };
}

export function recordAnomalyMetric(
  state: AnomalyMetricsState,
  type: AnomalyType,
  timestamp: number,
  clipId?: string,
  detail?: string
): AnomalyEvent | null {
  const lastTime = state.lastAnomalyTime[type];
  if (lastTime !== undefined && timestamp - lastTime < COOLDOWN_MS) {
    return null;
  }

  state.lastAnomalyTime[type] = timestamp;
  state.anomalyCounts[type]++;

  const event: AnomalyEvent = {
    type,
    timestamp,
    clipId,
    detail,
    recovered: type !== 'HIGH_DROP_RATE' && type !== 'READYSTATE_DROP',
  };

  state.anomalyLog.push(event);
  if (state.anomalyLog.length > MAX_ANOMALY_LOG) {
    state.anomalyLog.shift();
  }

  return event;
}

export function resetAnomalyCounts(counts: Record<AnomalyType, number>): void {
  for (const key of Object.keys(counts) as AnomalyType[]) {
    counts[key] = 0;
  }
}
