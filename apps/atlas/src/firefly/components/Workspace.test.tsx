import { IDBFactory } from 'fake-indexeddb';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, atlasApi } from '../api';
import { I18nProvider } from '../i18n';
import { createEmptyDocument, type AtlasBootstrap } from '../model';
import { loadLocalProject } from '../storage';
import { retryLeaseRequest, Workspace } from './Workspace';

const bootstrap: AtlasBootstrap = {
  user: { id: 'user-1', name: '用户', email: 'user@dokuai.tv' },
  capabilities: { agent: false, maxUploadBytes: 1024, partSize: 16, uploadConcurrency: 3 },
};

describe('Workspace durability and lease recovery', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 204 })));
  });

  it('flushes the current reducer snapshot before returning within the debounce window', async () => {
    vi.spyOn(atlasApi, 'acquireLease').mockResolvedValue({ token: 't'.repeat(43), deviceId: 'device-12345678', expiresAt: Date.now() + 45_000 });
    const onBack = vi.fn();
    render(
      <I18nProvider locale="zh-CN">
        <Workspace bootstrap={bootstrap} initialDocument={createEmptyDocument('project-1', '原标题', 0)} onBack={onBack} onProjectUpdated={vi.fn()} onOpenProject={vi.fn()} />
      </I18nProvider>,
    );
    const title = screen.getByRole('textbox', { name: /重命名项目/ }) as HTMLInputElement;
    await waitFor(() => expect(title.readOnly).toBe(false));
    fireEvent.change(title, { target: { value: '立即返回也不会丢失' } });
    fireEvent.click(screen.getByRole('button', { name: /全部项目/ }));
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    expect((await loadLocalProject('user-1', 'project-1'))?.title).toBe('立即返回也不会丢失');
  });

  it('retries transient lease failures but never retries a deterministic conflict', async () => {
    const transient = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockRejectedValueOnce(new ApiError('busy', 503))
      .mockResolvedValue('lease');
    const waits: number[] = [];
    await expect(retryLeaseRequest(transient, { wait: async (delay) => { waits.push(delay); } })).resolves.toBe('lease');
    expect(transient).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([250, 500]);

    const conflict = vi.fn().mockRejectedValue(new ApiError('locked', 409));
    await expect(retryLeaseRequest(conflict, { wait: async () => undefined })).rejects.toMatchObject({ status: 409 });
    expect(conflict).toHaveBeenCalledTimes(1);
  });
});
