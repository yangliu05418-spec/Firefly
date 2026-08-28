import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  accountWorkerGpuFrameLeaks,
  admitWorkerGpuFrameRequest,
  createWorkerGpuFrameDeliveryToken,
  createWorkerGpuFrameProviderSnapshot,
  createWorkerGpuFrameReleaseToken,
  createWorkerGpuFrameRequest,
  deliverWorkerGpuFrame,
  disposeWorkerGpuFrameProvider,
  markWorkerGpuFrameRequestLate,
  markWorkerGpuFrameResponseStale,
  releaseWorkerGpuFrame,
  requestWorkerGpuFrame,
  selectWorkerGpuFramePlaybackPolicy,
  type WorkerGpuFrameDelivery,
  type WorkerGpuFrameProviderSnapshot,
  type WorkerGpuFrameRequest,
} from '../../src/services/render/workerGpuFrameProviders';

const repoRoot = process.cwd();

function provider(): WorkerGpuFrameProviderSnapshot {
  return createWorkerGpuFrameProviderSnapshot({
    providerId: 'provider-a',
    sourceId: 'source-a',
    sourceKind: 'video',
    generationId: 1,
  });
}

function request(overrides: Partial<WorkerGpuFrameRequest> = {}): WorkerGpuFrameRequest {
  return {
    ...createWorkerGpuFrameRequest({
      requestId: 'request-a',
      providerId: 'provider-a',
      sourceId: 'source-a',
      generationId: 1,
      targetId: 'preview',
      timelineTimeSeconds: 3,
      mediaTimeSeconds: 2,
      requestedAtMs: 10,
      deadlineAtMs: 26,
      compositionFrameNumber: 180,
      maxDriftSeconds: 1 / 120,
    }),
    ...overrides,
  };
}

function delivery(input: {
  readonly requestId?: string;
  readonly generationId?: number;
  readonly deliveredAtMs?: number;
  readonly deadlineAtMs?: number;
  readonly freshness?: WorkerGpuFrameDelivery['freshness'];
  readonly frameId?: string;
  readonly dropReason?: string | null;
} = {}): WorkerGpuFrameDelivery {
  const requestId = input.requestId ?? 'request-a';
  const generationId = input.generationId ?? 1;
  const frameId = input.frameId ?? 'frame-a';
  const deliveredAtMs = input.deliveredAtMs ?? 20;
  const deadlineAtMs = input.deadlineAtMs ?? 26;
  const deliveryToken = input.dropReason === 'miss'
    ? null
    : createWorkerGpuFrameDeliveryToken({
      providerId: 'provider-a',
      sourceId: 'source-a',
      requestId,
      generationId,
      frameId,
      issuedAtMs: deliveredAtMs,
      deadlineAtMs,
    });

  return {
    requestId,
    providerId: 'provider-a',
    sourceId: 'source-a',
    generationId,
    frameId: deliveryToken ? frameId : null,
    mediaTimeSeconds: deliveryToken ? 2 : null,
    frameTimestampSeconds: deliveryToken ? 2 : null,
    deliveredAtMs,
    deadlineAtMs,
    freshness: input.freshness ?? (deliveryToken ? 'exact' : 'missing'),
    resource: deliveryToken
      ? {
        resourceId: 'resource-a',
        kind: 'raster',
        width: 1920,
        height: 1080,
        colorSpace: 'srgb',
      }
      : null,
    deliveryToken,
    releaseToken: deliveryToken ? createWorkerGpuFrameReleaseToken(deliveryToken) : null,
    dropReason: input.dropReason ?? null,
  };
}

