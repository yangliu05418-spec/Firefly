import type {
  AtlasAgentLedger,
  AtlasAgentOperationResult,
  AtlasAgentPlan,
  AtlasDocument,
} from './model';
import { applyAgentOperations, validateAgentPlan } from './timeline';

export interface PreparedAgentExecution {
  nextDocument: AtlasDocument;
  ledger: AtlasAgentLedger;
}

/**
 * Produces the complete atomic browser transaction without mutating editor
 * state. A semantic mismatch fails closed even when the cloud revision has not
 * changed yet (for example while a 5-second checkpoint debounce is pending).
 */
export function prepareAgentExecution(input: {
  document: AtlasDocument;
  plan: AtlasAgentPlan;
  submittedSemanticFingerprint: string;
  currentSemanticFingerprint: string;
  runId: string;
  idempotencyKey: string;
  historyNodeId: string;
}): PreparedAgentExecution | null {
  const { document, plan } = input;
  if (input.submittedSemanticFingerprint !== input.currentSemanticFingerprint) return null;
  if (!validateAgentPlan(plan)) return null;

  const editingOperations = plan.operations.filter((operation) => operation.tool !== 'request_export');
  // A plan is applied exactly once from its base revision. Crash recovery uses
  // the durable ledger and must never re-run this pure transformation against
  // an already advanced document.
  if (document.revision !== plan.baseRevision) return null;

  const nextDocument = applyAgentOperations(document, plan.operations);
  if (!nextDocument) return null;
  const pendingReceipts: AtlasAgentOperationResult[] = [];
  let priorEditApplied = false;
  for (const operation of editingOperations) {
    pendingReceipts.push({
      sequence: operation.sequence,
      planDigest: plan.planDigest,
      status: 'succeeded',
      result: { changed: true, operationKey: operation.operationKey },
      beforeRevision: plan.baseRevision + (priorEditApplied ? 1 : 0),
      afterRevision: plan.baseRevision + 1,
      historyNodeId: input.historyNodeId,
    });
    priorEditApplied = true;
  }
  const exportOperation = plan.operations.find((operation) => operation.tool === 'request_export');
  const exportRevision = plan.baseRevision + (editingOperations.length ? 1 : 0);
  const now = new Date().toISOString();
  return {
    nextDocument,
    ledger: {
      id: `${document.projectId}:${input.runId}:${plan.planDigest}`,
      projectId: document.projectId,
      runId: input.runId,
      planDigest: plan.planDigest,
      idempotencyKey: input.idempotencyKey,
      semanticFingerprint: input.submittedSemanticFingerprint,
      status: exportOperation ? 'awaiting_export' : 'applied',
      pendingReceipts,
      pendingExport: exportOperation ? { sequence: exportOperation.sequence, revision: exportRevision } : undefined,
      updatedAt: now,
    },
  };
}

export function exportReceipt(
  ledger: AtlasAgentLedger,
  status: 'succeeded' | 'failed',
  result: unknown,
): AtlasAgentOperationResult | null {
  if (!ledger.pendingExport) return null;
  return {
    sequence: ledger.pendingExport.sequence,
    planDigest: ledger.planDigest,
    status,
    result,
    beforeRevision: ledger.pendingExport.revision,
    afterRevision: ledger.pendingExport.revision,
  };
}
