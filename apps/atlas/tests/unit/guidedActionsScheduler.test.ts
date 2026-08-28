import { describe, expect, it } from 'vitest';
import {
  inferGuidedActionFamily,
  normalizeGuidedAnimationBudget,
  planGuidedActions,
} from '../../src/services/guidedActions';
import type { GuidedAction } from '../../src/services/guidedActions';

const timelineTarget = (time: number) => ({ kind: 'timelineTime' as const, time });

describe('guided action scheduler', () => {
  it('normalizes the persisted animation budget and treats 0ms as instant mode', () => {
    expect(normalizeGuidedAnimationBudget(0)).toEqual({
      totalMs: 0,
      disabled: true,
      compression: 'family',
    });

    expect(normalizeGuidedAnimationBudget(15_000)).toEqual({
      totalMs: 15_000,
      disabled: false,
      compression: 'family',
    });

    expect(normalizeGuidedAnimationBudget(3_600_000)).toEqual({
      totalMs: 3_600_000,
      disabled: false,
      compression: 'family',
    });
  });

  it('sets every planned duration to zero for instant mode', () => {
    const plan = planGuidedActions([
      { type: 'moveCursorTo', target: timelineTarget(1), durationMs: 500 },
      { type: 'clickVisual', target: timelineTarget(1) },
      { type: 'executeTool', tool: 'splitClip', args: { clipId: 'clip-1', time: 1 } },
    ], 0);

    expect(plan.diagnostics.disabled).toBe(true);
    expect(plan.diagnostics.plannedDurationMs).toBe(0);
    expect(plan.actions.map((action) => action.plannedDurationMs)).toEqual([0, 0, 0]);
  });

  it('scales visual durations to fit the total response budget', () => {
    const plan = planGuidedActions([
      { type: 'moveCursorTo', target: timelineTarget(1), durationMs: 1000 },
      { type: 'highlightTarget', target: timelineTarget(1), durationMs: 1000 },
      { type: 'delay', ms: 1000 },
    ], { totalMs: 1000, compression: 'none' });

    expect(plan.diagnostics.naturalDurationMs).toBe(3000);
    expect(plan.diagnostics.scale).toBeCloseTo(1 / 3);
    expect(plan.diagnostics.plannedDurationMs).toBeLessThanOrEqual(1000);
  });

  it('stretches visual durations to use a larger requested budget', () => {
    const plan = planGuidedActions([
      { type: 'moveCursorTo', target: timelineTarget(1), durationMs: 1000 },
      { type: 'clickVisual', target: timelineTarget(1) },
    ], { totalMs: 20_000, compression: 'none' });

    expect(plan.diagnostics.naturalDurationMs).toBe(1180);
    expect(plan.diagnostics.scale).toBeCloseTo(20_000 / 1180);
    expect(plan.diagnostics.plannedDurationMs).toBeLessThanOrEqual(20_000);
    expect(plan.diagnostics.plannedDurationMs).toBeGreaterThanOrEqual(19_999);
  });

  it('compresses repeated same-family visual actions before scaling', () => {
    const actions: GuidedAction[] = [
      { type: 'moveCursorTo', target: timelineTarget(1), durationMs: 400 },
      { type: 'clickVisual', target: timelineTarget(1) },
      { type: 'moveCursorTo', target: timelineTarget(2), durationMs: 400 },
      { type: 'clickVisual', target: timelineTarget(2) },
    ];
    const plan = planGuidedActions(actions, { totalMs: 5000, compression: 'family' });

    expect(plan.diagnostics.compressedNaturalDurationMs).toBeLessThan(plan.diagnostics.naturalDurationMs);
    expect(plan.diagnostics.compressedGroups).toEqual([
      expect.objectContaining({
        family: 'timeline-edit',
        startIndex: 0,
        endIndex: 3,
        actionCount: 4,
      }),
    ]);
    expect(plan.actions.slice(1).every((action) => action.compressed)).toBe(true);
  });

  it('classifies semantic tool calls by choreography family', () => {
    expect(inferGuidedActionFamily({
      type: 'executeTool',
      tool: 'setTransform',
      args: { clipId: 'clip-1', x: 120 },
    })).toBe('property-edit');

    expect(inferGuidedActionFamily({
      type: 'executeTool',
      tool: 'addRectangleMask',
      args: { clipId: 'clip-1' },
    })).toBe('mask-edit');
  });
});
