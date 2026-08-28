import type { TimelineStore } from '../types';
import type { ApplyTimelineEditOperationOptions } from './types';

export type TimelineEditOperationSet = (
  partial: Partial<TimelineStore> | ((state: TimelineStore) => Partial<TimelineStore>)
) => void;

export interface TimelineEditOperationApplyContext {
  set: TimelineEditOperationSet;
  get: () => TimelineStore;
  options: ApplyTimelineEditOperationOptions;
}
