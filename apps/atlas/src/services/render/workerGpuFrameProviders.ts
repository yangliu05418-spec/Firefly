export type WorkerGpuFrameProviderSourceKind =
  | 'video'
  | 'image'
  | 'proxy'
  | 'document'
  | 'vector'
  | 'model-3d'
  | 'cad'
  | 'data';

export type WorkerGpuFrameProviderState =
  | 'cold'
  | 'warming'
  | 'ready'
  | 'requesting'
  | 'holding'
  | 'starved'
  | 'stale'
  | 'blocked'
  | 'failed'
  | 'draining'
  | 'disposed';

export type WorkerGpuFrameRequestMode = 'exact' | 'nearest' | 'hold';

export type WorkerGpuFramePriority = 'critical' | 'high' | 'normal' | 'low' | 'idle';

export type WorkerGpuFramePlaybackIntent =
  | 'normal-forward'
  | 'faster-forward'
  | 'reverse'
  | 'scrub'
  | 'still'
  | 'export';

export type WorkerGpuFrameDirection = 'forward' | 'reverse' | 'still';

export type WorkerGpuFrameFreshness = 'exact' | 'nearest' | 'held' | 'stale' | 'missing';

export type WorkerGpuRuntimeResourceKind = 'raster' | 'geometry' | 'document-page' | 'data';

export interface WorkerGpuFrameProviderCounters {
  readonly requested: number;
  readonly admitted: number;
  readonly rejected: number;
  readonly delivered: number;
  readonly released: number;
  readonly late: number;
  readonly stale: number;
  readonly leaked: number;
  readonly exact: number;
  readonly nearest: number;
  readonly held: number;
  readonly canceled: number;
  readonly failed: number;
  readonly generationChanges: number;
}

export interface WorkerGpuFrameProviderPlaybackPolicy {
  readonly intent: WorkerGpuFramePlaybackIntent;
  readonly direction: WorkerGpuFrameDirection;
  readonly mode: WorkerGpuFrameRequestMode;
  readonly priority: WorkerGpuFramePriority;
  readonly allowHold: boolean;
  readonly sourceTimeOrder: 'monotonic-forward' | 'skip-ok-forward' | 'reverse-lookbehind' | 'random-access';
}

export interface WorkerGpuFrameRequest {
  readonly requestId: string;
  readonly providerId: string;
  readonly sourceId: string;
  readonly generationId: number;
  readonly targetId: string;
  readonly timelineTimeSeconds: number;
  readonly mediaTimeSeconds: number;
  readonly compositionFrameNumber: number | null;
  readonly requestedAtMs: number;
  readonly deadlineAtMs: number;
  readonly mode: WorkerGpuFrameRequestMode;
  readonly priority: WorkerGpuFramePriority;
  readonly intent: WorkerGpuFramePlaybackIntent;
  readonly direction: WorkerGpuFrameDirection;
  readonly playbackRate: number;
  readonly maxDriftSeconds: number | null;
}

export interface WorkerGpuFrameRuntimeResource {
  readonly resourceId: string;
  readonly kind: WorkerGpuRuntimeResourceKind;
  readonly width: number | null;
  readonly height: number | null;
  readonly colorSpace: string | null;
}

export interface WorkerGpuFrameDeliveryToken {
  readonly tokenId: string;
  readonly providerId: string;
  readonly sourceId: string;
  readonly requestId: string;
  readonly generationId: number;
  readonly frameId: string;
  readonly issuedAtMs: number;
  readonly deadlineAtMs: number;
}

export interface WorkerGpuFrameReleaseToken {
  readonly tokenId: string;
  readonly deliveryTokenId: string;
  readonly providerId: string;
  readonly sourceId: string;
  readonly requestId: string;
  readonly generationId: number;
  readonly frameId: string;
  readonly issuedAtMs: number;
}

export interface WorkerGpuFrameDelivery {
  readonly requestId: string;
  readonly providerId: string;
  readonly sourceId: string;
  readonly generationId: number;
  readonly frameId: string | null;
  readonly mediaTimeSeconds: number | null;
  readonly frameTimestampSeconds: number | null;
  readonly deliveredAtMs: number;
  readonly deadlineAtMs: number;
  readonly freshness: WorkerGpuFrameFreshness;
  readonly resource: WorkerGpuFrameRuntimeResource | null;
  readonly deliveryToken: WorkerGpuFrameDeliveryToken | null;
  readonly releaseToken: WorkerGpuFrameReleaseToken | null;
  readonly dropReason: string | null;
}

