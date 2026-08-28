import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { AnimatableProperty, EasingType, Keyframe } from '../../src/types';
import {
  calculateSourceTime,
  calculateTimelineDuration,
  calculateTotalSourceTime,
  getMaxSpeed,
  hasReverseSpeed,
} from '../../src/utils/speedIntegration';

const RUN_OPTIONS = { numRuns: 100, seed: 0x5eed02 };
const EPSILON = 1e-9;

const finiteSeconds = fc.double({
  min: 0,
  max: 120,
  noNaN: true,
  noDefaultInfinity: true,
});

const finiteSpeed = fc.double({
  min: -16,
  max: 16,
  noNaN: true,
  noDefaultInfinity: true,
});

const positiveSpeed = fc.double({
  min: 0.25,
  max: 16,
  noNaN: true,
  noDefaultInfinity: true,
});

const sourceDuration = fc.double({
  min: 0.01,
  max: 30,
  noNaN: true,
  noDefaultInfinity: true,
});

const nonSpeedProperty = fc.constantFrom<AnimatableProperty>(
  'opacity',
  'position.x',
  'position.y',
  'scale.x',
  'rotation.z',
  'camera.fov',
);

const easing = fc.constantFrom<EasingType>(
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
);

function keyframe(
  index: number,
  property: AnimatableProperty,
  time: number,
  value: number,
  easingValue: EasingType = 'linear',
): Keyframe {
  return {
    id: `kf-${index}`,
    clipId: 'clip-1',
    time,
    property,
    value,
    easing: easingValue,
  };
}

const nonSpeedKeyframes = fc.array(
  fc.record({
    property: nonSpeedProperty,
    time: finiteSeconds,
    value: finiteSpeed,
    easing,
  }),
  { maxLength: 12 },
).map(items => items.map((item, index) => keyframe(index, item.property, item.time, item.value, item.easing)));

const mixedKeyframes = fc.array(
  fc.record({
    property: fc.oneof(fc.constant<AnimatableProperty>('speed'), nonSpeedProperty),
    time: finiteSeconds,
    value: finiteSpeed,
    easing,
  }),
  { maxLength: 16 },
).map(items => items.map((item, index) => keyframe(index, item.property, item.time, item.value, item.easing)));

const positiveSpeedKeyframes = fc.uniqueArray(
  fc.record({
    timeTick: fc.integer({ min: 0, max: 400 }),
    valueTick: fc.integer({ min: 250, max: 16000 }),
  }),
  { minLength: 2, maxLength: 8, selector: item => item.timeTick },
).map(items =>
  items.map((item, index) =>
    keyframe(index, 'speed', item.timeTick / 10, item.valueTick / 1000, 'linear')
  )
);

