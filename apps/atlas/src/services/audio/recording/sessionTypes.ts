import type {
  AudioRecordingCapture,
  AudioRecordingService,
  AudioRecordingStopResult,
} from '../AudioRecordingService';

export type AudioRecordingStateSnapshot = ReturnType<AudioRecordingService['getSnapshot']>;
export type AudioRecordingTargetLike = {
  trackId: string;
  inputDeviceId?: string;
};

export interface ActiveCaptureGroup {
  inputDeviceId?: string;
  trackIds: string[];
  capture: AudioRecordingCapture;
}

export interface CaptureInputGroup {
  inputDeviceId?: string;
  targets: AudioRecordingTargetLike[];
}

export interface ActiveRecordingSession {
  sessionId: string;
  startedAt: number;
  startTime: number;
  punchInTime?: number;
  punchOutTime?: number;
  mimeTypes: string[];
  captureGroups: CaptureInputGroup[];
  getTimelineTime?: () => number;
  onPunchOut?: (result: AudioRecordingStopResult) => Promise<void> | void;
  punchInTimer?: ReturnType<typeof globalThis.setTimeout>;
  punchOutTimer?: ReturnType<typeof globalThis.setTimeout>;
  captureStarting?: boolean;
  punchOutStopping?: boolean;
  storageWarnings?: AudioRecordingStateSnapshot['storageWarnings'];
  targets: AudioRecordingTargetLike[];
  captures: ActiveCaptureGroup[];
}

export function createRecordingSessionId(now: number): string {
  return `audio-rec-${Math.round(now)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function groupTargetsByInput<T extends AudioRecordingTargetLike>(targets: T[]): CaptureInputGroup[] {
  const groups = new Map<string, AudioRecordingTargetLike[]>();

  for (const target of targets) {
    const key = target.inputDeviceId?.trim() || '__default__';
    groups.set(key, [...(groups.get(key) ?? []), target]);
  }

  return Array.from(groups.entries()).map(([key, groupedTargets]) => ({
    inputDeviceId: key === '__default__' ? undefined : key,
    targets: groupedTargets,
  }));
}

export function getRecordingTargetTrackIds(targets: readonly AudioRecordingTargetLike[]): string[] {
  return targets.map(target => target.trackId);
}

export function getRecordingInputDeviceIds(targets: readonly AudioRecordingTargetLike[]): string[] {
  return Array.from(new Set(targets.map(target => target.inputDeviceId ?? 'default')));
}
