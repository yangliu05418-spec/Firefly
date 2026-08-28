import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import type { AnimatableProperty, ClipTransform, Keyframe } from '../../src/types';
import {
  getValueFromTransform,
  getShortestAngleDeltaDegrees,
  interpolateKeyframes,
  setValueInTransform,
} from '../../src/utils/keyframeInterpolation';

const propertyOptions = { numRuns: 100, seed: 0x4b465001 };
const finiteValue = fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true, noDefaultInfinity: true });
const timeValue = fc.double({ min: -10_000, max: 10_000, noNaN: true, noDefaultInfinity: true });
const interpolationTime = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });
const angleValue = fc.double({ min: -10_000, max: 10_000, noNaN: true, noDefaultInfinity: true });
const supportedTransformProperties = [
  'opacity',
  'position.x',
  'position.y',
  'position.z',
  'scale.all',
  'scale.x',
  'scale.y',
  'scale.z',
  'rotation.x',
  'rotation.y',
  'rotation.z',
] as const satisfies readonly AnimatableProperty[];
const supportedTransformProperty = fc.constantFrom(...supportedTransformProperties);
const transformValue = fc.double({ min: -10_000, max: 10_000, noNaN: true, noDefaultInfinity: true });
const transformArbitrary = fc.record({
  opacity: transformValue,
  blendMode: fc.constant('normal' as const),
  position: fc.record({
    x: transformValue,
    y: transformValue,
    z: transformValue,
  }),
  scale: fc.record({
    all: transformValue,
    x: transformValue,
    y: transformValue,
    z: transformValue,
  }),
  rotation: fc.record({
    x: transformValue,
    y: transformValue,
    z: transformValue,
  }),
}) satisfies fc.Arbitrary<ClipTransform>;

function keyframe(
  property: AnimatableProperty,
  time: number,
  value: number,
  id = `kf-${property}-${time}`,
): Keyframe {
  return {
    id,
    clipId: 'clip-1',
    property,
    time,
    value,
    easing: 'linear',
  };
}

function cloneTransform(transform: ClipTransform): ClipTransform {
  return {
    ...transform,
    position: { ...transform.position },
    scale: { ...transform.scale },
    rotation: { ...transform.rotation },
  };
}

function expectOnlyPropertyChanged(
  before: ClipTransform,
  after: ClipTransform,
  property: AnimatableProperty,
  value: number,
): void {
  const expected = cloneTransform(before);

  switch (property) {
    case 'opacity':
      expected.opacity = value;
      break;
    case 'position.x':
      expected.position.x = value;
      break;
    case 'position.y':
      expected.position.y = value;
      break;
    case 'position.z':
      expected.position.z = value;
      break;
    case 'scale.all':
      expected.scale.all = value;
      break;
    case 'scale.x':
      expected.scale.x = value;
      break;
    case 'scale.y':
      expected.scale.y = value;
      break;
    case 'scale.z':
      expected.scale.z = value;
      break;
    case 'rotation.x':
      expected.rotation.x = value;
      break;
    case 'rotation.y':
      expected.rotation.y = value;
      break;
    case 'rotation.z':
      expected.rotation.z = value;
      break;
    default:
      throw new Error(`Unexpected transform property: ${property}`);
  }

  expect(after).toEqual(expected);
}

