import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFireflyProjectApi,
  FireflyProjectApiError,
  parseFireflyBootstrap,
  parseFireflyLease,
  parseFireflyProject,
} from '../projectApi';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
});

const projectWire = (overrides: Record<string, unknown> = {}) => ({
  id: 'project-1',
  title: '品牌片',
  revision: 3,
  hasCheckpoint: true,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
  ...overrides,
});

afterEach(() => vi.restoreAllMocks());

describe('Firefly project control-plane API', () => {
  it('runtime-validates bootstrap, project and token-preserving renew responses', () => {
    expect(parseFireflyBootstrap({
      user: { id: 'user-1', name: '九久', email: 'jiujiu@dokuai.tv', avatarUrl: '/avatar' },
      capabilities: { agent: true, maxUploadBytes: 8_000, partSize: 16, uploadConcurrency: 3 },
    })).toMatchObject({ user: { id: 'user-1', name: '九久' }, capabilities: { agent: true, partSize: 16 } });

    expect(parseFireflyProject(projectWire())).toMatchObject({ id: 'project-1', revision: 3, hasCheckpoint: true });
    expect(parseFireflyLease({ deviceId: 'browser-tab-a', expiresAt: 1_700_000_045_000 }, 't'.repeat(43)))
      .toEqual({ token: 't'.repeat(43), deviceId: 'browser-tab-a', expiresAt: 1_700_000_045_000 });

    expect(() => parseFireflyProject(projectWire({ revision: 1.5 }))).toThrow(/项目版本/);
    expect(() => parseFireflyBootstrap({ user: { id: 'u' }, capabilities: { agent: 'yes' } })).toThrow(/Agent能力/);
    expect(() => parseFireflyLease({ deviceId: 'tab', expiresAt: 1 })).toThrow(/令牌/);
  });

  it('uses only relative same-origin endpoints and the exact project contract', async () => {
    const leaseToken = 'l'.repeat(43);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      if (path === '/api/atlas/bootstrap') return json({
        user: { id: 'user-1', name: '九久', email: 'jiujiu@dokuai.tv' },
        capabilities: { agent: true, maxUploadBytes: 8_000, partSize: 16, uploadConcurrency: 3 },
      });
      if (path === '/api/atlas/projects?limit=25&offset=50') return json({ items: [projectWire()] });
      if (path === '/api/atlas/projects' && method === 'POST') return json(projectWire(), 201);
      if (path === '/api/atlas/projects/project-1' && method === 'GET') return json(projectWire());
      if (path === '/api/atlas/projects/project-1' && method === 'PUT') return json(projectWire({ title: '新版品牌片' }));
      if (path === '/api/atlas/projects/project-1' && method === 'DELETE') return new Response(null, { status: 204 });
      if (path.endsWith('/lease') && method === 'POST') return json({ token: leaseToken, deviceId: 'browser-tab-a', expiresAt: 1_700_000_045_000 }, 201);
      if (path.endsWith('/lease') && method === 'PUT') return json({ deviceId: 'browser-tab-a', expiresAt: 1_700_000_060_000 });
      if (path.endsWith('/lease') && method === 'DELETE') return new Response(null, { status: 204 });
      throw new Error(`Unexpected request ${method} ${path}`);
    });
    const api = createFireflyProjectApi(fetcher);

    await api.bootstrap();
    await api.listProjects({ limit: 25, offset: 50 });
    await api.createProject(' 品牌片 ');
    await api.getProject('project-1');
    await api.renameProject('project-1', '新版品牌片', 3);
    await api.deleteProject('project-1');
    await api.acquireLease('project-1', 'browser-tab-a', true);
    await expect(api.renewLease('project-1', leaseToken)).resolves.toMatchObject({ token: leaseToken });
    await api.releaseLease('project-1', leaseToken, { keepalive: true });

    for (const [path, init] of fetcher.mock.calls) {
      expect(String(path)).toMatch(/^\/api\/atlas\//);
      expect(init?.credentials).toBe('same-origin');
      expect(init?.cache).toBe('no-store');
      expect(new Headers(init?.headers).get('Accept')).toBe('application/json');
    }
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({ title: '品牌片' });
    expect(JSON.parse(String(fetcher.mock.calls[4]?.[1]?.body))).toEqual({ title: '新版品牌片', expectedRevision: 3 });
    expect(JSON.parse(String(fetcher.mock.calls[6]?.[1]?.body))).toEqual({ deviceId: 'browser-tab-a', takeover: true });
    expect(fetcher.mock.calls[8]?.[1]?.keepalive).toBe(true);
  });

  it('preserves structured server failures and rejects malformed success payloads', async () => {
    const locked = createFireflyProjectApi(vi.fn(async () => json({
      error: '项目正在另一窗口编辑',
      code: 'ATLAS_PROJECT_LOCKED',
      deviceId: 'other-tab',
      expiresAt: 1_700_000_045_000,
    }, 409)));
    await expect(locked.acquireLease('project-1', 'browser-tab-a')).rejects.toMatchObject({
      status: 409,
      code: 'ATLAS_PROJECT_LOCKED',
      details: { deviceId: 'other-tab' },
    });

    const malformed = createFireflyProjectApi(vi.fn(async () => json({ items: [{ id: 'broken' }] })));
    await expect(malformed.listProjects()).rejects.toMatchObject({
      status: 502,
      code: 'ATLAS_RESPONSE_INVALID',
    });
  });

  it('rejects invalid input before issuing a network request', async () => {
    const fetcher = vi.fn(async () => json({}));
    const api = createFireflyProjectApi(fetcher);

    await expect(api.createProject(' '.repeat(3))).rejects.toBeInstanceOf(FireflyProjectApiError);
    await expect(api.renameProject('project-1', 'name', -1)).rejects.toMatchObject({ code: 'ATLAS_REVISION_INVALID' });
    await expect(api.acquireLease('project-1', 'short')).rejects.toMatchObject({ code: 'ATLAS_DEVICE_ID_INVALID' });
    await expect(api.renewLease('project-1', 'short')).rejects.toMatchObject({ code: 'ATLAS_LEASE_TOKEN_INVALID' });
    await expect(api.listProjects({ limit: 101 })).rejects.toMatchObject({ code: 'ATLAS_PAGINATION_INVALID' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
