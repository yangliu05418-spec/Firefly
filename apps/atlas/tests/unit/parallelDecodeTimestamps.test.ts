import { describe, expect, it } from 'vitest';
import {
  getNormalizedSampleSourceTime,
  getNormalizedSampleTimestampMicroseconds,
  getPresentationOffsetSeconds,
} from '../../src/engine/ParallelDecodeManager';

describe('parallel decode timestamp normalization', () => {
  it('maps a positive first CTS offset to source time zero', () => {
    const samples = [
      { cts: 5_000, timescale: 30_000 },
      { cts: 6_000, timescale: 30_000 },
    ];

    const offset = getPresentationOffsetSeconds(samples);

    expect(offset).toBeCloseTo(1 / 6);
    expect(getNormalizedSampleSourceTime(samples[0], offset)).toBe(0);
    expect(getNormalizedSampleSourceTime(samples[1], offset)).toBeCloseTo(1 / 30);
    expect(getNormalizedSampleTimestampMicroseconds(samples[1], offset)).toBe(33_333);
  });

  it('leaves zero-based sample timestamps unchanged', () => {
    const samples = [
      { cts: 0, timescale: 90_000 },
      { cts: 3_000, timescale: 90_000 },
    ];

    const offset = getPresentationOffsetSeconds(samples);

    expect(offset).toBe(0);
    expect(getNormalizedSampleSourceTime(samples[1], offset)).toBeCloseTo(1 / 30);
    expect(getNormalizedSampleTimestampMicroseconds(samples[1], offset)).toBe(33_333);
  });
});
