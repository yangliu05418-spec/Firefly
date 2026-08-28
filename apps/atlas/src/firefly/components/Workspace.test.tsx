import { IDBFactory } from 'fake-indexeddb';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, atlasApi } from '../api';
import { I18nProvider } from '../i18n';
import { createEmptyDocument, type AtlasBootstrap } from '../model';
import { loadLocalProject } from '../storage';
import { consumeFreshLeaseHandoff, getLeaseHandoffKey, getLeaseSessionKey, retryLeaseRequest, Workspace } from './Workspace';

const bootstrap: AtlasBootstrap = {
  user: { id: 'user-1', name: '用户', email: 'user@dokuai.tv' },
  capabilities: { agent: false, maxUploadBytes: 1024, partSize: 16, uploadConcurrency: 3 },
};

describe('Workspace durability and lease recovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 204 })));
  });

  it('renews the same tab lease after reload instead of reporting a second editor', async () => {
    const lease = { token: 'r'.repeat(43), deviceId: 'device-12345678', expiresAt: Date.now() + 45_000 };
    const acquire = vi.spyOn(atlasApi, 'acquireLease').mockResolvedValue(lease);
    const renew = vi.spyOn(atlasApi, 'renewLease').mockResolvedValue({ ...lease, expiresAt: Date.now() + 60_000 });
    const first = render(
      <I18nProvider locale="zh-CN">
        <Workspace bootstrap={bootstrap} initialDocument={createEmptyDocument('project-reload', '刷新恢复', 2)} onBack={vi.fn()} onProjectUpdated={vi.fn()} onOpenProject={vi.fn()} />
      </I18nProvider>,
    );
    await waitFor(() => expect((screen.getByRole('textbox', { name: /重命名项目/ }) as HTMLInputElement).readOnly).toBe(false));
    fireEvent(window, new PageTransitionEvent('pagehide'));
    first.unmount();

    render(
      <I18nProvider locale="zh-CN">
        <Workspace bootstrap={bootstrap} initialDocument={createEmptyDocument('project-reload', '刷新恢复', 2)} onBack={vi.fn()} onProjectUpdated={vi.fn()} onOpenProject={vi.fn()} />
      </I18nProvider>,
    );
    await waitFor(() => expect(renew).toHaveBeenCalledWith('project-reload', lease.token));
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByRole('textbox', { name: /重命名项目/ }) as HTMLInputElement).readOnly).toBe(false);
  });

  it('accepts a slow 16-second bootstrap while the saved server lease is still recoverable', () => {
    const now = Date.now();
    const key = getLeaseHandoffKey('user-1', 'slow-project');
    sessionStorage.setItem(key, JSON.stringify({ createdAt: now - 16_000 }));
    expect(consumeFreshLeaseHandoff(key, now)).toBe(true);
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it('retains the reload token through transient renew failures and never self-acquires', async () => {
    const now = Date.now();
    const token = 'n'.repeat(43);
    sessionStorage.setItem(getLeaseSessionKey('user-1', 'project-network'), token);
    sessionStorage.setItem(getLeaseHandoffKey('user-1', 'project-network'), JSON.stringify({ createdAt: now }));
    const acquire = vi.spyOn(atlasApi, 'acquireLease').mockRejectedValue(new ApiError('locked', 409));
    const renew = vi.spyOn(atlasApi, 'renewLease')
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockRejectedValueOnce(new ApiError('unavailable', 503))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue({ token, deviceId: 'device-12345678', expiresAt: now + 60_000 });
    render(
      <I18nProvider locale="zh-CN">
        <Workspace bootstrap={bootstrap} initialDocument={createEmptyDocument('project-network', '网络恢复', 1)} onBack={vi.fn()} onProjectUpdated={vi.fn()} onOpenProject={vi.fn()} />
      </I18nProvider>,
    );
    await waitFor(() => expect(renew).toHaveBeenCalledTimes(3));
    expect(sessionStorage.getItem(getLeaseSessionKey('user-1', 'project-network'))).toBe(token);
    expect(acquire).not.toHaveBeenCalled();
    vi.spyOn(Date, 'now').mockReturnValue(now + 120_000);
    fireEvent(window, new Event('online'));
    await waitFor(() => expect(renew).toHaveBeenCalledTimes(4));
    expect(acquire).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: /重命名项目/ }) as HTMLInputElement).readOnly).toBe(false);
  });

  it('hands a still-pending renew across another reload', async () => {
    const token = 'p'.repeat(43);
    sessionStorage.setItem(getLeaseSessionKey('user-1', 'project-pending'), token);
    sessionStorage.setItem(getLeaseHandoffKey('user-1', 'project-pending'), JSON.stringify({ createdAt: Date.now() }));
    const acquire = vi.spyOn(atlasApi, 'acquireLease').mockRejectedValue(new ApiError('locked', 409));
    const renew = vi.spyOn(atlasApi, 'renewLease')
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue({ token, deviceId: 'device-12345678', expiresAt: Date.now() + 45_000 });
    const first = render(
      <I18nProvider locale="zh-CN"><Workspace bootstrap={bootstrap} initialDocument={createEmptyDocument('project-pending', '待恢复', 1)} onBack={vi.fn()} onProjectUpdated={vi.fn()} onOpenProject={vi.fn()} /></I18nProvider>,
    );
    await waitFor(() => expect(renew).toHaveBeenCalledTimes(3));
    fireEvent(window, new PageTransitionEvent('pagehide'));
    first.unmount();
    render(
      <I18nProvider locale="zh-CN"><Workspace bootstrap={bootstrap} initialDocument={createEmptyDocument('project-pending', '待恢复', 1)} onBack={vi.fn()} onProjectUpdated={vi.fn()} onOpenProject={vi.fn()} /></I18nProvider>,
    );
    await waitFor(() => expect(renew).toHaveBeenCalledTimes(4));
    expect(acquire).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: /重命名项目/ }) as HTMLInputElement).readOnly).toBe(false);
  });

  it('releases a pending token on an ordinary SPA unmount', async () => {
    const token = 'u'.repeat(43);
    sessionStorage.setItem(getLeaseSessionKey('user-1', 'project-unmount'), token);
    sessionStorage.setItem(getLeaseHandoffKey('user-1', 'project-unmount'), JSON.stringify({ createdAt: Date.now() }));
    vi.spyOn(atlasApi, 'renewLease').mockRejectedValue(new TypeError('offline'));
    const view = render(
      <I18nProvider locale="zh-CN"><Workspace bootstrap={bootstrap} initialDocument={createEmptyDocument('project-unmount', '普通退出', 1)} onBack={vi.fn()} onProjectUpdated={vi.fn()} onOpenProject={vi.fn()} /></I18nProvider>,
    );
    await waitFor(() => expect(atlasApi.renewLease).toHaveBeenCalledTimes(3));
    view.unmount();
    expect(sessionStorage.getItem(getLeaseSessionKey('user-1', 'project-unmount'))).toBeNull();
    const request = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).includes('/project-unmount/lease') && init?.method === 'DELETE');
    expect(request).toBeDefined();
    expect(request?.[1]?.body).toBe(JSON.stringify({ token }));
  });

  it.each([
    ['reacquires after an expired BFCache lease', false],
    ['stays read-only when another editor wins after BFCache expiry', true],
  ] as const)('%s', async (_label, anotherEditor) => {
    const firstLease = { token: 'b'.repeat(43), deviceId: 'device-12345678', expiresAt: Date.now() + 45_000 };
    const replacement = { token: 'c'.repeat(43), deviceId: 'device-12345678', expiresAt: Date.now() + 90_000 };
    const acquire = vi.spyOn(atlasApi, 'acquireLease').mockResolvedValueOnce(firstLease);
    if (anotherEditor) acquire.mockRejectedValueOnce(new ApiError('locked', 409));
    else acquire.mockResolvedValueOnce(replacement);
    vi.spyOn(atlasApi, 'renewLease').mockRejectedValue(new ApiError('lost', 409));
    render(
      <I18nProvider locale="zh-CN"><Workspace bootstrap={bootstrap} initialDocument={createEmptyDocument('project-bfcache', '缓存恢复', 1)} onBack={vi.fn()} onProjectUpdated={vi.fn()} onOpenProject={vi.fn()} /></I18nProvider>,
    );
    await waitFor(() => expect((screen.getByRole('textbox', { name: /重命名项目/ }) as HTMLInputElement).readOnly).toBe(false));
    fireEvent(window, new PageTransitionEvent('pageshow', { persisted: true }));
    await waitFor(() => expect(acquire).toHaveBeenCalledTimes(2));
    const title = screen.getByRole('textbox', { name: /重命名项目/ }) as HTMLInputElement;
    if (anotherEditor) {
      await waitFor(() => expect(screen.getByRole('dialog')).not.toBeNull());
      expect(title.readOnly).toBe(true);
    } else {
      await waitFor(() => expect(title.readOnly).toBe(false));
      expect(screen.queryByRole('dialog')).toBeNull();
    }
  });

  it('keeps a duplicated tab read-only when sessionStorage copied a token without a reload handoff', async () => {
    vi.spyOn(atlasApi, 'acquireLease')
      .mockResolvedValueOnce({ token: 'a'.repeat(43), deviceId: 'tab-a-device', expiresAt: Date.now() + 45_000 })
      .mockRejectedValueOnce(new ApiError('locked', 409, 'ATLAS_PROJECT_LOCKED'));
    render(
      <I18nProvider locale="zh-CN">
        <Workspace bootstrap={bootstrap} initialDocument={createEmptyDocument('project-tabs', '标签隔离', 1)} onBack={vi.fn()} onProjectUpdated={vi.fn()} onOpenProject={vi.fn()} />
      </I18nProvider>,
    );
    await waitFor(() => expect((screen.getByRole('textbox', { name: /重命名项目/ }) as HTMLInputElement).readOnly).toBe(false));

    // Chrome can clone sessionStorage into a duplicated tab. The token alone
    // is not proof of continuity; without pagehide's one-shot handoff this
    // instance must acquire normally and receive the server-side conflict.
    render(
      <I18nProvider locale="zh-CN">
        <Workspace bootstrap={bootstrap} initialDocument={createEmptyDocument('project-tabs', '标签隔离', 1)} onBack={vi.fn()} onProjectUpdated={vi.fn()} onOpenProject={vi.fn()} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByRole('dialog')).not.toBeNull());
    const titles = screen.getAllByRole('textbox', { name: /重命名项目/ }) as HTMLInputElement[];
    expect(titles.at(-1)?.readOnly).toBe(true);
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
