import type { Sample } from '../webCodecsTypes';

export class WebCodecsSampleTimeline {
  private ctsSorted: { idx: number; cts: number }[] = [];
  private ctsSortedSampleCount = 0;
  private readonly getSamples: () => Sample[];

  constructor(getSamples: () => Sample[]) {
    this.getSamples = getSamples;
  }

  /** Binary search for sample index whose CTS is closest to target */
  findSampleNearCts(targetCts: number): number {
    this.ensureCtsIndex();
    const sorted = this.ctsSorted;
    if (sorted.length === 0) return 0;

    let lo = 0, hi = sorted.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].cts < targetCts) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(sorted[lo - 1].cts - targetCts) < Math.abs(sorted[lo].cts - targetCts)) {
      return sorted[lo - 1].idx;
    }
    return sorted[lo].idx;
  }

  /** Find nearest keyframe at or before the target sample's presentation time. */
  findKeyframeBefore(sampleIndex: number): number {
    const samples = this.getSamples();
    const target = samples[Math.min(sampleIndex, samples.length - 1)];
    if (!target) return 0;

    let bestIndex = -1;
    let bestCts = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i];
      if (!sample.is_sync || sample.cts > target.cts) continue;
      if (sample.cts > bestCts) {
        bestCts = sample.cts;
        bestIndex = i;
      }
    }
    return bestIndex >= 0 ? bestIndex : 0;
  }

  getSampleTimestampUs(index: number): number | null {
    const samples = this.getSamples();
    if (index < 0 || index >= samples.length) {
      return null;
    }
    const sample = samples[index];
    return (sample.cts * 1_000_000) / sample.timescale;
  }

  /** Compute seek acceptance tolerance in microseconds with VFR-aware neighbor spacing. */
  computeSeekToleranceUs(targetIndex: number, frameRate: number): number {
    const samples = this.getSamples();
    const nominalFrameUs = 1_000_000 / Math.max(frameRate, 1);
    const target = samples[targetIndex];
    if (!target) return nominalFrameUs * 1.5;

    let neighborDeltaUs = Infinity;

    if (targetIndex > 0) {
      const prev = samples[targetIndex - 1];
      const prevDelta = Math.abs(target.cts - prev.cts) * 1_000_000 / target.timescale;
      if (prevDelta > 0) neighborDeltaUs = Math.min(neighborDeltaUs, prevDelta);
    }

    if (targetIndex < samples.length - 1) {
      const next = samples[targetIndex + 1];
      const nextDelta = Math.abs(next.cts - target.cts) * 1_000_000 / target.timescale;
      if (nextDelta > 0) neighborDeltaUs = Math.min(neighborDeltaUs, nextDelta);
    }

    const vfrAwareUs = Number.isFinite(neighborDeltaUs)
      ? neighborDeltaUs * 0.75
      : nominalFrameUs * 1.5;

    return Math.max(2_000, Math.min(200_000, Math.max(vfrAwareUs, nominalFrameUs)));
  }

  /** Lazy-build CTS-sorted index for O(log n) sample lookup */
  private ensureCtsIndex(): void {
    const samples = this.getSamples();
    if (this.ctsSortedSampleCount === samples.length) return;
    this.ctsSorted = samples.map((s, i) => ({ idx: i, cts: s.cts }));
    this.ctsSorted.sort((a, b) => a.cts - b.cts);
    this.ctsSortedSampleCount = samples.length;
  }
}
