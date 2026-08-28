import { useSettingsStore } from '../../stores/settingsStore';
import { normalizeGuidedAnimationBudget } from '../guidedActions/scheduler';
import type { GuidedCompressionMode } from '../guidedActions/types';
import type { GuidedReplayBudgetController } from './types';

interface GuidedReplayBudgetControllerOptions {
  compression?: GuidedCompressionMode;
  totalMs?: number;
}

export function createGuidedReplayBudgetController(
  options: GuidedReplayBudgetControllerOptions = {},
): GuidedReplayBudgetController {
  const settings = useSettingsStore.getState();
  const budget = normalizeGuidedAnimationBudget({
    totalMs: options.totalMs ?? settings.guidedActionReplayBudgetMs,
    compression: options.compression ?? settings.guidedActionReplayCompressionMode,
  });
  let remainingMs = budget.totalMs;

  return {
    compression: budget.compression,
    consumeBudgetMs: (plannedMs) => {
      if (!Number.isFinite(plannedMs) || plannedMs <= 0) {
        return;
      }
      remainingMs = Math.max(0, remainingMs - Math.round(plannedMs));
    },
    getRemainingBudgetMs: () => remainingMs,
    reserveBudgetMs: (remainingCallsInGroup = 1) => {
      if (budget.disabled || remainingMs <= 0) {
        return 0;
      }
      const divisor = Math.max(1, Math.round(remainingCallsInGroup));
      return Math.max(0, Math.floor(remainingMs / divisor));
    },
  };
}