export interface WorkerGpuFrameRequestLease {
  readonly requestId: string;
  readonly generationId: number;
  readonly requestedAtMs: number;
  readonly deadlineAtMs: number;
  readonly mode: WorkerGpuFrameRequestMode;
  readonly priority: WorkerGpuFramePriority;
  readonly intent: WorkerGpuFramePlaybackIntent;
  readonly admitted: boolean;
}

export interface WorkerGpuFrameDeliveryLease {
  readonly releaseTokenId: string;
  readonly deliveryTokenId: string;
  readonly requestId: string;
  readonly generationId: number;
  readonly frameId: string;
  readonly deliveredAtMs: number;
  readonly deadlineAtMs: number;
}

export interface WorkerGpuFrameProviderSnapshot {
  readonly providerId: string;
  readonly sourceId: string;
  readonly sourceKind: WorkerGpuFrameProviderSourceKind;
  readonly sessionId: string;
  readonly generationId: number;
  readonly state: WorkerGpuFrameProviderState;
  readonly activeRequestId: string | null;
  readonly lastDeliveredFrameId: string | null;
  readonly lastMediaTimeSeconds: number | null;
  readonly lastFreshness: WorkerGpuFrameFreshness;
  readonly lastReason: string | null;
  readonly deadlineAtMs: number | null;
  readonly priority: WorkerGpuFramePriority;
  readonly counters: WorkerGpuFrameProviderCounters;
  readonly outstandingRequests: readonly WorkerGpuFrameRequestLease[];
  readonly outstandingDeliveries: readonly WorkerGpuFrameDeliveryLease[];
}

export interface CreateWorkerGpuFrameProviderSnapshotInput {
  readonly providerId: string;
  readonly sourceId: string;
  readonly sourceKind: WorkerGpuFrameProviderSourceKind;
  readonly sessionId?: string;
  readonly generationId?: number;
  readonly state?: WorkerGpuFrameProviderState;
}

export interface CreateWorkerGpuFrameRequestInput {
  readonly requestId: string;
  readonly providerId: string;
  readonly sourceId: string;
  readonly generationId: number;
  readonly targetId: string;
  readonly timelineTimeSeconds: number;
  readonly mediaTimeSeconds: number;
  readonly requestedAtMs: number;
  readonly deadlineAtMs: number;
  readonly compositionFrameNumber?: number | null;
  readonly maxDriftSeconds?: number | null;
  readonly playbackRate?: number;
  readonly policy?: Partial<WorkerGpuFrameProviderPlaybackPolicy>;
}

export interface WorkerGpuFrameRelease {
  readonly releaseToken: WorkerGpuFrameReleaseToken;
  readonly releasedAtMs: number;
  readonly outcome: 'presented' | 'canceled' | 'evicted' | 'superseded';
}

const EMPTY_COUNTERS: WorkerGpuFrameProviderCounters = {
  requested: 0,
  admitted: 0,
  rejected: 0,
  delivered: 0,
  released: 0,
  late: 0,
  stale: 0,
  leaked: 0,
  exact: 0,
  nearest: 0,
  held: 0,
  canceled: 0,
  failed: 0,
  generationChanges: 0,
};

export function createEmptyWorkerGpuFrameProviderCounters(): WorkerGpuFrameProviderCounters {
  return { ...EMPTY_COUNTERS };
}

