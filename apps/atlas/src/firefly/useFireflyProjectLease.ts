import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  FireflyProjectApiError,
  fireflyProjectApi,
  type FireflyProjectApi,
  type FireflyProjectLease,
} from './projectApi';

export const FIREFLY_PROJECT_LEASE_TTL_MS = 45_000;
export const FIREFLY_PROJECT_LEASE_RENEW_INTERVAL_MS = 15_000;

const TRANSIENT_RETRY_MS = 3_000;
const MIN_RENEW_HEADROOM_MS = 5_000;

export type FireflyProjectLeaseStatus =
  | 'idle'
  | 'acquiring'
  | 'active'
  | 'degraded'
  | 'locked'
  | 'lost'
  | 'error'
  | 'releasing'
  | 'stopped';

export interface FireflyProjectLeaseSnapshot {
  status: FireflyProjectLeaseStatus;
  lease?: FireflyProjectLease;
  error?: Error;
  lost: boolean;
  readOnly: boolean;
}

interface FireflyProjectLeaseControllerOptions {
  projectId: string;
  deviceId: string;
  api?: FireflyProjectApi;
  now?: () => number;
  onTokenChange?: (token: string | null, lease?: FireflyProjectLease) => void;
  onLost?: (error: Error) => void;
}

type Subscriber = () => void;

const initialSnapshot = (): FireflyProjectLeaseSnapshot => ({
  status: 'idle',
  lost: false,
  readOnly: true,
});

const normalizeError = (error: unknown): Error =>
  error instanceof Error ? error : new Error('编辑租约请求失败');

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError';

const isLockedError = (error: unknown) =>
  error instanceof FireflyProjectApiError
  && error.status === 409
  && error.code === 'ATLAS_PROJECT_LOCKED';

const isDefinitiveLeaseLoss = (error: unknown) =>
  error instanceof FireflyProjectApiError
  && error.status >= 400
  && error.status < 500
  && error.status !== 408
  && error.status !== 429;

/**
 * Project-scoped lease lifecycle independent from Atlas' editor stores.
 *
 * A controller is single-use: create one per project/tab lifecycle. `stop` and
 * `release` are terminal and idempotent so an unmount cannot accidentally
 * reacquire a project after releasing it.
 */
export class FireflyProjectLeaseController {
  private readonly projectId: string;
  private readonly deviceId: string;
  private readonly api: FireflyProjectApi;
  private readonly now: () => number;
  private readonly onTokenChange?: FireflyProjectLeaseControllerOptions['onTokenChange'];
  private readonly onLost?: FireflyProjectLeaseControllerOptions['onLost'];
  private readonly subscribers = new Set<Subscriber>();

  private snapshot: FireflyProjectLeaseSnapshot = initialSnapshot();
  private heldLease?: FireflyProjectLease;
  private renewTimer?: ReturnType<typeof globalThis.setTimeout>;
  private expiryTimer?: ReturnType<typeof globalThis.setTimeout>;
  private acquireAbort?: AbortController;
  private renewAbort?: AbortController;
  private acquirePromise?: Promise<FireflyProjectLease | undefined>;
  private renewPromise?: Promise<FireflyProjectLease | undefined>;
  private releasePromise?: Promise<void>;
  private generation = 0;
  private terminal = false;
  private lossNotified = false;

  constructor(options: FireflyProjectLeaseControllerOptions) {
    this.projectId = options.projectId;
    this.deviceId = options.deviceId;
    this.api = options.api ?? fireflyProjectApi;
    this.now = options.now ?? Date.now;
    this.onTokenChange = options.onTokenChange;
    this.onLost = options.onLost;
  }

  readonly getSnapshot = (): FireflyProjectLeaseSnapshot => this.snapshot;

  readonly subscribe = (subscriber: Subscriber): (() => void) => {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  };

