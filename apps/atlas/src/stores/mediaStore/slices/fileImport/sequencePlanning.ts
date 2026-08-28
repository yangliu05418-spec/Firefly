import {
  groupGaussianSplatSequenceEntries,
  type GroupedGaussianSplatSequence,
} from '../../../../utils/gaussianSplatSequence';
import {
  groupModelSequenceEntries,
  type GroupedModelSequence,
} from '../../../../utils/modelSequence';
import type { ResolvedLegacyImportEntry } from './importPlanning';

export function splitModelSequenceEntries(entries: ResolvedLegacyImportEntry[]): {
  modelSequences: GroupedModelSequence<ResolvedLegacyImportEntry>[];
  gaussianSplatSequences: GroupedGaussianSplatSequence<ResolvedLegacyImportEntry>[];
  singles: ResolvedLegacyImportEntry[];
} {
  const modelEntries = entries.filter((entry) => entry.type === 'model');
  const gaussianSplatEntries = entries.filter((entry) => entry.type === 'gaussian-splat');
  const nonSequenceEntries = entries.filter((entry) => entry.type !== 'model' && entry.type !== 'gaussian-splat');
  const { sequences, singles: ungroupedModels } = groupModelSequenceEntries(modelEntries);
  const {
    sequences: gaussianSplatSequences,
    singles: ungroupedGaussianSplats,
  } = groupGaussianSplatSequenceEntries(gaussianSplatEntries);

  return {
    modelSequences: sequences,
    gaussianSplatSequences,
    singles: [...nonSequenceEntries, ...ungroupedModels, ...ungroupedGaussianSplats],
  };
}
