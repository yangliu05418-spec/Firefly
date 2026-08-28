import { describe, expect, it } from 'vitest';
import {
  getCanvasSnapPoints,
  getRectSnapPoints,
  resolveSnapDelta,
  snapPointToTargets,
} from '../../src/components/preview/editModeSnapping';

describe('edit mode snapping', () => {
  it('snaps a point to the nearest enabled axis within threshold', () => {
    const snapped = snapPointToTargets(
      { x: 98, y: 51 },
      { x: [0, 100, 200], y: [0, 50, 100] },
      4,
    );

    expect(snapped).toEqual({ x: 100, y: 50 });
  });

  it('keeps disabled axes unchanged', () => {
    const snapped = snapPointToTargets(
      { x: 98, y: 51 },
      { x: [100], y: [50] },
      4,
      { x: false, y: true },
    );

    expect(snapped).toEqual({ x: 98, y: 50 });
  });

  it('resolves the closest rect edge or center delta against canvas guides', () => {
    const delta = resolveSnapDelta(
      getRectSnapPoints({ left: 97, top: 48, right: 197, bottom: 148 }),
      getCanvasSnapPoints(200, 100),
      5,
    );

    expect(delta).toEqual({ x: 3, y: 2 });
  });
});