describe('worker GPU frame provider contracts', () => {
  it('classifies normal forward playback separately from reverse and faster playback', () => {
    expect(selectWorkerGpuFramePlaybackPolicy({ playbackRate: 1 })).toEqual({
      intent: 'normal-forward',
      direction: 'forward',
      mode: 'nearest',
      priority: 'high',
      allowHold: true,
      sourceTimeOrder: 'monotonic-forward',
    });
    expect(selectWorkerGpuFramePlaybackPolicy({ playbackRate: 2 })).toMatchObject({
      intent: 'faster-forward',
      mode: 'nearest',
      priority: 'critical',
      allowHold: false,
      sourceTimeOrder: 'skip-ok-forward',
    });
    expect(selectWorkerGpuFramePlaybackPolicy({ playbackRate: 1, direction: 'reverse' })).toMatchObject({
      intent: 'reverse',
      direction: 'reverse',
      mode: 'exact',
      priority: 'critical',
      allowHold: false,
      sourceTimeOrder: 'reverse-lookbehind',
    });
  });

  it('keeps provider DTOs serializable and handle-free', () => {
    const source = readFileSync(
      path.join(repoRoot, 'src/services/render/workerGpuFrameProviders.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/\b(?:VideoFrame|ImageBitmap|HTMLVideoElement|GPUDevice|GPUTexture|GPUBuffer|OffscreenCanvas|Blob|File)\b/);

    const initial = provider();
    const nextRequest = request();
    const snapshot = admitWorkerGpuFrameRequest(
      requestWorkerGpuFrame(initial, nextRequest),
      nextRequest.requestId,
      15,
    );

    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot.outstandingRequests).toEqual([expect.objectContaining({
      requestId: 'request-a',
      generationId: 1,
      admitted: true,
    })]);
  });

  it('accounts request, admit, exact delivery, and release lifetimes', () => {
    const nextRequest = request();
    const admitted = admitWorkerGpuFrameRequest(
      requestWorkerGpuFrame(provider(), nextRequest),
      nextRequest.requestId,
      15,
    );
    const delivered = deliverWorkerGpuFrame(admitted, delivery());
    const released = releaseWorkerGpuFrame(delivered, {
      releaseToken: delivered.outstandingDeliveries.length
        ? delivery().releaseToken!
        : createWorkerGpuFrameReleaseToken(delivery().deliveryToken!),
      releasedAtMs: 24,
      outcome: 'presented',
    });

    expect(admitted).toMatchObject({
      state: 'requesting',
      counters: {
        requested: 1,
        admitted: 1,
      },
    });
    expect(delivered).toMatchObject({
      state: 'ready',
      lastDeliveredFrameId: 'frame-a',
      lastFreshness: 'exact',
      counters: {
        delivered: 1,
        exact: 1,
      },
    });
    expect(delivered.outstandingRequests).toEqual([]);
    expect(delivered.outstandingDeliveries).toHaveLength(1);
    expect(released).toMatchObject({
      state: 'ready',
      counters: {
        released: 1,
      },
    });
    expect(released.outstandingDeliveries).toEqual([]);
  });

  it('tracks nearest and held deliveries including late deadlines', () => {
    const nearestRequest = request({ requestId: 'nearest-request' });
    const nearestDelivered = deliverWorkerGpuFrame(
      admitWorkerGpuFrameRequest(
        requestWorkerGpuFrame(provider(), nearestRequest),
        nearestRequest.requestId,
        12,
      ),
      delivery({
        requestId: 'nearest-request',
        freshness: 'nearest',
        deliveredAtMs: 18,
      }),
    );

    const holdRequest = request({
      requestId: 'hold-request',
      deadlineAtMs: 40,
      mode: 'hold',
      intent: 'still',
      direction: 'still',
    });
    const heldDelivered = deliverWorkerGpuFrame(
      admitWorkerGpuFrameRequest(
        requestWorkerGpuFrame(nearestDelivered, holdRequest),
        holdRequest.requestId,
        30,
      ),
      delivery({
        requestId: 'hold-request',
        freshness: 'held',
        frameId: 'frame-held',
        deliveredAtMs: 60,
        deadlineAtMs: 40,
      }),
    );

    expect(nearestDelivered).toMatchObject({
      state: 'ready',
      counters: {
        nearest: 1,
      },
    });
    expect(heldDelivered).toMatchObject({
      state: 'holding',
      lastFreshness: 'held',
      counters: {
        requested: 2,
        admitted: 2,
        delivered: 2,
        nearest: 1,
        held: 1,
        late: 1,
      },
    });
  });

  it('marks stale generations and late requests without accepting old frames', () => {
    const first = request();
    const admitted = admitWorkerGpuFrameRequest(
      requestWorkerGpuFrame(provider(), first),
      first.requestId,
      12,
    );
    const nextGeneration = request({
      requestId: 'request-b',
      generationId: 2,
      requestedAtMs: 30,
      deadlineAtMs: 46,
    });
    const advanced = requestWorkerGpuFrame(admitted, nextGeneration);
    const staleDelivery = deliverWorkerGpuFrame(advanced, delivery());
    const late = markWorkerGpuFrameRequestLate(advanced, 'request-b', 60);
    const staleResponse = markWorkerGpuFrameResponseStale(late, 'request-b');

    expect(advanced).toMatchObject({
      generationId: 2,
      activeRequestId: 'request-b',
      counters: {
        requested: 2,
        stale: 1,
        generationChanges: 1,
      },
    });
    expect(advanced.outstandingRequests).toEqual([expect.objectContaining({
      requestId: 'request-b',
      generationId: 2,
    })]);
    expect(staleDelivery).toMatchObject({
      state: 'stale',
      counters: {
        rejected: 1,
        stale: 2,
      },
    });
    expect(staleResponse).toMatchObject({
      state: 'stale',
      counters: {
        late: 1,
        stale: 2,
      },
    });
    expect(staleResponse.outstandingRequests).toEqual([]);
  });

  it('accounts unreleased frame leases as leaks', () => {
    const nextRequest = request();
    const delivered = deliverWorkerGpuFrame(
      admitWorkerGpuFrameRequest(
        requestWorkerGpuFrame(provider(), nextRequest),
        nextRequest.requestId,
        12,
      ),
      delivery({ deliveredAtMs: 20 }),
    );
    const clean = accountWorkerGpuFrameLeaks(delivered, 25, 100);
    const leaked = accountWorkerGpuFrameLeaks(delivered, 200, 100);

    expect(clean).toBe(delivered);
    expect(leaked).toMatchObject({
      state: 'ready',
      lastReason: 'unreleased frame lease',
      counters: {
        delivered: 1,
        leaked: 1,
      },
    });
    expect(leaked.outstandingDeliveries).toEqual([]);
  });

  it('stops accounting after disposal', () => {
    const nextRequest = request();
    const disposed = disposeWorkerGpuFrameProvider(
      requestWorkerGpuFrame(provider(), nextRequest),
      'test shutdown',
    );

    expect(requestWorkerGpuFrame(disposed, request({ requestId: 'ignored' }))).toBe(disposed);
    expect(disposed).toMatchObject({
      state: 'disposed',
      lastReason: 'test shutdown',
      outstandingRequests: [],
      outstandingDeliveries: [],
    });
  });
});