  start(takeover = false): Promise<FireflyProjectLease | undefined> {
    if (this.terminal) return Promise.resolve(undefined);
    if (this.snapshot.status === 'active' || this.snapshot.status === 'degraded') {
      return Promise.resolve(this.heldLease);
    }
    if (this.acquirePromise) return this.acquirePromise;

    const generation = ++this.generation;
    this.acquireAbort?.abort();
    const abort = new AbortController();
    this.acquireAbort = abort;
    this.update({ status: 'acquiring', lease: undefined, error: undefined, lost: false, readOnly: true });

    const pending = this.api.acquireLease(this.projectId, this.deviceId, takeover, { signal: abort.signal })
      .then((lease) => {
        if (this.terminal || generation !== this.generation) return undefined;
        this.adoptLease(lease);
        return lease;
      })
      .catch((error: unknown) => {
        if (this.terminal || generation !== this.generation || isAbortError(error)) return undefined;
        const normalized = normalizeError(error);
        if (isLockedError(error)) {
          this.update({ status: 'locked', lease: undefined, error: normalized, lost: false, readOnly: true });
        } else {
          this.update({ status: 'error', lease: undefined, error: normalized, lost: false, readOnly: true });
        }
        return undefined;
      })
      .finally(() => {
        if (this.acquirePromise === pending) this.acquirePromise = undefined;
        if (this.acquireAbort === abort) this.acquireAbort = undefined;
      });
    this.acquirePromise = pending;
    return pending;
  }

  /**
   * Reclaims the same tab's server lease after a browser refresh. The server
   * deliberately rejects a second acquire while the old 45-second lease is
   * alive, so a persisted per-tab token must be renewed before acquiring.
   */
  resume(token: string): Promise<FireflyProjectLease | undefined> {
    if (this.terminal) return Promise.resolve(undefined);
    if (this.snapshot.status === 'active' || this.snapshot.status === 'degraded') {
      return Promise.resolve(this.heldLease);
    }
    if (this.acquirePromise) return this.acquirePromise;

    const generation = ++this.generation;
    this.acquireAbort?.abort();
    const abort = new AbortController();
    this.acquireAbort = abort;
    this.update({ status: 'acquiring', lease: undefined, error: undefined, lost: false, readOnly: true });

    const pending = this.api.renewLease(this.projectId, token, { signal: abort.signal })
      .then((renewed) => {
        if (this.terminal || generation !== this.generation) return undefined;
        this.adoptLease(renewed);
        return renewed;
      })
      .catch((error: unknown) => {
        if (this.terminal || generation !== this.generation || isAbortError(error)) return undefined;
        const normalized = normalizeError(error);
        if (isDefinitiveLeaseLoss(error)) {
          // The caller may now perform a normal acquire. Never escalate a
          // stale refresh token into an implicit takeover.
          this.markLost(normalized);
        } else {
          this.update({ status: 'error', lease: undefined, error: normalized, lost: false, readOnly: true });
        }
        return undefined;
      })
      .finally(() => {
        if (this.acquirePromise === pending) this.acquirePromise = undefined;
        if (this.acquireAbort === abort) this.acquireAbort = undefined;
      });
    this.acquirePromise = pending;
    return pending;
  }

  takeover(): Promise<FireflyProjectLease | undefined> {
    return this.start(true);
  }

  renewNow(): Promise<FireflyProjectLease | undefined> {
    if (this.terminal || !this.heldLease) return Promise.resolve(undefined);
    if (this.renewPromise) return this.renewPromise;

    this.clearRenewTimer();
    const leaseAtStart = this.heldLease;
    const generation = this.generation;
    const abort = new AbortController();
    this.renewAbort = abort;

    const pending = this.api.renewLease(this.projectId, leaseAtStart.token, { signal: abort.signal })
      .then((lease) => {
        if (this.terminal || generation !== this.generation || this.heldLease?.token !== leaseAtStart.token) {
          return undefined;
        }
        this.adoptLease(lease);
        return lease;
      })
      .catch((error: unknown) => {
        if (this.terminal || generation !== this.generation || isAbortError(error)) return undefined;
        const normalized = normalizeError(error);
        if (isDefinitiveLeaseLoss(error) || this.now() >= leaseAtStart.expiresAt) {
          this.markLost(normalized);
        } else {
          this.update({
            status: 'degraded',
            lease: this.heldLease,
            error: normalized,
            lost: false,
            readOnly: false,
          });
          this.scheduleRenew(TRANSIENT_RETRY_MS);
        }
        return undefined;
      })
      .finally(() => {
        if (this.renewPromise === pending) this.renewPromise = undefined;
        if (this.renewAbort === abort) this.renewAbort = undefined;
      });
    this.renewPromise = pending;
    return pending;
  }

