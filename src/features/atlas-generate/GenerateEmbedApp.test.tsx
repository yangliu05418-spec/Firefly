// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('../../api', () => ({ api: mocks }));
vi.mock('../../asset-cache-context', () => ({ AssetCacheScope: ({ children }: { children: ReactNode }) => children }));
vi.mock('../composer/Composer', () => ({ Composer: () => <div>共享生成输入</div> }));

import { GenerateEmbedApp } from './GenerateEmbedApp';

describe('Atlas generation embed delivery recovery', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    window.history.replaceState({}, '', '/studio/generate-embed/?projectId=project-1');
    mocks.get.mockImplementation((path: string) => {
      if (path === '/api/auth/session') return Promise.resolve({ authenticated: true, user: { id: 'user-1', name: '九久', email: 'jiujiu@dokuai.tv' } });
      if (path === '/api/models') return Promise.resolve([{ id: 'model-1', name: 'Seedance', modes: ['text'] }]);
      if (path === '/api/generation-capacity') return Promise.resolve({ active: 0, limit: 4, available: 4 });
      if (path.includes('/generation-destinations')) return Promise.resolve({ items: [{ id: 'destination-1', sourceType: 'video', sourceId: 'task-1', status: 'failed', errorCode: 'TOS_COPY_FAILED' }] });
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    mocks.post.mockImplementation((path: string) => {
      if (path.endsWith('/generation-session')) return Promise.resolve({ sessionId: 'session-1' });
      if (path.endsWith('/retry')) return Promise.resolve({ status: 'pending' });
      return Promise.reject(new Error(`unexpected POST ${path}`));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  it('retries only project import and clearly states that generation is not repeated', async () => {
    await act(async () => { root.render(<GenerateEmbedApp />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain('共享生成输入');
    expect(container.textContent).toContain('重试不会重新生成或产生费用');

    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === '重试加入素材库');
    expect(retry).toBeTruthy();
    await act(async () => { retry!.click(); await Promise.resolve(); });
    expect(mocks.post).toHaveBeenCalledWith(
      '/api/atlas/projects/project-1/generation-destinations/destination-1/retry',
      {},
      { timeoutMs: 8000 },
    );
    expect(mocks.post.mock.calls.filter(([path]) => String(path).endsWith('/retry'))).toHaveLength(1);
  });
});
