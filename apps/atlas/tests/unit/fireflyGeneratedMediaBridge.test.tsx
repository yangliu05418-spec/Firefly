import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ register: vi.fn() }));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: { getState: () => ({ registerFireflyRemoteAsset: mocks.register }) },
}));

import { FireflyEmbeddingProvider } from '../../src/firefly/FireflyEmbeddingContext';
import { FireflyGeneratedMediaBridge, FIREFLY_ATLAS_MEDIA_REFRESH_EVENT } from '../../src/firefly/FireflyGeneratedMediaBridge';

const embedding = {
  user: { id: 'user-1', name: '九久', email: 'jiujiu@dokuai.tv' },
  projectId: 'project-1',
  capabilities: { agent: true, generate: true },
  onBackToProjects: vi.fn(),
};

describe('Firefly generated media bridge', () => {
  beforeEach(() => {
    mocks.register.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('paginates ready assets and delegates duplicate suppression to the original media store', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `asset-${index}`, fileName: `素材-${index}.mp4`, kind: 'video', size: 8_000_000,
      status: 'ready', mediaUrl: `/api/atlas/project-assets/asset-${index}/media`,
    }));
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/local-media/config') return new Response(JSON.stringify({ enabled: true, atlas: true }), { status: 200 });
      if (url.includes('offset=0')) return new Response(JSON.stringify({ items: firstPage }), { status: 200 });
      if (url.includes('offset=100')) return new Response(JSON.stringify({ items: [
        { id: 'asset-100', fileName: '成片.png', kind: 'image', size: 2_000, status: 'ready', mediaUrl: '/api/atlas/project-assets/asset-100/media' },
        { id: 'asset-copying', fileName: '处理中.mp4', kind: 'video', size: 1, status: 'copying' },
      ] }), { status: 200 });
      throw new Error(`unexpected ${url}`);
    });

    render(<FireflyEmbeddingProvider value={embedding}><FireflyGeneratedMediaBridge /></FireflyEmbeddingProvider>);
    await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(101));
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      id: 'asset-100', kind: 'image', mediaUrl: '/api/atlas/project-assets/asset-100/media',
    }));

    act(() => window.dispatchEvent(new Event(FIREFLY_ATLAS_MEDIA_REFRESH_EVENT)));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(202));
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
});
