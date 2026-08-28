import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { resolveExportRange } from '../../src/components/export/exportRange';

const fcOptions = {
  numRuns: 200,
  seed: 20260518,
};

const finiteTime = fc.double({
  min: -1_000_000,
  max: 1_000_000,
  noDefaultInfinity: true,
  noNaN: true,
});

const numericTime = fc.oneof(
  finiteTime,
  fc.constant(Number.NaN),
  fc.constant(Number.POSITIVE_INFINITY),
  fc.constant(Number.NEGATIVE_INFINITY),
);

const nullableNumericTime = fc.oneof(numericTime, fc.constant(null));

function safeDuration(duration: number): number {
  return Math.max(0, Number.isFinite(duration) ? duration : 0);
}

function sanitizeTime(value: number | null, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

describe('resolveExportRange properties', () => {
  it('always resolves to a finite monotonic range inside the safe duration', () => {
    fc.assert(
      fc.property(
        numericTime,
        nullableNumericTime,
        nullableNumericTime,
        fc.boolean(),
        (duration, inPoint, outPoint, useInOut) => {
          const resolved = resolveExportRange({ duration, inPoint, outPoint }, useInOut);
          const durationLimit = safeDuration(duration);

          expect(Number.isFinite(resolved.startTime)).toBe(true);
          expect(Number.isFinite(resolved.endTime)).toBe(true);
          expect(resolved.startTime).toBeGreaterThanOrEqual(0);
          expect(resolved.endTime).toBeGreaterThanOrEqual(resolved.startTime);
          expect(resolved.endTime).toBeLessThanOrEqual(durationLimit);
          expect(resolved.endTime - resolved.startTime).toBeGreaterThanOrEqual(0);
        },
      ),
      fcOptions,
    );
  });

  it('ignores all marker values when In/Out export is disabled', () => {
    fc.assert(
      fc.property(numericTime, nullableNumericTime, nullableNumericTime, (duration, inPoint, outPoint) => {
        expect(resolveExportRange({ duration, inPoint, outPoint }, false)).toEqual({
          startTime: 0,
          endTime: safeDuration(duration),
        });
      }),
      fcOptions,
    );
  });

  it('defaults null markers to the full safe duration when In/Out export is enabled', () => {
    fc.assert(
      fc.property(numericTime, (duration) => {
        expect(resolveExportRange({ duration, inPoint: null, outPoint: null }, true)).toEqual({
          startTime: 0,
          endTime: safeDuration(duration),
        });
      }),
      fcOptions,
    );
  });

  it('collapses reversed ranges to the clamped start when the requested end is before it', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 1_000_000, noDefaultInfinity: true, noNaN: true }),
        finiteTime,
        finiteTime,
        (duration, inPoint, outPoint) => {
          const durationLimit = safeDuration(duration);
          const requestedStart = sanitizeTime(inPoint, 0);
          const clampedStart = Math.max(0, Math.min(requestedStart, durationLimit));

          fc.pre(outPoint < clampedStart);

          expect(resolveExportRange({ duration, inPoint, outPoint }, true)).toEqual({
            startTime: clampedStart,
            endTime: clampedStart,
          });
        },
      ),
      fcOptions,
    );
  });
});