export function selectWorkerGpuFramePlaybackPolicy(input: {
  readonly playbackRate: number;
  readonly direction?: WorkerGpuFrameDirection;
  readonly scrubbing?: boolean;
  readonly exportFrame?: boolean;
}): WorkerGpuFrameProviderPlaybackPolicy {
  if (input.exportFrame) {
    return {
      intent: 'export',
      direction: input.direction ?? 'still',
      mode: 'exact',
      priority: 'normal',
      allowHold: false,
      sourceTimeOrder: 'random-access',
    };
  }
  if (input.scrubbing) {
    return {
      intent: 'scrub',
      direction: input.direction ?? 'still',
      mode: 'exact',
      priority: 'critical',
      allowHold: true,
      sourceTimeOrder: 'random-access',
    };
  }
  if (input.direction === 'reverse' || input.playbackRate < 0) {
    return {
      intent: 'reverse',
      direction: 'reverse',
      mode: 'exact',
      priority: 'critical',
      allowHold: false,
      sourceTimeOrder: 'reverse-lookbehind',
    };
  }
  if (Math.abs(input.playbackRate) > 1) {
    return {
      intent: 'faster-forward',
      direction: 'forward',
      mode: 'nearest',
      priority: 'critical',
      allowHold: false,
      sourceTimeOrder: 'skip-ok-forward',
    };
  }
  return {
    intent: input.direction === 'still' ? 'still' : 'normal-forward',
    direction: input.direction ?? 'forward',
    mode: input.direction === 'still' ? 'hold' : 'nearest',
    priority: input.direction === 'still' ? 'normal' : 'high',
    allowHold: true,
    sourceTimeOrder: input.direction === 'still' ? 'random-access' : 'monotonic-forward',
  };
}

export function createWorkerGpuFrameProviderSnapshot(
  input: CreateWorkerGpuFrameProviderSnapshotInput,
): WorkerGpuFrameProviderSnapshot {
  return {
    providerId: input.providerId,
    sourceId: input.sourceId,
    sourceKind: input.sourceKind,
    sessionId: input.sessionId ?? `${input.providerId}:${input.sourceId}`,
    generationId: input.generationId ?? 0,
    state: input.state ?? 'cold',
    activeRequestId: null,
    lastDeliveredFrameId: null,
    lastMediaTimeSeconds: null,
    lastFreshness: 'missing',
    lastReason: null,
    deadlineAtMs: null,
    priority: 'normal',
    counters: createEmptyWorkerGpuFrameProviderCounters(),
    outstandingRequests: [],
    outstandingDeliveries: [],
  };
}

export function createWorkerGpuFrameRequest(input: CreateWorkerGpuFrameRequestInput): WorkerGpuFrameRequest {
  const policy = {
    ...selectWorkerGpuFramePlaybackPolicy({
      playbackRate: input.playbackRate ?? 1,
      direction: input.policy?.direction,
    }),
    ...input.policy,
  };

  return {
    requestId: input.requestId,
    providerId: input.providerId,
    sourceId: input.sourceId,
    generationId: input.generationId,
    targetId: input.targetId,
    timelineTimeSeconds: input.timelineTimeSeconds,
    mediaTimeSeconds: input.mediaTimeSeconds,
    compositionFrameNumber: input.compositionFrameNumber ?? null,
    requestedAtMs: input.requestedAtMs,
    deadlineAtMs: input.deadlineAtMs,
    mode: policy.mode,
    priority: policy.priority,
    intent: policy.intent,
    direction: policy.direction,
    playbackRate: input.playbackRate ?? 1,
    maxDriftSeconds: input.maxDriftSeconds ?? null,
  };
}

export function createWorkerGpuFrameDeliveryToken(input: {
  readonly providerId: string;
  readonly sourceId: string;
  readonly requestId: string;
  readonly generationId: number;
  readonly frameId: string;
  readonly issuedAtMs: number;
  readonly deadlineAtMs: number;
}): WorkerGpuFrameDeliveryToken {
  return {
    tokenId: [
      input.providerId,
      input.sourceId,
      input.generationId,
      input.requestId,
      input.frameId,
      'delivery',
    ].join(':'),
    providerId: input.providerId,
    sourceId: input.sourceId,
    requestId: input.requestId,
    generationId: input.generationId,
    frameId: input.frameId,
    issuedAtMs: input.issuedAtMs,
    deadlineAtMs: input.deadlineAtMs,
  };
}

export function createWorkerGpuFrameReleaseToken(
  deliveryToken: WorkerGpuFrameDeliveryToken,
): WorkerGpuFrameReleaseToken {
  return {
    tokenId: `${deliveryToken.tokenId}:release`,
    deliveryTokenId: deliveryToken.tokenId,
    providerId: deliveryToken.providerId,
    sourceId: deliveryToken.sourceId,
    requestId: deliveryToken.requestId,
    generationId: deliveryToken.generationId,
    frameId: deliveryToken.frameId,
    issuedAtMs: deliveryToken.issuedAtMs,
  };
}

