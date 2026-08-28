import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FireflyProjectLeaseController,
  FIREFLY_PROJECT_LEASE_RENEW_INTERVAL_MS,
  useFireflyProjectLease,
} from '../useFireflyProjectLease';
import {
  FireflyProjectApiError,
  type FireflyProjectApi,
  type FireflyProjectLease,
} from '../projectApi';

const START_TIME = 1_700_000_000_000;
const TOKEN = 't'.repeat(43);

const lease = (token = TOKEN): FireflyProjectLease => ({
  token,
  deviceId: 'browser-tab-a',
  expiresAt: Date.now() + 45_000,
});

const createApi = (overrides: Partial<FireflyProjectApi> = {}): FireflyProjectApi => ({
  bootstrap: vi.fn(async () => ({
    user: { id: 'user-1', name: '九久', email: 'jiujiu@dokuai.tv' },
    capabilities: { agent: true, maxUploadBytes: 8_000, partSize: 16, uploadConcurrency: 3 },
  })),
  listProjects: vi.fn(async () => []),
  createProject: vi.fn(async () => { throw new Error('not used'); }),
  getProject: vi.fn(async () => { throw new Error('not used'); }),
  renameProject: vi.fn(async () => { throw new Error('not used'); }),
  deleteProject: vi.fn(async () => undefined),
  acquireLease: vi.fn(async () => lease()),
  renewLease: vi.fn(async (_projectId, token) => lease(token)),
  releaseLease: vi.fn(async () => undefined),
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START_TIME);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Firefly project lease controller', () => {
  it('acquires for 45 seconds and renews every 15 seconds while publishing the current token', async () => {
    const onTokenChange = vi.fn();
    const api = createApi();
    const controller = new FireflyProjectLeaseController({
      projectId: 'project-1',
      deviceId: 'browser-tab-a',
      api,
      onTokenChange,
    });

    await controller.start();
    expect(controller.getSnapshot()).toMatchObject({ status: 'active', lost: false, readOnly: false });
    expect(onTokenChange).toHaveBeenLastCalledWith(TOKEN, expect.objectContaining({ expiresAt: START_TIME + 45_000 }));

    await vi.advanceTimersByTimeAsync(FIREFLY_PROJECT_LEASE_RENEW_INTERVAL_MS);
    expect(api.renewLease).toHaveBeenCalledTimes(1);
    expect(api.renewLease).toHaveBeenCalledWith('project-1', TOKEN, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(controller.getSnapshot()).toMatchObject({ status: 'active', lease: { expiresAt: START_TIME + 60_000 } });
    expect(onTokenChange).toHaveBeenCalledTimes(2);
  });

  it('exposes a definitive lost state and clears the token after renewal is rejected', async () => {
    const onTokenChange = vi.fn();
    const onLost = vi.fn();
    const api = createApi({
      renewLease: vi.fn(async () => {
        throw new FireflyProjectApiError('编辑租约已失效', 409, 'ATLAS_LEASE_LOST');
      }),
    });
    const controller = new FireflyProjectLeaseController({
      projectId: 'project-1',
      deviceId: 'browser-tab-a',
      api,
      onTokenChange,
      onLost,
    });

    await controller.start();
    await vi.advanceTimersByTimeAsync(FIREFLY_PROJECT_LEASE_RENEW_INTERVAL_MS);

    expect(controller.getSnapshot()).toMatchObject({ status: 'lost', lost: true, readOnly: true });
    expect(onTokenChange).toHaveBeenLastCalledWith(null);
    expect(onLost).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('keeps editing during a transient renewal failure and recovers on bounded retry', async () => {
    const renewLease = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockImplementation(async (_projectId: string, token: string) => lease(token));
    const controller = new FireflyProjectLeaseController({
      projectId: 'project-1',
      deviceId: 'browser-tab-a',
      api: createApi({ renewLease }),
    });

    await controller.start();
    await vi.advanceTimersByTimeAsync(FIREFLY_PROJECT_LEASE_RENEW_INTERVAL_MS);
    expect(controller.getSnapshot()).toMatchObject({ status: 'degraded', lost: false, readOnly: false });

    await vi.advanceTimersByTimeAsync(3_000);
    expect(renewLease).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toMatchObject({ status: 'active', lost: false, readOnly: false });
  });

  it('distinguishes an occupied project and can explicitly take it over', async () => {
    const acquireLease = vi.fn()
      .mockRejectedValueOnce(new FireflyProjectApiError('项目正在另一窗口编辑', 409, 'ATLAS_PROJECT_LOCKED'))
      .mockImplementationOnce(async () => lease());
    const controller = new FireflyProjectLeaseController({
      projectId: 'project-1',
      deviceId: 'browser-tab-a',
      api: createApi({ acquireLease }),
    });

    await controller.start();
    expect(controller.getSnapshot().status).toBe('locked');
    await controller.takeover();
    expect(acquireLease).toHaveBeenNthCalledWith(2, 'project-1', 'browser-tab-a', true, expect.anything());
    expect(controller.getSnapshot().status).toBe('active');
  });

  it('resumes the same tab after refresh without issuing a second acquire', async () => {
    const onTokenChange = vi.fn();
    const api = createApi();
    const controller = new FireflyProjectLeaseController({
      projectId: 'project-1',
      deviceId: 'browser-tab-a',
      api,
      onTokenChange,
    });

    await controller.resume(TOKEN);

    expect(api.renewLease).toHaveBeenCalledWith('project-1', TOKEN, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(api.acquireLease).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ status: 'active', lease: { token: TOKEN } });
    expect(onTokenChange).toHaveBeenLastCalledWith(TOKEN, expect.objectContaining({ token: TOKEN }));
  });

  it('does not auto-takeover when a persisted refresh token has been lost', async () => {
    const renewLease = vi.fn(async () => {
      throw new FireflyProjectApiError('编辑租约已失效', 409, 'ATLAS_LEASE_LOST');
    });
    const acquireLease = vi.fn(async () => lease());
    const controller = new FireflyProjectLeaseController({
      projectId: 'project-1',
      deviceId: 'browser-tab-a',
      api: createApi({ renewLease, acquireLease }),
    });

    await controller.resume(TOKEN);
    expect(controller.getSnapshot()).toMatchObject({ status: 'lost', lost: true, readOnly: true });
    expect(acquireLease).not.toHaveBeenCalled();

    await controller.start();
    expect(acquireLease).toHaveBeenCalledWith('project-1', 'browser-tab-a', false, expect.anything());
    expect(controller.getSnapshot().status).toBe('active');
  });

  it('makes stop and release terminal and idempotent', async () => {
    const onTokenChange = vi.fn();
    const releaseLease = vi.fn(async () => undefined);
    const controller = new FireflyProjectLeaseController({
      projectId: 'project-1',
      deviceId: 'browser-tab-a',
      api: createApi({ releaseLease }),
      onTokenChange,
    });

    await controller.start();
    controller.stop();
    controller.stop();
    await Promise.all([controller.release(), controller.release()]);

    expect(releaseLease).toHaveBeenCalledTimes(1);
    expect(releaseLease).toHaveBeenCalledWith('project-1', TOKEN, { keepalive: true });
    expect(onTokenChange.mock.calls).toEqual([
      [TOKEN, expect.objectContaining({ token: TOKEN })],
      [null],
    ]);
    expect(controller.getSnapshot()).toMatchObject({ status: 'stopped', readOnly: true });
    await expect(controller.start()).resolves.toBeUndefined();
  });
});

describe('useFireflyProjectLease', () => {
  it('starts on mount, releases once on unmount and forwards renewed tokens', async () => {
    vi.useRealTimers();
    const onTokenChange = vi.fn();
    const releaseLease = vi.fn(async () => undefined);
    const api = createApi({ releaseLease });
    const rendered = renderHook(() => useFireflyProjectLease({
      projectId: 'project-1',
      deviceId: 'browser-tab-a',
      api,
      onTokenChange,
    }));

    await waitFor(() => expect(rendered.result.current.status).toBe('active'));
    act(() => rendered.unmount());
    await waitFor(() => expect(releaseLease).toHaveBeenCalledTimes(1));
    expect(onTokenChange).toHaveBeenLastCalledWith(null);
  });
});
