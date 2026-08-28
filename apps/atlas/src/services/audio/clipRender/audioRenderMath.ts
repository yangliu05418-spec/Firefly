export function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function dbToLinearGain(db: number): number {
  if (!Number.isFinite(db)) return 1;
  return Math.pow(10, db / 20);
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function rangeFeatherFactor(
  sample: number,
  range: { start: number; end: number },
  featherSamples: number,
): number {
  if (featherSamples <= 0) return 1;
  const distanceToEdge = Math.min(sample - range.start, range.end - 1 - sample);
  return Math.max(0, Math.min(1, (distanceToEdge + 1) / featherSamples));
}
