import { describe, expect, it } from 'vitest';
import { createGuidedReplayBudgetController } from '../../src/services/aiTools/guidedReplayBudget';

describe('guided replay budget controller', () => {
  it('splits remaining budget across the current tool group', () => {
    const controller = createGuidedReplayBudgetController({
      totalMs: 3000,
      compression: 'aggressive',
    });

    expect(controller.compression).toBe('aggressive');
    expect(controller.reserveBudgetMs(3)).toBe(1000);

    controller.consumeBudgetMs(600);
    expect(controller.getRemainingBudgetMs()).toBe(2400);
    expect(controller.reserveBudgetMs(2)).toBe(1200);

    controller.consumeBudgetMs(2500);
    expect(controller.getRemainingBudgetMs()).toBe(0);
    expect(controller.reserveBudgetMs(1)).toBe(0);
  });

  it('uses zero reservations for disabled budgets', () => {
    const controller = createGuidedReplayBudgetController({
      totalMs: 0,
      compression: 'family',
    });

    expect(controller.reserveBudgetMs(5)).toBe(0);
    controller.consumeBudgetMs(100);
    expect(controller.getRemainingBudgetMs()).toBe(0);
  });
});
