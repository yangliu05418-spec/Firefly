import type { DetailedStats } from '../../core/types';

export type CollectorState = 'render' | 'hold' | 'drop';

export interface LayerCollectorMutationSink {
  setDecoder(decoder: DetailedStats['decoder']): void;
  setWebCodecsInfo(info: DetailedStats['webCodecsInfo'] | undefined): void;
  markHasVideo(): void;
}
