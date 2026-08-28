import { IDBFactory } from 'fake-indexeddb';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { atlasApi } from '../api';
import { I18nProvider } from '../i18n';
import { createEmptyDocument, type AtlasAgentPlan, type AtlasAsset } from '../model';
import { ATLAS_AGENT_CATALOG_DIGEST } from '../timeline';
import { AgentPanel } from './AgentPanel';

const asset: AtlasAsset = {
  id: 'asset-1', name: 'take.mp4', kind: 'video', mimeType: 'video/mp4', size: 10,
  duration: 10, status: 'ready', source: 'firefly', mediaUrl: '/media',
};

describe('AgentPanel atomic apply', () => {
  beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));

  it('runs a final semantic CAS after confirmation and never commits a delayed competing edit', async () => {
    const base = createEmptyDocument('project-1', '片场', 7);
    const document = {
      ...base,
      assets: [asset],
      clips: [{
        id: 'clip-1', assetId: asset.id, trackId: base.tracks[0]!.id, name: asset.name,
        startTime: 0, duration: 10, inPoint: 0, outPoint: 10, volume: 1, muted: false,
        transitionIn: 'none' as const,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      }],
    };
    const plan: AtlasAgentPlan = {
      version: 1, summary: '删除片段', catalogVersion: '1', catalogDigest: ATLAS_AGENT_CATALOG_DIGEST,
      baseRevision: 7,
      operations: [{
        sequence: 1, tool: 'delete_clip', args: { clipId: 'clip-1' }, risk: 'destructive', requiresConfirmation: true,
        operationKey: 'run-1:1', operationDigest: 'a'.repeat(64),
      }],
      planDigest: 'b'.repeat(64),
    };
    vi.spyOn(atlasApi, 'createAgentRun').mockResolvedValue({
      id: 'run-1', projectId: 'project-1', status: 'awaiting_confirmation', instruction: '删除片段',
      baseRevision: 7, catalogVersion: '1', catalogDigest: ATLAS_AGENT_CATALOG_DIGEST, plan,
      createdAt: 1, updatedAt: 1,
    });
    let resolveConfirmation!: () => void;
    vi.spyOn(atlasApi, 'confirmAgentRun').mockImplementation(async () => {
      await new Promise<void>((resolve) => { resolveConfirmation = resolve; });
      return {
        id: 'run-1', projectId: 'project-1', status: 'ready', instruction: '删除片段', baseRevision: 7,
        catalogVersion: '1', catalogDigest: ATLAS_AGENT_CATALOG_DIGEST, plan, createdAt: 1, updatedAt: 2,
      };
    });
    const dispatch = vi.fn();
    const endMutationLock = vi.fn();
    let current = document;
    render(
      <I18nProvider locale="zh-CN">
        <AgentPanel
          userId="user-1" document={document} dispatch={dispatch} enabled
          beginMutationLock={async () => ({ document: current, leaseToken: 'l'.repeat(43) })}
          validateMutationLock={() => ({ document: current, leaseToken: 'l'.repeat(43) })}
          endMutationLock={endMutationLock}
          getLeaseToken={() => 'l'.repeat(43)}
          onRequestExport={vi.fn()}
        />
      </I18nProvider>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), '删除片段');
    await user.click(screen.getByRole('button', { name: /生成编辑方案/ }));
    await user.click(await screen.findByRole('button', { name: /确认并应用/ }));
    await waitFor(() => expect(atlasApi.confirmAgentRun).toHaveBeenCalled());
    current = { ...document, clips: document.clips.map((clip) => ({ ...clip, volume: 0.5 })) };
    resolveConfirmation();

    await screen.findByText(/方案生成期间时间线已发生变化/);
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'commit-agent-document' }));
    await waitFor(() => expect(endMutationLock).toHaveBeenCalledTimes(1));
  });
});
