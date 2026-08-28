import type {
  AudioEffectInstance,
  AudioExportPreflightState,
  AudioSendState,
  MasterAudioState,
  RuntimeAudioMeterState,
  TimelineTrack,
  TrackAudioState,
} from '../../../types';
import {
  getAudioEffect,
  getAudioEffectDefaultParams,
} from '../../../engine/audio/AudioEffectRegistry';
import { runtimeAudioMeterBus } from '../../../services/audio/runtimeAudioMeterBus';
import { mergeAudioEffectParamPatch } from '../../../utils/audioEffectParamPath';
import { generateClipId, generateEffectId } from '../helpers/idGenerator';

const AUDIO_EXPORT_PREFLIGHT_HISTORY_LIMIT = 8;
const RUNTIME_AUDIO_METER_STORE_MIRROR_INTERVAL_MS = 250;

let runtimeAudioMeterMirrorTimer: ReturnType<typeof setTimeout> | null = null;
let runtimeAudioMeterMirrorFrame: number | null = null;
let runtimeAudioMeterMirrorLastFlush = 0;

export function clampVolumeDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-60, Math.min(18, value));
}

export function clampPan(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

export function clampSendGainDb(value: number): number {
  if (!Number.isFinite(value)) return -12;
  return Math.max(-60, Math.min(18, value));
}

function clampTruePeakCeilingDb(value: number): number {
  if (!Number.isFinite(value)) return -1;
  return Math.max(-24, Math.min(0, value));
}

function clampTargetLufs(value: number): number {
  if (!Number.isFinite(value)) return -14;
  return Math.max(-36, Math.min(-5, value));
}

function normalizeAudioSends(sends: TrackAudioState['sends'] | undefined): AudioSendState[] | undefined {
  if (!sends || sends.length === 0) return undefined;

  return sends.map((send, index) => ({
    id: typeof send.id === 'string' && send.id.length > 0 ? send.id : generateClipId('send'),
    targetBusId: typeof send.targetBusId === 'string' && send.targetBusId.length > 0
      ? send.targetBusId
      : `bus-${index + 1}`,
    gainDb: clampSendGainDb(send.gainDb),
    preFader: send.preFader === true,
    enabled: send.enabled !== false,
  }));
}

function normalizeMeterMode(meterMode: unknown): TrackAudioState['meterMode'] {
  return meterMode === 'rms' || meterMode === 'lufs' ? meterMode : 'peak';
}

export function ensureTrackAudioState(track: TimelineTrack, patch: Partial<TrackAudioState> = {}): TrackAudioState {
  const next = {
    volumeDb: 0,
    pan: 0,
    muted: track.muted === true,
    solo: track.solo === true,
    recordArm: false,
    inputMonitor: false,
    meterMode: 'peak',
    ...(track.audioState ?? {}),
    ...patch,
  };

  return {
    ...next,
    volumeDb: clampVolumeDb(next.volumeDb),
    pan: clampPan(next.pan),
    sends: normalizeAudioSends(next.sends),
    meterMode: normalizeMeterMode(next.meterMode),
  };
}

export function ensureMasterAudioState(
  current: MasterAudioState | undefined,
  patch: Partial<MasterAudioState> = {},
): MasterAudioState {
  const next = {
    volumeDb: 0,
    limiterEnabled: false,
    truePeakCeilingDb: -1,
    ...(current ?? {}),
    ...patch,
  };

  return {
    ...next,
    volumeDb: clampVolumeDb(next.volumeDb),
    truePeakCeilingDb: clampTruePeakCeilingDb(next.truePeakCeilingDb),
    ...(next.targetLufs !== undefined ? { targetLufs: clampTargetLufs(next.targetLufs) } : { targetLufs: undefined }),
  };
}

export function createAudioEffectInstance(
  descriptorId: string,
  automationMode: AudioEffectInstance['automationMode'],
): AudioEffectInstance | null {
  const descriptor = getAudioEffect(descriptorId);
  if (!descriptor) return null;

  return {
    id: generateEffectId(),
    descriptorId: descriptor.id,
    enabled: true,
    params: getAudioEffectDefaultParams(descriptor.id),
    automationMode: descriptor.automation === 'none' ? 'none' : automationMode,
  };
}

export function updateEffectStackParams(
  effectStack: readonly AudioEffectInstance[] | undefined,
  effectId: string,
  params: Partial<AudioEffectInstance['params']>,
): AudioEffectInstance[] {
  return (effectStack ?? []).map(effect => effect.id === effectId
    ? { ...effect, params: mergeAudioEffectParamPatch(effect.params, params, effect.descriptorId) }
    : effect);
}

export function setEffectStackEnabled(
  effectStack: readonly AudioEffectInstance[] | undefined,
  effectId: string,
  enabled: boolean,
): AudioEffectInstance[] {
  return (effectStack ?? []).map(effect => effect.id === effectId ? { ...effect, enabled } : effect);
}

export function reorderEffectStack(
  effectStack: readonly AudioEffectInstance[] | undefined,
  effectId: string,
  newIndex: number,
): AudioEffectInstance[] {
  const nextStack = [...(effectStack ?? [])];
  const oldIndex = nextStack.findIndex(effect => effect.id === effectId);
  if (oldIndex < 0 || oldIndex === newIndex) return nextStack;

  const [moved] = nextStack.splice(oldIndex, 1);
  const clampedIndex = Math.max(0, Math.min(nextStack.length, newIndex));
  nextStack.splice(clampedIndex, 0, moved);
  return nextStack;
}

function runtimeNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function shouldFlushRuntimeAudioMeterMirrorImmediately(): boolean {
  return import.meta.env?.MODE === 'test';
}

export function flushRuntimeAudioMeterMirror(
  getRuntimeMeters: () => RuntimeAudioMeterState,
  setRuntimeMeters: (next: RuntimeAudioMeterState) => void,
): void {
  runtimeAudioMeterMirrorLastFlush = runtimeNow();
  const next = runtimeAudioMeterBus.getState();
  if (getRuntimeMeters() !== next) {
    setRuntimeMeters(next);
  }
}

export function cancelRuntimeAudioMeterMirrorFlush(): void {
  if (runtimeAudioMeterMirrorTimer !== null) {
    clearTimeout(runtimeAudioMeterMirrorTimer);
    runtimeAudioMeterMirrorTimer = null;
  }
  if (
    runtimeAudioMeterMirrorFrame !== null &&
    typeof window !== 'undefined' &&
    typeof window.cancelAnimationFrame === 'function'
  ) {
    window.cancelAnimationFrame(runtimeAudioMeterMirrorFrame);
    runtimeAudioMeterMirrorFrame = null;
  }
}

export function scheduleRuntimeAudioMeterMirrorFlush(
  getRuntimeMeters: () => RuntimeAudioMeterState,
  setRuntimeMeters: (next: RuntimeAudioMeterState) => void,
): void {
  if (shouldFlushRuntimeAudioMeterMirrorImmediately()) {
    flushRuntimeAudioMeterMirror(getRuntimeMeters, setRuntimeMeters);
    return;
  }
  if (runtimeAudioMeterMirrorTimer !== null || runtimeAudioMeterMirrorFrame !== null) return;

  const elapsed = runtimeNow() - runtimeAudioMeterMirrorLastFlush;
  const delayMs = Math.max(0, RUNTIME_AUDIO_METER_STORE_MIRROR_INTERVAL_MS - elapsed);
  runtimeAudioMeterMirrorTimer = setTimeout(() => {
    runtimeAudioMeterMirrorTimer = null;
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      runtimeAudioMeterMirrorFrame = window.requestAnimationFrame(() => {
        runtimeAudioMeterMirrorFrame = null;
        flushRuntimeAudioMeterMirror(getRuntimeMeters, setRuntimeMeters);
      });
      return;
    }
    flushRuntimeAudioMeterMirror(getRuntimeMeters, setRuntimeMeters);
  }, delayMs);
}

export function withAudioExportPreflightMeasurementHistory(
  current: AudioExportPreflightState | undefined,
  next: AudioExportPreflightState,
  rangeStart: number,
  rangeEnd: number,
): AudioExportPreflightState {
  const existing = current?.measurementHistory ?? [];
  if (!next.measurement) {
    return existing.length > 0
      ? {
          ...next,
          measurementHistory: existing.slice(0, AUDIO_EXPORT_PREFLIGHT_HISTORY_LIMIT),
        }
      : next;
  }

  return {
    ...next,
    measurementHistory: [
      {
        checkedAt: next.lastCheckedAt ?? Date.now(),
        startTime: Math.max(0, Math.min(rangeStart, rangeEnd)),
        endTime: Math.max(0, Math.max(rangeStart, rangeEnd)),
        measurement: next.measurement,
      },
      ...existing,
    ].slice(0, AUDIO_EXPORT_PREFLIGHT_HISTORY_LIMIT),
  };
}