describe('speedIntegration properties', () => {
  it('uses clip local time multiplied by default speed when no speed keyframes exist', () => {
    fc.assert(
      fc.property(nonSpeedKeyframes, finiteSeconds, finiteSpeed, (keyframes, clipLocalTime, defaultSpeed) => {
        expect(calculateSourceTime(keyframes, clipLocalTime, defaultSpeed)).toBe(clipLocalTime * defaultSpeed);
        expect(calculateTotalSourceTime(keyframes, clipLocalTime, defaultSpeed)).toBe(clipLocalTime * defaultSpeed);
      }),
      RUN_OPTIONS,
    );
  });

  it('uses clip local time multiplied by the single speed keyframe value when the speed keyframe is at time 0', () => {
    fc.assert(
      fc.property(
        nonSpeedKeyframes,
        finiteSpeed,
        finiteSpeed,
        finiteSeconds,
        (otherKeyframes, speedValue, defaultSpeed, clipLocalTime) => {
          const speedKeyframe = keyframe(otherKeyframes.length, 'speed', 0, speedValue);
          const keyframes = [...otherKeyframes, speedKeyframe];

          expect(calculateSourceTime(keyframes, clipLocalTime, defaultSpeed)).toBe(clipLocalTime * speedValue);
          expect(calculateTotalSourceTime(keyframes, clipLocalTime, defaultSpeed)).toBe(clipLocalTime * speedValue);
        },
      ),
      RUN_OPTIONS,
    );
  });

  it('calculates equivalent source time for sorted and unsorted speed keyframes', () => {
    fc.assert(
      fc.property(positiveSpeedKeyframes, positiveSpeed, finiteSeconds, (keyframes, defaultSpeed, clipLocalTime) => {
        const sortedKeyframes = keyframes.toSorted((a, b) => a.time - b.time);
        const unsortedKeyframes = [...sortedKeyframes].reverse();

        expect(calculateSourceTime(unsortedKeyframes, clipLocalTime, defaultSpeed)).toBeCloseTo(
          calculateSourceTime(sortedKeyframes, clipLocalTime, defaultSpeed),
          9,
        );
        expect(calculateTotalSourceTime(unsortedKeyframes, clipLocalTime, defaultSpeed)).toBeCloseTo(
          calculateTotalSourceTime(sortedKeyframes, clipLocalTime, defaultSpeed),
          9,
        );
      }),
      RUN_OPTIONS,
    );
  });

  it('ignores non-speed keyframes when calculating source time', () => {
    fc.assert(
      fc.property(nonSpeedKeyframes, finiteSeconds, finiteSpeed, (keyframes, clipLocalTime, defaultSpeed) => {
        expect(calculateSourceTime(keyframes, clipLocalTime, defaultSpeed)).toBe(
          calculateSourceTime([], clipLocalTime, defaultSpeed),
        );
      }),
      RUN_OPTIONS,
    );
  });

  it('keeps source time nondecreasing for positive default and positive speed keyframes', () => {
    fc.assert(
      fc.property(
        positiveSpeedKeyframes,
        positiveSpeed,
        finiteSeconds,
        finiteSeconds,
        (keyframes, defaultSpeed, timeA, timeB) => {
          const earlier = Math.min(timeA, timeB);
          const later = Math.max(timeA, timeB);
          const sourceEarlier = calculateSourceTime(keyframes, earlier, defaultSpeed);
          const sourceLater = calculateSourceTime(keyframes, later, defaultSpeed);

          expect(sourceLater + EPSILON).toBeGreaterThanOrEqual(sourceEarlier);
        },
      ),
      RUN_OPTIONS,
    );
  });

  it('round-trips positive source durations through calculateTimelineDuration', () => {
    fc.assert(
      fc.property(positiveSpeedKeyframes, sourceDuration, positiveSpeed, (keyframes, duration, defaultSpeed) => {
        const timelineDuration = calculateTimelineDuration(keyframes, duration, defaultSpeed);
        const recoveredSourceDuration = calculateSourceTime(keyframes, timelineDuration, defaultSpeed);

        expect(recoveredSourceDuration).toBeCloseTo(duration, 2);
      }),
      RUN_OPTIONS,
    );
  });

  it('reports a max speed at least as large as the absolute default and every speed keyframe value', () => {
    fc.assert(
      fc.property(mixedKeyframes, finiteSpeed, (keyframes, defaultSpeed) => {
        const maxSpeed = getMaxSpeed(keyframes, defaultSpeed);

        expect(maxSpeed).toBeGreaterThanOrEqual(Math.abs(defaultSpeed));
        for (const speedKeyframe of keyframes.filter(kf => kf.property === 'speed')) {
          expect(maxSpeed).toBeGreaterThanOrEqual(Math.abs(speedKeyframe.value));
        }
      }),
      RUN_OPTIONS,
    );
  });

  it('reports reverse speed from the default only when no speed keyframes exist, otherwise from negative speed keyframes', () => {
    fc.assert(
      fc.property(mixedKeyframes, finiteSpeed, (keyframes, defaultSpeed) => {
        const speedKeyframes = keyframes.filter(kf => kf.property === 'speed');
        const expected = speedKeyframes.length === 0
          ? defaultSpeed < 0
          : speedKeyframes.some(kf => kf.value < 0);

        expect(hasReverseSpeed(keyframes, defaultSpeed)).toBe(expected);
      }),
      RUN_OPTIONS,
    );
  });
});
