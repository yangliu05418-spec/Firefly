export interface SamplePresentationTiming {
  cts: number;
  timescale: number;
}

export function getPresentationOffsetSeconds(samples: readonly SamplePresentationTiming[]): number {
  let firstPresentationTime = Infinity;

  for (const sample of samples) {
    if (!Number.isFinite(sample.cts) || !Number.isFinite(sample.timescale) || sample.timescale <= 0) {
      continue;
    }

    firstPresentationTime = Math.min(firstPresentationTime, sample.cts / sample.timescale);
  }

  return Number.isFinite(firstPresentationTime) ? firstPresentationTime : 0;
}

export function getNormalizedSampleSourceTime(
  sample: SamplePresentationTiming,
  presentationOffsetSeconds: number
): number {
  if (!Number.isFinite(sample.cts) || !Number.isFinite(sample.timescale) || sample.timescale <= 0) {
    return 0;
  }

  const sourceTime = (sample.cts / sample.timescale) - presentationOffsetSeconds;
  return Number.isFinite(sourceTime) ? Math.max(0, sourceTime) : 0;
}

export function getNormalizedSampleTimestampMicroseconds(
  sample: SamplePresentationTiming,
  presentationOffsetSeconds: number
): number {
  return Math.round(getNormalizedSampleSourceTime(sample, presentationOffsetSeconds) * 1_000_000);
}