  stop(): void {
    if (this.terminal) return;
    this.terminal = true;
    this.generation += 1;
    this.cancelWork();
    const hadToken = Boolean(this.heldLease);
    this.update({ status: 'stopped', lease: undefined, error: undefined, lost: false, readOnly: true });
    if (hadToken) this.notifyToken(null);
  }

  release(): Promise<void> {
    if (this.releasePromise) return this.releasePromise;

    const lease = this.heldLease;
    const tokenWasExposed = this.snapshot.status !== 'stopped';
    if (!this.terminal) {
      this.terminal = true;
      this.generation += 1;
      this.cancelWork();
    }
    if (lease && tokenWasExposed) this.notifyToken(null);
    this.update({
      status: lease ? 'releasing' : 'stopped',
      lease: undefined,
      error: undefined,
      lost: false,
      readOnly: true,
    });

    const pending = lease
      ? this.api.releaseLease(this.projectId, lease.token, { keepalive: true })
          .catch((error: unknown) => {
            // Release is best-effort; the server-side lease expires after 45s.
            // Keep the error observable without making React cleanup reject.
            this.update({ ...this.snapshot, error: normalizeError(error) });
          })
          .then(() => undefined)
      : Promise.resolve();

    this.releasePromise = pending.finally(() => {
      this.heldLease = undefined;
      this.update({ ...this.snapshot, status: 'stopped', lease: undefined, lost: false, readOnly: true });
    });
    return this.releasePromise;
  }

  private adoptLease(lease: FireflyProjectLease): void {
    if (lease.expiresAt <= this.now()) {
      this.markLost(new FireflyProjectApiError('编辑租约已过期', 409, 'ATLAS_LEASE_LOST'));
      return;
    }
    this.heldLease = lease;
    this.lossNotified = false;
    this.update({ status: 'active', lease, error: undefined, lost: false, readOnly: false });
    this.notifyToken(lease.token, lease);
    this.scheduleExpiry(lease);

    const remaining = lease.expiresAt - this.now();
    const renewDelay = Math.min(
      FIREFLY_PROJECT_LEASE_RENEW_INTERVAL_MS,
      Math.max(1_000, remaining - MIN_RENEW_HEADROOM_MS),
    );
    this.scheduleRenew(renewDelay);
  }

  private scheduleRenew(delayMs: number): void {
    this.clearRenewTimer();
    if (this.terminal || !this.heldLease) return;
    this.renewTimer = globalThis.setTimeout(() => {
      this.renewTimer = undefined;
      void this.renewNow();
    }, delayMs);
  }

  private scheduleExpiry(lease: FireflyProjectLease): void {
    if (this.expiryTimer !== undefined) globalThis.clearTimeout(this.expiryTimer);
    this.expiryTimer = globalThis.setTimeout(() => {
      this.expiryTimer = undefined;
      if (!this.terminal && this.heldLease?.token === lease.token && this.now() >= lease.expiresAt) {
        this.markLost(new FireflyProjectApiError('编辑租约已失效，请重新接管项目', 409, 'ATLAS_LEASE_LOST'));
      }
    }, Math.max(0, lease.expiresAt - this.now()));
  }

  private markLost(error: Error): void {
    if (this.terminal || this.snapshot.status === 'lost') return;
    this.generation += 1;
    this.cancelWork();
    this.heldLease = undefined;
    this.update({ status: 'lost', lease: undefined, error, lost: true, readOnly: true });
    this.notifyToken(null);
    if (!this.lossNotified) {
      this.lossNotified = true;
      try { this.onLost?.(error); } catch { /* consumer callbacks cannot corrupt the lease */ }
    }
  }

