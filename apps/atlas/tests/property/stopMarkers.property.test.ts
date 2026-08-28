import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findStopMarkerInPlaybackRange } from '../../src/services/timeline/stopMarkers';
import type { TimelineMarker } from '../../src/stores/timeline/types';

const STOP_MARKER_EPSILON = 1 / 240;

const fcOptions = {
  numRuns: 200,
  seed: 20260518,
};

const finiteTime = fc.double({
  min: -10_000,
  max: 10_000,
  noDefaultInfinity: true,
  noNaN: true,
});

const positiveMovement = fc.double({
  min: STOP_MARKER_EPSILON * 2,
  max: 500,
  noDefaultInfinity: true,
  noNaN: true,
});

const tinyMovement = fc.double({
  min: -STOP_MARKER_EPSILON,
  max: STOP_MARKER_EPSILON,
  noDefaultInfinity: true,
  noNaN: true,
});

const nonFiniteTime = fc.constantFrom(
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
);

function createMarker(index: number, time: number, stopPlayback?: boolean): TimelineMarker {
  return {
    id: `marker-${index}`,
    time,
    label: `Marker ${index}`,
    color: '#ff3366',
    stopPlayback,
  };
}

const markerInput = fc.record({
  time: finiteTime,
  stopPlayback: fc.option(fc.boolean(), { nil: undefined }),
});

const markerArray = fc.array(markerInput, { minLength: 0, maxLength: 40 }).map((inputs) => (
  inputs
    .map((input, index) => createMarker(index, input.time, input.stopPlayback))
    .toSorted((a, b) => a.time - b.time)
));

const nonStopMarkerArray = fc.array(finiteTime, { minLength: 0, maxLength: 40 }).map((times) => (
  times
    .map((time, index) => createMarker(index, time, index % 2 === 0 ? false : undefined))
    .toSorted((a, b) => a.time - b.time)
));

describe('stop marker playback range properties', () => {
  it('forward playback picks the earliest crossed stop marker in source bounds', () => {
    fc.assert(
      fc.property(markerArray, finiteTime, positiveMovement, (markers, fromTime, movement) => {
        const toTime = fromTime + movement;
        const expected = markers.find((marker) => (
          marker.stopPlayback === true
          && marker.time > fromTime + STOP_MARKER_EPSILON
          && marker.time <= toTime + STOP_MARKER_EPSILON
        )) ?? null;

        const actual = findStopMarkerInPlaybackRange(markers, fromTime, toTime);

        expect(actual).toBe(expected);
        if (actual) {
          expect(markers.every((marker) => (
            marker === actual
            || marker.stopPlayback !== true
            || marker.time <= fromTime + STOP_MARKER_EPSILON
            || marker.time > actual.time
          ))).toBe(true);
        }
      }),
      fcOptions,
    );
  });

  it('reverse playback picks the nearest crossed stop marker in source bounds', () => {
    fc.assert(
      fc.property(markerArray, finiteTime, positiveMovement, (markers, toTime, movement) => {
        const fromTime = toTime + movement;
        const expected = markers.findLast((marker) => (
          marker.stopPlayback === true
          && marker.time < fromTime - STOP_MARKER_EPSILON
          && marker.time >= toTime - STOP_MARKER_EPSILON
        )) ?? null;

        const actual = findStopMarkerInPlaybackRange(markers, fromTime, toTime);

        expect(actual).toBe(expected);
        if (actual) {
          expect(markers.every((marker) => (
            marker === actual
            || marker.stopPlayback !== true
            || marker.time >= fromTime - STOP_MARKER_EPSILON
            || marker.time < actual.time
          ))).toBe(true);
        }
      }),
      fcOptions,
    );
  });

  it('ignores markers that are not explicit stopPlayback markers', () => {
    fc.assert(
      fc.property(nonStopMarkerArray, finiteTime, finiteTime, (markers, fromTime, toTime) => {
        expect(findStopMarkerInPlaybackRange(markers, fromTime, toTime)).toBeNull();
      }),
      fcOptions,
    );
  });

  it('returns null for movement at or below epsilon', () => {
    fc.assert(
      fc.property(markerArray, finiteTime, tinyMovement, (markers, fromTime, movement) => {
        const toTime = fromTime + movement;

        expect(findStopMarkerInPlaybackRange(markers, fromTime, toTime)).toBeNull();
      }),
      fcOptions,
    );
  });

  it('returns null for non-finite range endpoints', () => {
    fc.assert(
      fc.property(markerArray, nonFiniteTime, finiteTime, (markers, fromTime, toTime) => {
        expect(findStopMarkerInPlaybackRange(markers, fromTime, toTime)).toBeNull();
      }),
      fcOptions,
    );

    fc.assert(
      fc.property(markerArray, finiteTime, nonFiniteTime, (markers, fromTime, toTime) => {
        expect(findStopMarkerInPlaybackRange(markers, fromTime, toTime)).toBeNull();
      }),
      fcOptions,
    );
  });
});
