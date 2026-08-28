import type { AudioEvent } from '../beatOnsetManifest';
import type { BeatEstimate } from './beatOnsetAnalysisTypes';

export const MIN_TEMPO_BPM = 60;
export const MAX_TEMPO_BPM = 200;

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function estimateBeatGrid(onsets: readonly AudioEvent[], duration: number): BeatEstimate {
  if (onsets.length < 2 || duration <= 0) {
    return { confidence: 0, beats: [] };
  }

  const tempoBins = new Float32Array(MAX_TEMPO_BPM - MIN_TEMPO_BPM + 1);
  for (let left = 0; left < onsets.length; left += 1) {
    for (let right = left + 1; right < Math.min(onsets.length, left + 8); right += 1) {
      const interval = (onsets[right]?.time ?? 0) - (onsets[left]?.time ?? 0);
      if (interval <= 0) continue;
      let bpm = 60 / interval;
      while (bpm < MIN_TEMPO_BPM) bpm *= 2;
      while (bpm > MAX_TEMPO_BPM) bpm /= 2;
      if (bpm < MIN_TEMPO_BPM || bpm > MAX_TEMPO_BPM) continue;
      const bin = Math.round(bpm) - MIN_TEMPO_BPM;
      const weight = ((onsets[left]?.strength ?? 0) + (onsets[right]?.strength ?? 0)) / 2;
      tempoBins[bin] += weight;
    }
  }

  let bestBin = -1;
  let bestScore = 0;
  let totalScore = 0;
  for (let bin = 0; bin < tempoBins.length; bin += 1) {
    const score = tempoBins[bin] ?? 0;
    totalScore += score;
    if (score > bestScore) {
      bestScore = score;
      bestBin = bin;
    }
  }

  if (bestBin < 0 || bestScore <= 0) {
    return { confidence: 0, beats: [] };
  }

  const tempoBpm = MIN_TEMPO_BPM + bestBin;
  const interval = 60 / tempoBpm;
  const phase = onsets.toSorted((a, b) => b.strength - a.strength)[0]?.time ?? 0;
  const firstBeat = phase - Math.ceil(phase / interval) * interval;
  const beats: AudioEvent[] = [];

  for (let time = firstBeat; time <= duration + interval * 0.5; time += interval) {
    if (time < 0) continue;
    const nearest = onsets.reduce<AudioEvent | null>((best, onset) => {
      const distance = Math.abs(onset.time - time);
      if (distance > interval * 0.33) return best;
      if (!best) return onset;
      return distance < Math.abs(best.time - time) ? onset : best;
    }, null);
    const distance = nearest ? Math.abs(nearest.time - time) : interval * 0.33;
    const proximity = 1 - Math.min(1, distance / Math.max(interval * 0.33, 1e-6));
    beats.push({
      time,
      strength: nearest?.strength ?? 0,
      confidence: clamp01((nearest?.confidence ?? 0.35) * 0.5 + proximity * 0.5),
    });
  }

  return {
    tempoBpm,
    confidence: clamp01(bestScore / Math.max(totalScore, 1e-12)),
    beats,
  };
}
