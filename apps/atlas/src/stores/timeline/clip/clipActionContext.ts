import type { TimelineStore } from '../types';

export type ClipActionSet = (
  partial: Partial<TimelineStore> | ((state: TimelineStore) => Partial<TimelineStore>)
) => void;

export interface ClipActionContext {
  set: ClipActionSet;
  get: () => TimelineStore;
}