export function requestWorkerGpuFrame(
  snapshot: WorkerGpuFrameProviderSnapshot,
  request: WorkerGpuFrameRequest,
): WorkerGpuFrameProviderSnapshot {
  if (snapshot.state === 'disposed') return snapshot;
  if (!matchesProvider(snapshot, request.providerId, request.sourceId)) {
    return rejectAsStale(snapshot, 'provider mismatch', true);
  }
  if (request.generationId < snapshot.generationId) {
    return rejectAsStale(snapshot, 'stale generation', true);
  }

  const next = advanceGeneration(snapshot, request.generationId);
  const lease: WorkerGpuFrameRequestLease = {
    requestId: request.requestId,
    generationId: request.generationId,
    requestedAtMs: request.requestedAtMs,
    deadlineAtMs: request.deadlineAtMs,
    mode: request.mode,
    priority: request.priority,
    intent: request.intent,
    admitted: false,
  };

  return {
    ...next,
    state: next.state === 'cold' ? 'warming' : 'requesting',
    activeRequestId: request.requestId,
    deadlineAtMs: request.deadlineAtMs,
    priority: request.priority,
    counters: {
      ...next.counters,
      requested: next.counters.requested + 1,
    },
    outstandingRequests: replaceRequest(next.outstandingRequests, lease),
  };
}

export function admitWorkerGpuFrameRequest(
  snapshot: WorkerGpuFrameProviderSnapshot,
  requestId: string,
  admittedAtMs: number,
): WorkerGpuFrameProviderSnapshot {
  if (snapshot.state === 'disposed') return snapshot;
  const lease = snapshot.outstandingRequests.find((request) => request.requestId === requestId);
  if (!lease || lease.generationId !== snapshot.generationId) {
    return rejectAsStale(snapshot, 'unknown request admission', false);
  }

  return {
    ...snapshot,
    state: 'requesting',
    activeRequestId: requestId,
    lastReason: admittedAtMs > lease.deadlineAtMs ? 'admitted after deadline' : snapshot.lastReason,
    counters: {
      ...snapshot.counters,
      admitted: snapshot.counters.admitted + 1,
      late: admittedAtMs > lease.deadlineAtMs ? snapshot.counters.late + 1 : snapshot.counters.late,
    },
    outstandingRequests: snapshot.outstandingRequests.map((request) => (
      request.requestId === requestId ? { ...request, admitted: true } : request
    )),
  };
}

export function deliverWorkerGpuFrame(
  snapshot: WorkerGpuFrameProviderSnapshot,
  delivery: WorkerGpuFrameDelivery,
): WorkerGpuFrameProviderSnapshot {
  if (snapshot.state === 'disposed') return snapshot;
  if (!matchesProvider(snapshot, delivery.providerId, delivery.sourceId)
    || delivery.generationId !== snapshot.generationId
    || !snapshot.outstandingRequests.some((request) => request.requestId === delivery.requestId)) {
    return rejectAsStale(snapshot, delivery.dropReason ?? 'stale delivery', false);
  }

  const late = delivery.deliveredAtMs > delivery.deadlineAtMs;
  const deliveredFrame = delivery.releaseToken && delivery.deliveryToken && delivery.frameId
    ? leaseFromDelivery(delivery)
    : null;
  const remainingRequests = snapshot.outstandingRequests.filter((request) => (
    request.requestId !== delivery.requestId
  ));
  const nextDeliveries = deliveredFrame
    ? replaceDelivery(snapshot.outstandingDeliveries, deliveredFrame)
    : snapshot.outstandingDeliveries;

  return {
    ...snapshot,
    state: providerStateAfterDelivery(delivery, remainingRequests.length),
    activeRequestId: remainingRequests[0]?.requestId ?? null,
    lastDeliveredFrameId: delivery.frameId ?? snapshot.lastDeliveredFrameId,
    lastMediaTimeSeconds: delivery.mediaTimeSeconds,
    lastFreshness: delivery.freshness,
    lastReason: delivery.dropReason ?? (late ? 'delivery after deadline' : snapshot.lastReason),
    deadlineAtMs: remainingRequests[0]?.deadlineAtMs ?? null,
    counters: {
      ...snapshot.counters,
      delivered: deliveredFrame ? snapshot.counters.delivered + 1 : snapshot.counters.delivered,
      late: late ? snapshot.counters.late + 1 : snapshot.counters.late,
      exact: delivery.freshness === 'exact' ? snapshot.counters.exact + 1 : snapshot.counters.exact,
      nearest: delivery.freshness === 'nearest' ? snapshot.counters.nearest + 1 : snapshot.counters.nearest,
      held: delivery.freshness === 'held' ? snapshot.counters.held + 1 : snapshot.counters.held,
      rejected: delivery.dropReason ? snapshot.counters.rejected + 1 : snapshot.counters.rejected,
      failed: delivery.freshness === 'missing' ? snapshot.counters.failed + 1 : snapshot.counters.failed,
    },
    outstandingRequests: remainingRequests,
    outstandingDeliveries: nextDeliveries,
  };
}

