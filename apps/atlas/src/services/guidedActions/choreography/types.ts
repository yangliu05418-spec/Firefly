import type { GuidedAction, GuidedToolCall } from '../types';

export interface GuidedToolChoreographyContext {
  batchDepth: number;
  includeValidation: boolean;
}

export type GuidedToolChoreography = (
  toolCall: GuidedToolCall,
  context: GuidedToolChoreographyContext,
) => GuidedAction[];
