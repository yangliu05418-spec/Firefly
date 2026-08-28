import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { EasingType } from '../../src/types';
import { normalizeEasingType } from '../../src/utils/easing';
import { easingFunctions, PRESET_BEZIER } from '../../src/utils/keyframeInterpolation';

const knownEasings = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'bezier'] as const satisfies readonly EasingType[];
const presetEasings = ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const satisfies readonly Exclude<EasingType, 'bezier'>[];
const aliasCases = [
  ['linear', 'linear'],
  [' linear ', 'linear'],
  ['LINEAR', 'linear'],
  ['ease-in', 'ease-in'],
  ['easeIn', 'ease-in'],
  ['ease_in', 'ease-in'],
  ['ease in', 'ease-in'],
  ['EaseInElastic', 'ease-in'],
  ['ease-out', 'ease-out'],
  ['easeOut', 'ease-out'],
  ['ease_out', 'ease-out'],
  ['ease out', 'ease-out'],
  ['EaseOutElastic', 'ease-out'],
  ['ease-in-out', 'ease-in-out'],
  ['easeInOut', 'ease-in-out'],
  ['ease_in_out', 'ease-in-out'],
  ['ease in out', 'ease-in-out'],
  ['EaseInOutElastic', 'ease-in-out'],
  ['bezier', 'bezier'],
  [' BEZIER ', 'bezier'],
] as const satisfies readonly (readonly [string, EasingType])[];
const aliasCompacts = new Set([
  'linear',
  'easein',
  'easeout',
  'easeinout',
  'easeinelastic',
  'easeoutelastic',
  'easeinoutelastic',
  'bezier',
]);

const assertOptions = { seed: 0x5e1ec7, numRuns: 100 };

function compactEasing(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function isKnownEasing(value: string): value is EasingType {
  return knownEasings.includes(value as EasingType);
}

describe('normalizeEasingType properties', () => {
  it('normalizes documented aliases independently of fallback', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...aliasCases),
        fc.constantFrom(...knownEasings),
        ([alias, expected], fallback) => {
          expect(normalizeEasingType(alias, fallback)).toBe(expected);
        },
      ),
      assertOptions,
    );
  });

  it('keeps known easing values unchanged regardless of fallback', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...knownEasings),
        fc.constantFrom(...knownEasings),
        (easing, fallback) => {
          expect(normalizeEasingType(easing, fallback)).toBe(easing);
        },
      ),
      assertOptions,
    );
  });

  it('falls back to the requested default for invalid non-empty strings', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 32 }).filter((value) => {
          const compact = compactEasing(value);
          return compact.length > 0 && !aliasCompacts.has(compact);
        }),
        fc.constantFrom(...knownEasings),
        (invalidEasing, fallback) => {
          expect(normalizeEasingType(invalidEasing, fallback)).toBe(fallback);
        },
      ),
      assertOptions,
    );
  });

  it('falls back to the requested default for null, undefined, and empty input', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(null, undefined, ''),
        fc.constantFrom(...knownEasings),
        (emptyEasing, fallback) => {
          expect(normalizeEasingType(emptyEasing, fallback)).toBe(fallback);
        },
      ),
      assertOptions,
    );
  });

  it('always returns a known easing value when fallback is known', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ maxLength: 64 }), { nil: undefined }),
        fc.constantFrom(...knownEasings),
        (easing, fallback) => {
          expect(isKnownEasing(normalizeEasingType(easing, fallback))).toBe(true);
        },
      ),
      assertOptions,
    );
  });

  it('defaults invalid values to linear when fallback is omitted', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 32 }).filter((value) => {
          const compact = compactEasing(value);
          return compact.length > 0 && !aliasCompacts.has(compact);
        }),
        (invalidEasing) => {
          expect(normalizeEasingType(invalidEasing)).toBe('linear');
        },
      ),
      assertOptions,
    );
  });
});

describe('preset easing properties', () => {
  it('anchors every preset function at the normalized progress endpoints', () => {
    fc.assert(
      fc.property(fc.constantFrom(...presetEasings), (easing) => {
        expect(easingFunctions[easing](0)).toBe(0);
        expect(easingFunctions[easing](1)).toBe(1);
      }),
      assertOptions,
    );
  });

  it('is deterministic for normalized preset progress values', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...presetEasings),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (easing, progress) => {
          const first = easingFunctions[easing](progress);
          const second = easingFunctions[easing](progress);
          expect(second).toBe(first);
        },
      ),
      assertOptions,
    );
  });

  it('maps normalized preset progress values to finite values in the unit interval', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...presetEasings),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (easing, progress) => {
          const eased = easingFunctions[easing](progress);
          expect(Number.isFinite(eased)).toBe(true);
          expect(eased).toBeGreaterThanOrEqual(0);
          expect(eased).toBeLessThanOrEqual(1);
        },
      ),
      assertOptions,
    );
  });

  it('is monotonic over the normalized progress interval for current presets', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...presetEasings),
        fc.tuple(
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
        ),
        (easing, [a, b]) => {
          const earlier = Math.min(a, b);
          const later = Math.max(a, b);
          expect(easingFunctions[easing](earlier)).toBeLessThanOrEqual(easingFunctions[easing](later));
        },
      ),
      assertOptions,
    );
  });

  it('keeps preset bezier handles finite for conversion consumers', () => {
    fc.assert(
      fc.property(fc.constantFrom(...presetEasings), (easing) => {
        expect(PRESET_BEZIER[easing].p1).toHaveLength(2);
        expect(PRESET_BEZIER[easing].p2).toHaveLength(2);
        const coordinates = [...PRESET_BEZIER[easing].p1, ...PRESET_BEZIER[easing].p2];
        expect(coordinates.every(Number.isFinite)).toBe(true);
      }),
      assertOptions,
    );
  });
});
