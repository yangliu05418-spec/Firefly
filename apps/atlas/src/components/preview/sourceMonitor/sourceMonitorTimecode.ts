// Source monitor timecode and ruler math — pure time normalization, clamping,
// timecode formatting, and timeline tick derivation for the source monitor.

export const DEFAULT_STILL_DURATION = 5;
export const MIN_MARK_GAP_SECONDS = 0.001;

export interface SourceTimelineTick {
  time: number;
  label: string;
  major: boolean;
}

export function normalizeDuration(value: number | undefined, fallback = 0): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : fallback;
}

export function clampTime(time: number, duration: number): number {
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.min(Math.max(0, duration), time));
}

function getNiceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const exponent = Math.floor(Math.log10(rawStep));
  const base = rawStep / 10 ** exponent;
  const niceBase = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return niceBase * 10 ** exponent;
}

export function formatTimecode(seconds: number, fps: number): string {
  const safeSeconds = Math.max(0, seconds);
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = Math.floor(safeSeconds % 60);
  const f = Math.floor((safeSeconds % 1) * fps);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
}

export function createTimelineTicks(duration: number, fps: number): SourceTimelineTick[] {
  if (duration <= 0) return [];
  const majorStep = getNiceStep(duration / 5);
  const minorStep = majorStep / 4;
  const ticks: SourceTimelineTick[] = [];
  const maxTicks = 96;

  for (let i = 0; i <= maxTicks; i += 1) {
    const time = i * minorStep;
    if (time > duration + MIN_MARK_GAP_SECONDS) break;
    const major = Math.abs(time / majorStep - Math.round(time / majorStep)) < 0.0001 || time === 0;
    ticks.push({
      time: Math.min(time, duration),
      label: major ? formatTimecode(time, fps) : '',
      major,
    });
  }

  if (ticks[ticks.length - 1]?.time !== duration) {
    ticks.push({ time: duration, label: formatTimecode(duration, fps), major: true });
  }

  return ticks;
}
