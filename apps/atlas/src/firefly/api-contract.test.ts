import { describe, expect, it, vi } from 'vitest';
import { atlasApi, parseAsset, parseBootstrap, parseDocument, parseProject, uploadLocalAsset } from './api';
import { createEmptyDocument } from './model';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
});
const wireProject = (overrides: Record<string, unknown> = {}) => ({
  id: 'project-1', title: '片场', revision: 3, hasCheckpoint: true,
  createdAt: 1_700_000_000_000, updatedAt: 1_700_000_001_000, ...overrides,
});

describe('Atlas HTTP contract', () => {
  it('validates bootstrap, project and asset wire shapes', () => {
    expect(parseBootstrap({
      user: { id: 'u1', name: '九久', email: 'u@dokuai.tv', avatarUrl: '/avatar' },
      capabilities: { agent: true, maxUploadBytes: 8_000, partSize: 16, uploadConcurrency: 3 },
    })).toMatchObject({ user: { id: 'u1', avatarUrl: '/avatar' }, capabilities: { agent: true, partSize: 16 } });
    expect(parseProject(wireProject()).hasCheckpoint).toBe(true);
    expect(parseAsset({
      id: 'asset-1', projectId: 'project-1', sourceType: 'local_upload', kind: 'video',
      fileName: 'take.mp4', contentType: 'video/mp4', size: 99, status: 'ready', mediaUrl: '/media',
    })).toMatchObject({ id: 'asset-1', name: 'take.mp4', mimeType: 'video/mp4', source: 'firefly' });
    expect(() => parseProject({ id: 'broken' })).toThrow(/项目名称/);
  });

  it('uses {items}, expectedRevision and lease token/takeover exactly', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/projects') && !init?.method) return json({ items: [wireProject()] });
      if (url.endsWith('/projects/project-1') && init?.method === 'PUT') return json(wireProject({ title: '新片名' }));
      if (url.endsWith('/lease') && init?.method === 'POST') return json({ token: 'x'.repeat(43), deviceId: 'device-12345678', expiresAt: 1_700_000_050_000 }, 201);
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await atlasApi.listProjects()).toHaveLength(1);
    await atlasApi.renameProject('project-1', '新片名', 3);
    await atlasApi.acquireLease('project-1', 'device-12345678', true);

    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ title: '新片名', expectedRevision: 3 });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ deviceId: 'device-12345678', takeover: true });
  });

  it('reports a partial Firefly library instead of disguising transport failure as an empty library', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).startsWith('/api/assets')
      ? json({ error: 'assets unavailable' }, 503)
      : json({ items: [{ id: 'generation-1', status: 'succeeded', title: '片段', videoUrl: '/api/generations/generation-1/media' }] })));
    await expect(atlasApi.listLibrary()).resolves.toMatchObject({
      partial: true,
      items: [{ id: 'generation-1', kind: 'video', sourceType: 'generation' }],
    });
  });

  it('surfaces a total Firefly library outage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'temporarily unavailable' }, 503)));
    await expect(atlasApi.listLibrary()).rejects.toMatchObject({ status: 503 });
  });

  it('submits the strict semantic Agent snapshot', async () => {
    const document = createEmptyDocument('project-1', '片场', 3);
    let agentRequest: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      agentRequest = init;
      return json({
        id: 'run-1', projectId: 'project-1', status: 'queued', instruction: '切割片段', baseRevision: 3,
        catalogVersion: '1', catalogDigest: 'a'.repeat(64), createdAt: 1, updatedAt: 1,
      }, 202);
    });
    vi.stubGlobal('fetch', fetchMock);

    const run = await atlasApi.createAgentRun('project-1', '切割片段', document, 'intent-stable-1');
    expect(run.id).toBe('run-1');
    const body = JSON.parse(String(agentRequest?.body));
    expect(body).toMatchObject({ instruction: '切割片段', baseRevision: 3, snapshot: { version: 1, revision: 3, durationMs: 0, selection: { clipIds: [], trackIds: [] } } });
    expect(body.idempotencyKey).toBe('intent-stable-1');
    expect(body.snapshot.tracks[0]).toHaveProperty('clipIds');
    expect(body).not.toHaveProperty('expectedRevision');
    expect(body).not.toHaveProperty('timelineSnapshot');
  });

  it('uses approved confirmation and one strict operation receipt per request', async () => {
    const calls: RequestInit[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      if (String(input).endsWith('/confirm')) return json({
        id: 'run-1', projectId: 'project-1', status: 'ready', instruction: '导出', baseRevision: 3,
        catalogVersion: '1', catalogDigest: 'a'.repeat(64), createdAt: 1, updatedAt: 2,
      });
      return json({ duplicate: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    const leaseToken = 'l'.repeat(43);
    await atlasApi.confirmAgentRun('project-1', 'run-1', true, leaseToken);
    await atlasApi.reportAgentResult('project-1', 'run-1', {
      sequence: 1, planDigest: 'p'.repeat(64), status: 'succeeded', result: { changed: true },
      beforeRevision: 3, afterRevision: 4, historyNodeId: 'history-1',
    }, leaseToken);
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ approved: true, leaseToken });
    expect(JSON.parse(String(calls[1]?.body))).toEqual({
      sequence: 1, planDigest: 'p'.repeat(64), status: 'succeeded', result: { changed: true },
      beforeRevision: 3, afterRevision: 4, historyNodeId: 'history-1', leaseToken,
    });
  });

  it('uploads a gzip checkpoint using SHA-256 and completes the same reservation', async () => {
    if (typeof CompressionStream === 'undefined' || !crypto.subtle) return;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/checkpoints')) return json({
        checkpointId: 'checkpoint-1', revision: 4,
        transfer: { id: 'transfer-1', partSize: 16 * 1024 * 1024 }, completedParts: [],
        parts: [{ partNumber: 1, url: 'https://tos.example/part-1' }],
      }, 201);
      if (url === 'https://tos.example/part-1') return new Response('', { status: 200, headers: { ETag: '"etag-1"' } });
      if (url.endsWith('/checkpoints/checkpoint-1/complete')) return json({ checkpointId: 'checkpoint-1', revision: 4, status: 'ready' });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const document = createEmptyDocument('project-1', '片场', 3);

    await expect(atlasApi.saveCheckpoint('project-1', document, 3, 't'.repeat(43))).resolves.toEqual({ revision: 4 });
    const reservation = JSON.parse(String(calls[0]?.init?.body));
    expect(reservation).toMatchObject({ expectedRevision: 3, leaseToken: 't'.repeat(43) });
    expect(reservation.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(reservation.size).toBeGreaterThan(0);
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ leaseToken: 't'.repeat(43), parts: [{ partNumber: 1, etag: 'etag-1' }] });
  });

  it('rejects a checkpoint from a different project', () => {
    expect(() => parseDocument(createEmptyDocument('project-a', 'A'), 'project-b')).toThrow(/归属/);
  });

  it('retries multipart completion with the same transfer after a lost response', async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; body: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body) });
      if (calls.length === 1) throw new TypeError('connection reset after commit');
      return json({
        id: 'asset-export', projectId: 'project-1', sourceType: 'export', kind: 'video',
        fileName: 'result.mp4', contentType: 'video/mp4', size: 8_000_000, status: 'ready', mediaUrl: '/media',
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const completion = atlasApi.completeExportTransfer('project-1', 'upload-stable', [{ partNumber: 1, etag: 'etag-1' }], 8_000_000);
    await vi.advanceTimersByTimeAsync(1_100);
    await expect(completion).resolves.toMatchObject({ id: 'asset-export', status: 'ready' });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    vi.useRealTimers();
  });

  it('retries export initialization with one stable user-intent key', async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; body: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body) });
      if (calls.length === 1) throw new TypeError('response lost after reservation');
      return json({ uploadId: 'transfer-stable', partSize: 16 * 1024 * 1024, completedParts: [], parts: [] }, 201);
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = atlasApi.createExportTransfer('project-1', 'export-intent-stable');
    await vi.advanceTimersByTimeAsync(1_100);
    await expect(pending).resolves.toMatchObject({ uploadId: 'transfer-stable' });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ idempotencyKey: 'export-intent-stable', purpose: 'export' });
    vi.useRealTimers();
  });

  it('retries local upload initialization without allocating a second intent', async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
      if (url.endsWith('/uploads') && calls.filter((call) => call.url.endsWith('/uploads')).length === 1) {
        throw new TypeError('response lost after reservation');
      }
      if (url.endsWith('/uploads')) return json({
        uploadId: 'transfer-stable', partSize: 16, completedParts: [],
        parts: [{ partNumber: 1, url: 'https://tos.example/upload-part-1' }],
      }, 201);
      if (url === 'https://tos.example/upload-part-1') return new Response('', { status: 200, headers: { ETag: '"etag-1"' } });
      if (url.endsWith('/uploads/transfer-stable/complete')) return json({
        id: 'asset-1', projectId: 'project-1', sourceType: 'local_upload', kind: 'image',
        fileName: 'reference.png', contentType: 'image/png', size: 3, status: 'ready', mediaUrl: '/media',
      });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const file = new File([new Uint8Array([1, 2, 3])], 'reference.png', { type: 'image/png' });

    const pending = uploadLocalAsset('project-1', file, 'image', vi.fn(), undefined, 'upload-intent-stable');
    await vi.advanceTimersByTimeAsync(1_100);
    await expect(pending).resolves.toMatchObject({ id: 'asset-1', status: 'ready' });
    const initializationCalls = calls.filter((call) => call.url.endsWith('/uploads'));
    expect(initializationCalls).toHaveLength(2);
    expect(initializationCalls[0]).toEqual(initializationCalls[1]);
    expect(JSON.parse(initializationCalls[0]!.body!)).toMatchObject({ idempotencyKey: 'upload-intent-stable', purpose: 'asset' });
    vi.useRealTimers();
  });

  it('retries signed PUT network failures with bounded backoff', async () => {
    vi.useFakeTimers();
    let putAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/uploads')) return json({
        uploadId: 'transfer-retry', partSize: 16, completedParts: [],
        parts: [{ partNumber: 1, url: 'https://tos.example/retry-part' }],
      }, 201);
      if (url === 'https://tos.example/retry-part') {
        putAttempts += 1;
        if (putAttempts < 4) throw new TypeError('temporary network failure');
        return new Response('', { status: 200, headers: { ETag: '"etag-retry"' } });
      }
      if (url.endsWith('/uploads/transfer-retry/complete')) return json({
        id: 'asset-retry', projectId: 'project-1', sourceType: 'local_upload', kind: 'image',
        fileName: 'retry.png', contentType: 'image/png', size: 3, status: 'ready', mediaUrl: '/media',
      });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const pending = uploadLocalAsset('project-1', new File([new Uint8Array([1, 2, 3])], 'retry.png', { type: 'image/png' }), 'image', vi.fn());
    await vi.advanceTimersByTimeAsync(7_100);
    await expect(pending).resolves.toMatchObject({ id: 'asset-retry' });
    expect(putAttempts).toBe(4);
    vi.useRealTimers();
  });

  it('does not apply the old 30 second timeout to upload completion', async () => {
    vi.useFakeTimers();
    let completionSignal: AbortSignal | null | undefined;
    let resolveCompletion!: (response: Response) => void;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      completionSignal = init?.signal;
      return new Promise<Response>((resolve) => { resolveCompletion = resolve; });
    });
    vi.stubGlobal('fetch', fetchMock);
    const pending = atlasApi.completeExportTransfer('project-1', 'transfer-long', [{ partNumber: 1, etag: 'etag-1' }], 8_000_000);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(completionSignal?.aborted).toBe(false);
    resolveCompletion(json({
      id: 'asset-long', projectId: 'project-1', sourceType: 'export', kind: 'video',
      fileName: 'result.mp4', contentType: 'video/mp4', size: 8_000_000, status: 'ready', mediaUrl: '/media',
    }));
    await expect(pending).resolves.toMatchObject({ id: 'asset-long' });
    vi.useRealTimers();
  });
});
