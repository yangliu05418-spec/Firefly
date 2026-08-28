import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_CAMERA_FOV_DEGREES,
  MIN_CAMERA_FOV_DEGREES,
  clampCameraFov,
  fovToFullFrameFocalLengthMm,
  fullFrameFocalLengthMmToFov,
} from '../../src/utils/cameraLens';

const fcOptions = {
  numRuns: 200,
  seed: 20260518,
};

const finiteNumber = fc.double({
  min: -1_000_000,
  max: 1_000_000,
  noDefaultInfinity: true,
  noNaN: true,
});

describe('camera lens properties', () => {
  it('clamps finite FOV values into the supported camera range', () => {
    fc.assert(
      fc.property(finiteNumber, (value) => {
        const clamped = clampCameraFov(value);

        expect(Number.isFinite(clamped)).toBe(true);
        expect(clamped).toBeGreaterThanOrEqual(MIN_CAMERA_FOV_DEGREES);
        expect(clamped).toBeLessThanOrEqual(MAX_CAMERA_FOV_DEGREES);
      }),
      fcOptions,
    );
  });

  it('round-trips supported FOV values through full-frame focal length', () => {
    fc.assert(
      fc.property(
        fc.double({
          min: MIN_CAMERA_FOV_DEGREES,
          max: MAX_CAMERA_FOV_DEGREES,
          noDefaultInfinity: true,
          noNaN: true,
        }),
        (fov) => {
          const focalLength = fovToFullFrameFocalLengthMm(fov);
          const restoredFov = fullFrameFocalLengthMmToFov(focalLength);

          expect(focalLength).toBeGreaterThan(0);
          expect(restoredFov).toBeCloseTo(fov, 8);
        },
      ),
      fcOptions,
    );
  });

  it('maps longer focal lengths to narrower or equal FOVs', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1_000, noDefaultInfinity: true, noNaN: true }),
        fc.double({ min: 1, max: 1_000, noDefaultInfinity: true, noNaN: true }),
        (a, b) => {
          const shorter = Math.min(a, b);
          const longer = Math.max(a, b);

          expect(fullFrameFocalLengthMmToFov(longer)).toBeLessThanOrEqual(
            fullFrameFocalLengthMmToFov(shorter),
          );
        },
      ),
      fcOptions,
    );
  });
});