export function releaseWorkerGpuFrame(
  snapshot: WorkerGpuFrameProviderSnapshot,
  release: WorkerGpuFrameRelease,
): WorkerGpuFrameProviderSnapshot {
  if (snapshot.state === 'disposed') return snapshot;
  const token = release.releaseToken;
  if (!matchesProvider(snapshot, token.providerId, token.sourceId)
    || token.generationId !== snapshot.generationId) {
    return rejectAsStale(snapshot, 'stale release', false);
  }

  const delivery = snapshot.outstandingDeliveries.find((lease) => lease.releaseTokenId === token.tokenId);
  if (!delivery) {
    return rejectAsStale(snapshot, 'unknown release token', false);
  }

  const remainingDeliveries = snapshot.outstandingDeliveries.filter((lease) => lease.releaseTokenId !== token.tokenId);
  const canceled = release.outcome === 'canceled' || release.outcome === 'superseded';

  return {
    ...snapshot,
    state: stateAfterRelease(snapshot, remainingDeliveries.length),
    lastReason: canceled ? release.outcome : snapshot.lastReason,
    counters: {
      ...snapshot.counters,
      released: snapshot.counters.released + 1,
      canceled: canceled ? snapshot.counters.canceled + 1 : snapshot.counters.canceled,
    },
    outstandingDeliveries: remainingDeliveries,
  };
}

export function markWorkerGpuFrameRequestLate(
  snapshot: WorkerGpuFrameProviderSnapshot,
  requestId: string,
  nowMs: number,
  reason = 'request missed deadline',
): WorkerGpuFrameProviderSnapshot {
  if (snapshot.state === 'disposed') return snapshot;
  const lease = snapshot.outstandingRequests.find((request) => request.requestId === requestId);
  if (!lease || lease.generationId !== snapshot.generationId) {
    return rejectAsStale(snapshot, reason, false);
  }

  return {
    ...snapshot,
    state: 'starved',
    lastReason: reason,
    counters: {
      ...snapshot.counters,
      late: snapshot.counters.late + 1,
      rejected: nowMs > lease.deadlineAtMs ? snapshot.counters.rejected + 1 : snapshot.counters.rejected,
    },
  };
}

export function markWorkerGpuFrameResponseStale(
  snapshot: WorkerGpuFrameProviderSnapshot,
  requestId: string,
  reason = 'stale response',
): WorkerGpuFrameProviderSnapshot {
  if (snapshot.state === 'disposed') return snapshot;
  return {
    ...snapshot,
    state: 'stale',
    lastReason: reason,
    counters: {
      ...snapshot.counters,
      stale: snapshot.counters.stale + 1,
    },
    outstandingRequests: snapshot.outstandingRequests.filter((request) => request.requestId !== requestId),
  };
}

export function accountWorkerGpuFrameLeaks(
  snapshot: WorkerGpuFrameProviderSnapshot,
  nowMs: number,
  maxLeaseAgeMs: number,
): WorkerGpuFrameProviderSnapshot {
  if (snapshot.state === 'disposed') return snapshot;
  const leaked = snapshot.outstandingDeliveries.filter((lease) => (
    nowMs - lease.deliveredAtMs > maxLeaseAgeMs
  ));
  if (!leaked.length) return snapshot;
  const leakedIds = new Set(leaked.map((lease) => lease.releaseTokenId));
  const remainingDeliveries = snapshot.outstandingDeliveries.filter((lease) => (
    !leakedIds.has(lease.releaseTokenId)
  ));

  return {
    ...snapshot,
    state: remainingDeliveries.length ? 'draining' : 'ready',
    lastReason: 'unreleased frame lease',
    counters: {
      ...snapshot.counters,
      leaked: snapshot.counters.leaked + leaked.length,
    },
    outstandingDeliveries: remainingDeliveries,
  };
}

