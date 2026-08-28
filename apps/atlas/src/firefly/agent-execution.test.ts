import { describe, expect, it } from 'vitest';
import { exportReceipt, prepareAgentExecution } from './agent-execution';
import { agentSemanticFingerprint } from './api';
import { createEmptyDocument, type AtlasAgentOperation, type AtlasAgentPlan, type AtlasAsset } from './model';
import { ATLAS_AGENT_CATALOG_DIGEST, createEditorHistory, editorReducer } from './timeline';

const asset: AtlasAsset = {
  id: 'asset-1', name: 'take.mp4', kind: 'video', mimeType: 'video/mp4', size: 10,
  duration: 10, status: 'ready', source: 'firefly', mediaUrl: '/media',
};
const operation = (sequence: number, tool: string, args: Record<string, unknown>): AtlasAgentOperation => ({
  sequence, tool, args,
  risk: tool === 'request_export' ? 'external' : tool === 'delete_clip' ? 'destructive' : tool === 'insert_project_asset' ? 'medium' : 'low',
  requiresConfirmation: tool === 'request_export' || tool === 'delete_clip',
  operationKey: `run-1:${sequence}`, operationDigest: `${sequence}`.repeat(64).slice(0, 64),
});
const plan = (operations: AtlasAgentOperation[]): AtlasAgentPlan => ({
  version: 1, summary: '整理并导出', catalogVersion: '1', catalogDigest: ATLAS_AGENT_CATALOG_DIGEST,
  baseRevision: 7, operations, planDigest: 'a'.repeat(64),
});

function timeline() {
  let history = createEditorHistory(createEmptyDocument('project-1', '片场', 7));
  history = editorReducer(history, { type: 'add-assets', assets: [asset] });
  history = editorReducer(history, { type: 'add-clip', assetId: asset.id });
  return { ...history.present, revision: 7 };
}

describe('Agent browser transaction', () => {
  it('ignores checkpoint-only revisions but detects timeline edits', async () => {
    const document = timeline();
    const original = await agentSemanticFingerprint(document);
    expect(await agentSemanticFingerprint({ ...document, revision: document.revision + 1 })).toBe(original);
    expect(await agentSemanticFingerprint({ ...document, clips: document.clips.map((clip) => ({ ...clip, volume: 0.4 })) })).not.toBe(original);
  });

  it('rejects a stale semantic plan even when cloud revision is unchanged', () => {
    const document = timeline();
    const prepared = prepareAgentExecution({
      document,
      plan: plan([operation(1, 'split_clip', { clipId: document.clips[0]!.id, atMs: 2_000 })]),
      submittedSemanticFingerprint: 'before', currentSemanticFingerprint: 'after',
      runId: 'run-1', idempotencyKey: 'intent-1', historyNodeId: 'history-1',
    });
    expect(prepared).toBeNull();
  });

  it('rejects a checkpoint revision that advanced while the provider was planning', () => {
    const document = timeline();
    const prepared = prepareAgentExecution({
      document: { ...document, revision: 8 },
      plan: plan([operation(1, 'split_clip', { clipId: document.clips[0]!.id, atMs: 2_000 })]),
      submittedSemanticFingerprint: 'same', currentSemanticFingerprint: 'same',
      runId: 'run-1', idempotencyKey: 'intent-1', historyNodeId: 'history-1',
    });
    expect(prepared).toBeNull();
  });

  it('advances one cloud revision for the whole edit plan and defers export success', () => {
    const document = timeline();
    const prepared = prepareAgentExecution({
      document,
      plan: plan([
        operation(1, 'split_clip', { clipId: document.clips[0]!.id, atMs: 2_000 }),
        operation(2, 'set_clip_volume', { clipId: document.clips[0]!.id, volume: 2 }),
        operation(3, 'request_export', { preset: 'mp4_h264_aac_1080p30' }),
      ]),
      submittedSemanticFingerprint: 'same', currentSemanticFingerprint: 'same',
      runId: 'run-1', idempotencyKey: 'intent-1', historyNodeId: 'history-1',
    });
    expect(prepared).not.toBeNull();
    expect(prepared!.ledger.pendingReceipts.map((receipt) => [receipt.beforeRevision, receipt.afterRevision])).toEqual([[7, 8], [8, 8]]);
    expect(prepared!.ledger.pendingReceipts.every((receipt) => receipt.historyNodeId === 'history-1')).toBe(true);
    expect(prepared!.ledger.pendingExport).toEqual({ sequence: 3, revision: 8 });
    expect(exportReceipt(prepared!.ledger, 'succeeded', { status: 'ready', assetId: 'export-1' })).toMatchObject({
      sequence: 3, beforeRevision: 8, afterRevision: 8, result: { status: 'ready', assetId: 'export-1' },
    });
  });

  it('commits the exact preflight document as one undo transaction', () => {
    const document = timeline();
    const prepared = prepareAgentExecution({
      document,
      plan: plan([operation(1, 'split_clip', { clipId: document.clips[0]!.id, atMs: 2_000 })]),
      submittedSemanticFingerprint: 'same', currentSemanticFingerprint: 'same',
      runId: 'run-1', idempotencyKey: 'intent-1', historyNodeId: 'history-1',
    })!;
    const committed = editorReducer(createEditorHistory(document), { type: 'commit-agent-document', document: prepared.nextDocument });
    expect(committed.present).toBe(prepared.nextDocument);
    expect(committed.present.clips).toHaveLength(2);
    expect(editorReducer(committed, { type: 'undo' }).present.clips).toHaveLength(1);
  });
});