  private cancelWork(): void {
    this.clearRenewTimer();
    if (this.expiryTimer !== undefined) {
      globalThis.clearTimeout(this.expiryTimer);
      this.expiryTimer = undefined;
    }
    this.acquireAbort?.abort();
    this.acquireAbort = undefined;
    this.renewAbort?.abort();
    this.renewAbort = undefined;
  }

  private clearRenewTimer(): void {
    if (this.renewTimer !== undefined) {
      globalThis.clearTimeout(this.renewTimer);
      this.renewTimer = undefined;
    }
  }

  private notifyToken(token: string | null, lease?: FireflyProjectLease): void {
    try {
      if (lease) this.onTokenChange?.(token, lease);
      else this.onTokenChange?.(token);
    } catch { /* consumer callbacks cannot corrupt the lease */ }
  }

  private update(next: FireflyProjectLeaseSnapshot): void {
    this.snapshot = next;
    for (const subscriber of this.subscribers) subscriber();
  }
}

export interface UseFireflyProjectLeaseOptions {
  projectId: string;
  deviceId: string;
  enabled?: boolean;
  takeoverOnStart?: boolean;
  resumeToken?: string;
  api?: FireflyProjectApi;
  onTokenChange?: (token: string | null, lease?: FireflyProjectLease) => void;
  onLost?: (error: Error) => void;
}

export interface UseFireflyProjectLeaseResult extends FireflyProjectLeaseSnapshot {
  retry(): Promise<FireflyProjectLease | undefined>;
  resume(token: string): Promise<FireflyProjectLease | undefined>;
  takeover(): Promise<FireflyProjectLease | undefined>;
  renewNow(): Promise<FireflyProjectLease | undefined>;
  stop(): void;
  release(): Promise<void>;
}

export function useFireflyProjectLease(
  options: UseFireflyProjectLeaseOptions,
): UseFireflyProjectLeaseResult {
  const callbacks = useRef({ onTokenChange: options.onTokenChange, onLost: options.onLost });
  callbacks.current = { onTokenChange: options.onTokenChange, onLost: options.onLost };

  const controller = useMemo(() => new FireflyProjectLeaseController({
    projectId: options.projectId,
    deviceId: options.deviceId,
    api: options.api,
    onTokenChange: (token, lease) => {
      if (lease) callbacks.current.onTokenChange?.(token, lease);
      else callbacks.current.onTokenChange?.(token);
    },
    onLost: (error) => callbacks.current.onLost?.(error),
  }), [options.api, options.deviceId, options.projectId]);

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    if (options.enabled === false) return undefined;

    if (options.resumeToken) void controller.resume(options.resumeToken);
    else void controller.start(options.takeoverOnStart === true);
    const renewOnResume = () => {
      if (controller.getSnapshot().status === 'active' || controller.getSnapshot().status === 'degraded') {
        void controller.renewNow();
      }
    };
    const renewWhenVisible = () => {
      if (document.visibilityState === 'visible') renewOnResume();
    };
    window.addEventListener('online', renewOnResume);
    document.addEventListener('visibilitychange', renewWhenVisible);
    return () => {
      window.removeEventListener('online', renewOnResume);
      document.removeEventListener('visibilitychange', renewWhenVisible);
      void controller.release();
    };
  }, [controller, options.enabled, options.resumeToken, options.takeoverOnStart]);

  const retry = useCallback(() => controller.start(false), [controller]);
  const resume = useCallback((token: string) => controller.resume(token), [controller]);
  const takeover = useCallback(() => controller.takeover(), [controller]);
  const renewNow = useCallback(() => controller.renewNow(), [controller]);
  const stop = useCallback(() => controller.stop(), [controller]);
  const release = useCallback(() => controller.release(), [controller]);

  return { ...snapshot, retry, resume, takeover, renewNow, stop, release };
}
