import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtlasAgentLedger } from './model';
import { createEmptyDocument } from './model';
import {
  atlasDatabaseName,
  commitAgentExecution,
  enforceAtlasStorageQuota,
  getOrCreateAgentIntent,
  listPendingAgentLedgers,
  loadLocalProject,
  loadLocalBlob,
  saveAgentLedger,
  saveLocalBlob,
  saveLocalProject,
} from './storage';

describe('user-isolated Agent recovery storage', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
  });

  it('reuses an idempotency key only for the exact same pending intent', async () => {
    const first = await getOrCreateAgentIntent('user-a', 'project-1', '切割第一段', 'semantic-a');
    const retry = await getOrCreateAgentIntent('user-a', 'project-1', '切割第一段', 'semantic-a');
    const changed = await getOrCreateAgentIntent('user-a', 'project-1', '切割第二段', 'semantic-a');
    const otherUser = await getOrCreateAgentIntent('user-b', 'project-1', '切割第一段', 'semantic-a');

    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(changed.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(otherUser.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(atlasDatabaseName('user-a')).not.toBe(atlasDatabaseName('user-b'));
  });

  it('atomically persists the applied document and pending receipt ledger', async () => {
    const document = { ...createEmptyDocument('project-1', '片场', 4), updatedAt: new Date().toISOString() };
    const ledger: AtlasAgentLedger = {
      id: 'project-1:run-1:plan-1', projectId: 'project-1', runId: 'run-1', planDigest: 'p'.repeat(64),
      idempotencyKey: 'intent-1', semanticFingerprint: 's'.repeat(64), status: 'applied',
      pendingReceipts: [{
        sequence: 1, planDigest: 'p'.repeat(64), status: 'succeeded', result: { changed: true },
        beforeRevision: 3, afterRevision: 4, historyNodeId: 'history-1',
      }],
      updatedAt: new Date().toISOString(),
    };
    await commitAgentExecution('user-a', document, ledger);

    expect((await loadLocalProject('user-a', 'project-1'))?.revision).toBe(4);
    expect(await loadLocalProject('user-b', 'project-1')).toBeNull();
    expect(await listPendingAgentLedgers('user-a', 'project-1')).toEqual([ledger]);

    await saveAgentLedger('user-a', { ...ledger, status: 'reported', pendingReceipts: [] });
    expect(await listPendingAgentLedgers('user-a', 'project-1')).toEqual([]);
  });

  it('evicts only durable cloud-backed media when the current user cache exceeds quota', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: vi.fn(async () => ({ usage: 90, quota: 100 })) } });
    const document = createEmptyDocument('project-1', '片场');
    document.assets = [
      { id: 'ready', name: 'ready.mp4', kind: 'video', mimeType: 'video/mp4', size: 40, duration: 1, status: 'ready', source: 'local', mediaUrl: '/stable-media' },
      { id: 'pending', name: 'pending.mp4', kind: 'video', mimeType: 'video/mp4', size: 40, duration: 1, status: 'uploading', source: 'local' },
    ];
    await saveLocalProject('user-a', document);
    await saveLocalBlob('user-a', 'ready', new Blob([new Uint8Array(40)]));
    await saveLocalBlob('user-a', 'pending', new Blob([new Uint8Array(40)]));

    await expect(enforceAtlasStorageQuota('user-a')).resolves.toEqual({ removed: 1, bytes: 40 });
    expect(await loadLocalBlob('user-a', 'ready')).toBeNull();
    expect(await loadLocalBlob('user-a', 'pending')).not.toBeNull();
  });
});
