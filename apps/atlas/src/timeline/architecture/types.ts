export const timelineArchitectureGateStatuses = [
  'active',
  'satisfied',
  'retired',
] as const;

export type TimelineArchitectureGateStatus =
  (typeof timelineArchitectureGateStatuses)[number];

export type TimelineRefactorPhase = 'P1' | 'P2' | 'P3' | 'P4' | 'P5';

export interface TimelineArchitectureGate {
  id: string;
  phase: TimelineRefactorPhase;
  title: string;
  status: TimelineArchitectureGateStatus;
  retiredByGate?: string;
  dependsOn?: readonly string[];
}

export type TimelineRefactorLaneStatus = 'active' | 'planned' | 'done';

export interface TimelineRefactorLane {
  id: string;
  name: string;
  owner: string;
  status: TimelineRefactorLaneStatus;
  writeSet: readonly string[];
  forbiddenWriteSet: readonly string[];
  exitGates: readonly string[];
  activeUntilGate?: string;
}

export interface TimelineHighConflictOwnership {
  path: string;
  laneId: string;
}

export interface TimelineAdapterDebtEntry {
  id: string;
  ownerLane: string;
  introducedPhase: TimelineRefactorPhase;
  writeSet: readonly string[];
  deleteBy: string;
  activeUntilGate?: string;
  acceptanceTests: readonly string[];
  note: string;
}

export type TimelineRetiredPathClassification =
  | 'delete now'
  | 'delete at gate'
  | 'move to importer'
  | 'keep';

export interface TimelineRetiredPathEntry {
  id: string;
  path: string;
  classification: TimelineRetiredPathClassification;
  ownerLane: string;
  deleteBy?: string;
  importerOwner?: string;
  keepReason?: string;
  replacementGate?: string;
  note: string;
}

export type TimelineTestMigrationClassification =
  | 'port'
  | 'replace'
  | 'split'
  | 'delete'
  | 'keep';

export interface TimelineTestMigrationEntry {
  path: string;
  classification: TimelineTestMigrationClassification;
  ownerLane: string;
  replacementGate: string;
  note: string;
}

export interface TimelineExitCriteriaEvidence {
  kind: 'test' | 'source' | 'handoff' | 'manual-check';
  path: string;
  note: string;
}

export interface TimelineExitCriteriaCoverage {
  gateId: string;
  criteria: readonly string[];
  evidence: readonly TimelineExitCriteriaEvidence[];
}
