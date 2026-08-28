export const LUFS_SILENCE_FLOOR = -120;
export const RMS_SILENCE_FLOOR_DBFS = -120;

export function safeSample(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function createPowerPrefix(values: Float64Array | Float32Array): Float64Array {
  const prefix = new Float64Array(values.length + 1);
  for (let index = 0; index < values.length; index += 1) {
    prefix[index + 1] = prefix[index] + Math.max(0, safeSample(values[index] ?? 0));
  }
  return prefix;
}

export function pointCountFor(bufferLength: number, sampleRate: number, hopDuration: number): number {
  const hopSamples = Math.max(1, Math.round(hopDuration * sampleRate));
  return Math.max(1, Math.ceil(Math.max(1, bufferLength) / hopSamples));
}

export function powerToLufs(power: number): number {
  return power > 0 ? -0.691 + 10 * Math.log10(power) : LUFS_SILENCE_FLOOR;
}

export function amplitudeToDbfs(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : RMS_SILENCE_FLOOR_DBFS;
}

export function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
