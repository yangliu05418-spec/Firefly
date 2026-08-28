import type { AudioDynamicsReductionSnapshot } from '../../../types/audio';
import type { AudioRouteProcessorNode } from './routeGraphTypes';

export function normalizeDynamicsReductionDb(rawReduction: number): number {
  if (!Number.isFinite(rawReduction)) return 0;
  const reduction = rawReduction < 0 ? -rawReduction : rawReduction;
  return Math.max(0, Math.min(60, reduction));
}

export function getRouteDynamicsSnapshot(
  route: { processorNodes: AudioRouteProcessorNode[] },
  updatedAt: number,
): Record<string, AudioDynamicsReductionSnapshot> | undefined {
  const dynamics: Record<string, AudioDynamicsReductionSnapshot> = {};

  for (const processor of route.processorNodes) {
    if ((processor.type === 'compressor' || processor.type === 'de-esser') && processor.compressor) {
      dynamics[processor.id] = {
        effectId: processor.id,
        processorType: processor.type,
        gainReductionDb: normalizeDynamicsReductionDb(processor.compressor.reduction),
        updatedAt,
      };
      continue;
    }

    if (
      (
        processor.type === 'limiter' ||
        processor.type === 'noise-gate' ||
        processor.type === 'expander' ||
        processor.type === 'dynamic-eq-band'
      ) &&
      processor.scriptProcessor
    ) {
      dynamics[processor.id] = {
        effectId: processor.id,
        processorType: processor.type,
        gainReductionDb: normalizeDynamicsReductionDb(processor.gainReductionDb ?? 0),
        updatedAt,
      };
    }
  }

  return Object.keys(dynamics).length > 0 ? dynamics : undefined;
}