describe('keyframeInterpolation properties', () => {
  it('returns the default value when no keyframes target the requested property', () => {
    fc.assert(
      fc.property(
        fc.array(finiteValue, { maxLength: 20 }),
        timeValue,
        finiteValue,
        (values, time, defaultValue) => {
          const otherPropertyKeyframes = values.map((value, index) =>
            keyframe('scale.x', index, value),
          );

          expect(interpolateKeyframes(otherPropertyKeyframes, 'opacity', time, defaultValue)).toBe(defaultValue);
        },
      ),
      propertyOptions,
    );
  });

  it('returns the keyed value when exactly one keyframe targets the property', () => {
    fc.assert(
      fc.property(
        finiteValue,
        timeValue,
        timeValue,
        finiteValue,
        (value, keyTime, sampleTime, unrelatedValue) => {
          const keyframes = [
            keyframe('opacity', keyTime, value),
            keyframe('scale.x', keyTime, unrelatedValue),
          ];

          expect(interpolateKeyframes(keyframes, 'opacity', sampleTime, 0)).toBe(value);
        },
      ),
      propertyOptions,
    );
  });

  it('treats unsorted keyframes the same as sorted keyframes', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            time: fc.integer({ min: -1_000, max: 1_000 }),
            value: finiteValue,
          }),
          { minLength: 2, maxLength: 20, selector: ({ time }) => time },
        ),
        timeValue,
        (points, sampleTime) => {
          const sorted = points
            .toSorted((a, b) => a.time - b.time)
            .map((point, index) => keyframe('position.x', point.time, point.value, `sorted-${index}`));
          const unsorted = sorted.toReversed();

          expect(interpolateKeyframes(unsorted, 'position.x', sampleTime, 0)).toBeCloseTo(
            interpolateKeyframes(sorted, 'position.x', sampleTime, 0),
          );
        },
      ),
      propertyOptions,
    );
  });

  it('keeps linear interpolation inside the endpoint value range for times inside a segment', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000, max: 999 }),
        fc.integer({ min: 1, max: 1_000 }),
        finiteValue,
        finiteValue,
        interpolationTime,
        (startTime, duration, startValue, endValue, t) => {
          const endTime = startTime + duration;
          const sampleTime = startTime + duration * t;
          const result = interpolateKeyframes(
            [
              keyframe('scale.y', startTime, startValue, 'start'),
              keyframe('scale.y', endTime, endValue, 'end'),
            ],
            'scale.y',
            sampleTime,
            1,
          );
          const min = Math.min(startValue, endValue);
          const max = Math.max(startValue, endValue);

          expect(result).toBeGreaterThanOrEqual(min - 1e-9);
          expect(result).toBeLessThanOrEqual(max + 1e-9);
        },
      ),
      propertyOptions,
    );
  });

  it('always resolves shortest angle deltas within [-180, 180]', () => {
    fc.assert(
      fc.property(finiteValue, finiteValue, (from, to) => {
        const delta = getShortestAngleDeltaDegrees(from, to);

        expect(delta).toBeGreaterThanOrEqual(-180);
        expect(delta).toBeLessThanOrEqual(180);
      }),
      propertyOptions,
    );
  });

  it('round-trips supported transform properties through get/set lenses', () => {
    fc.assert(
      fc.property(
        transformArbitrary,
        supportedTransformProperty,
        transformValue,
        (transform, property, value) => {
          const updated = setValueInTransform(transform, property, value);

          expect(getValueFromTransform(updated, property)).toBe(value);
        },
      ),
      propertyOptions,
    );
  });

  it('sets supported transform properties without mutating the input transform', () => {
    fc.assert(
      fc.property(
        transformArbitrary,
        supportedTransformProperty,
        transformValue,
        (transform, property, value) => {
          const before = cloneTransform(transform);

          setValueInTransform(transform, property, value);

          expect(transform).toEqual(before);
        },
      ),
      propertyOptions,
    );
  });

  it('sets one supported transform property while leaving unrelated fields unchanged', () => {
    fc.assert(
      fc.property(
        transformArbitrary,
        supportedTransformProperty,
        transformValue,
        (transform, property, value) => {
          const before = cloneTransform(transform);
          const updated = setValueInTransform(transform, property, value);

          expectOnlyPropertyChanged(before, updated, property, value);
        },
      ),
      propertyOptions,
    );
  });

  it('keeps shortest-angle rotation interpolation within 180 degrees of the segment start', () => {
    fc.assert(
      fc.property(
        angleValue,
        angleValue,
        interpolationTime,
        (startValue, endValue, t) => {
          const result = interpolateKeyframes(
            [
              {
                ...keyframe('rotation.y', 0, startValue, 'start'),
                rotationInterpolation: 'shortest',
              },
              keyframe('rotation.y', 1, endValue, 'end'),
            ],
            'rotation.y',
            t,
            0,
          );

          expect(Math.abs(result - startValue)).toBeLessThanOrEqual(180 + 1e-9);
        },
      ),
      propertyOptions,
    );
  });
});