export function disposeWorkerGpuFrameProvider(
  snapshot: WorkerGpuFrameProviderSnapshot,
  reason: string,
): WorkerGpuFrameProviderSnapshot {
  return {
    ...snapshot,
    state: 'disposed',
    activeRequestId: null,
    lastReason: reason,
    outstandingRequests: [],
    outstandingDeliveries: [],
  };
}

function matchesProvider(
  snapshot: WorkerGpuFrameProviderSnapshot,
  providerId: string,
  sourceId: string,
): boolean {
  return snapshot.providerId === providerId && snapshot.sourceId === sourceId;
}

function advanceGeneration(
  snapshot: WorkerGpuFrameProviderSnapshot,
  generationId: number,
): WorkerGpuFrameProviderSnapshot {
  if (generationId === snapshot.generationId) return snapshot;
  const staleCount = snapshot.outstandingRequests.length + snapshot.outstandingDeliveries.length;
  return {
    ...snapshot,
    generationId,
    activeRequestId: null,
    lastReason: staleCount ? 'generation advanced' : snapshot.lastReason,
    counters: {
      ...snapshot.counters,
      generationChanges: snapshot.counters.generationChanges + 1,
      stale: snapshot.counters.stale + staleCount,
    },
    outstandingRequests: [],
    outstandingDeliveries: [],
  };
}

function rejectAsStale(
  snapshot: WorkerGpuFrameProviderSnapshot,
  reason: string,
  countRequested: boolean,
): WorkerGpuFrameProviderSnapshot {
  return {
    ...snapshot,
    state: 'stale',
    lastReason: reason,
    counters: {
      ...snapshot.counters,
      requested: countRequested ? snapshot.counters.requested + 1 : snapshot.counters.requested,
      rejected: snapshot.counters.rejected + 1,
      stale: snapshot.counters.stale + 1,
    },
  };
}

function replaceRequest(
  requests: readonly WorkerGpuFrameRequestLease[],
  lease: WorkerGpuFrameRequestLease,
): readonly WorkerGpuFrameRequestLease[] {
  return [
    ...requests.filter((request) => request.requestId !== lease.requestId),
    lease,
  ];
}

function replaceDelivery(
  deliveries: readonly WorkerGpuFrameDeliveryLease[],
  lease: WorkerGpuFrameDeliveryLease,
): readonly WorkerGpuFrameDeliveryLease[] {
  return [
    ...deliveries.filter((delivery) => delivery.releaseTokenId !== lease.releaseTokenId),
    lease,
  ];
}

function leaseFromDelivery(delivery: WorkerGpuFrameDelivery): WorkerGpuFrameDeliveryLease {
  return {
    releaseTokenId: delivery.releaseToken!.tokenId,
    deliveryTokenId: delivery.deliveryToken!.tokenId,
    requestId: delivery.requestId,
    generationId: delivery.generationId,
    frameId: delivery.frameId!,
    deliveredAtMs: delivery.deliveredAtMs,
    deadlineAtMs: delivery.deadlineAtMs,
  };
}

function providerStateAfterDelivery(
  delivery: WorkerGpuFrameDelivery,
  remainingRequestCount: number,
): WorkerGpuFrameProviderState {
  if (remainingRequestCount > 0) return 'requesting';
  if (delivery.dropReason || delivery.freshness === 'missing') return 'starved';
  if (delivery.freshness === 'held') return 'holding';
  if (delivery.freshness === 'stale') return 'stale';
  return 'ready';
}

function stateAfterRelease(
  snapshot: WorkerGpuFrameProviderSnapshot,
  remainingDeliveryCount: number,
): WorkerGpuFrameProviderState {
  if (snapshot.outstandingRequests.length > 0) return 'requesting';
  if (remainingDeliveryCount > 0) return 'draining';
  return snapshot.lastFreshness === 'held' ? 'holding' : 'ready';
}
