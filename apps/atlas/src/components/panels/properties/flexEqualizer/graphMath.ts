import {
  createDefaultAudioEqBandDynamics,
  createDefaultAudioEqBandSpectralDynamics,
} from '../../../../engine/audio/eq/AudioEqDefaults';
import type {
  AudioEqBand,
  AudioEqBandDynamics,
  AudioEqBandSpectralDynamics,
} from '../../../../engine/audio/eq/AudioEqTypes';

export const GRAPH_MIN_FREQUENCY_HZ = 20;
export const GRAPH_MAX_FREQUENCY_HZ = 20000;
export const DEFAULT_GRAPH_WIDTH = 520;
export const DEFAULT_GRAPH_HEIGHT = 220;
export const GAIN_STEP_DB = 0.1;
export const MAX_CANVAS_CACHE_ENTRIES = 12;

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function quantize(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(3));
}

export function graphXToFrequency(x: number, width: number): number {
  const minLog = Math.log10(GRAPH_MIN_FREQUENCY_HZ);
  const maxLog = Math.log10(GRAPH_MAX_FREQUENCY_HZ);
  const normalized = clamp(x / Math.max(1, width), 0, 1);
  return Math.pow(10, minLog + normalized * (maxLog - minLog));
}

export function graphYToDb(y: number, height: number, rangeDb: number): number {
  const normalized = clamp(y / Math.max(1, height), 0, 1);
  return quantize(rangeDb - normalized * rangeDb * 2, GAIN_STEP_DB);
}

export function formatSignedDb(value: number): string {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)} dB`;
}

export function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace('#', '');
  const bigint = Number.parseInt(raw.length === 3
    ? raw.split('').map(char => char + char).join('')
    : raw, 16);
  if (!Number.isFinite(bigint)) return `rgba(255, 255, 255, ${alpha})`;
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function pruneCache<T>(cache: Map<string, T>): void {
  while (cache.size > MAX_CANVAS_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) return;
    cache.delete(oldestKey);
  }
}

export function bandNeedsGain(band: AudioEqBand): boolean {
  return band.type === 'bell' ||
    band.type === 'low-shelf' ||
    band.type === 'high-shelf' ||
    band.type === 'tilt-shelf';
}

export function bandHasFrequencyHandle(band: AudioEqBand): boolean {
  return band.type !== 'all-pass' || Math.abs(band.gainDb) > 0.0001;
}

export function createDefaultBandDynamics(): AudioEqBandDynamics {
  return { ...createDefaultAudioEqBandDynamics(), enabled: true };
}

export function createDefaultBandSpectralDynamics(): AudioEqBandSpectralDynamics {
  return { ...createDefaultAudioEqBandSpectralDynamics(), enabled: true };
}
