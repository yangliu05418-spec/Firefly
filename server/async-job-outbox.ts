import type { JobsOptions } from "bullmq";
import type { AsyncJobOutbox, AsyncJobQueueName } from "./db.js";

type QueueJob = { getState(): Promise<string>; remove(): Promise<unknown> };
export type OutboxQueue = {
  add(name: string, payload: unknown, options: JobsOptions): Promise<unknown>;
  getJob(id: string): Promise<QueueJob | undefined>;
};

export type AsyncJobOutboxStore = {
  listPendingAsyncJobIntents(now: number, limit?: number): AsyncJobOutbox[];
  listStaleDispatchedAsyncJobIntents(staleBefore: number, limit?: number): AsyncJobOutbox[];
  isAsyncJobIntentActive(queueName: AsyncJobQueueName, jobId: string): boolean;
  markAsyncJobDispatched(queueName: AsyncJobQueueName, jobId: string, now?: number): boolean;
  recordAsyncJobDispatchFailure(queueName: AsyncJobQueueName, jobId: string, error: string, availableAt: number, now?: number): boolean;
  requeueAsyncJobIntent(queueName: AsyncJobQueueName, jobId: string, now?: number): boolean;
  completeAsyncJobIntent(queueName: AsyncJobQueueName, jobId: string, now?: number): boolean;
  purgeCompletedAsyncJobIntents(completedBefore: number): number;
};

export type AsyncJobQueues = Record<AsyncJobQueueName, OutboxQueue>;

const retention = { age: 7 * 24 * 3600 };
const queueOptions = (intent: AsyncJobOutbox): JobsOptions => {
  const attempts = intent.queueName === "generation" ? 4 : intent.queueName === "image-generation" ? 5 : 3;
  // Image-key cooldowns last 30s for 5xx and 60s for 429. Keep retries
  // alive beyond that window instead of exhausting them while every key is cooling.
  const delay = intent.queueName === "image-generation" ? 15_000 : intent.queueName === "canvas-jobs" && intent.jobName === "text" ? 3000 : 5000;
  return {
    jobId: intent.jobId,
    attempts,
    backoff: { type: "exponential", delay, jitter: 0.5 },
    removeOnComplete: retention,
    removeOnFail: retention,
  };
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "queue dispatch failed").slice(0, 500);
const nextAttemptAt = (intent: AsyncJobOutbox, now: number) => now + Math.min(30_000, 500 * 2 ** Math.min(intent.publishAttempts, 6));

/** Publishes durable SQLite intents to BullMQ. Queue job ids make retries idempotent. */
export const dispatchPendingAsyncJobs = async (store: AsyncJobOutboxStore, queues: AsyncJobQueues, now = Date.now()) => {
  const pending = store.listPendingAsyncJobIntents(now, 50);
  for (const intent of pending) {
    if (!store.isAsyncJobIntentActive(intent.queueName, intent.jobId)) {
      store.completeAsyncJobIntent(intent.queueName, intent.jobId, now);
      continue;
    }
    try {
      await queues[intent.queueName].add(intent.jobName, intent.payload, queueOptions(intent));
      store.markAsyncJobDispatched(intent.queueName, intent.jobId, now);
      console.info(JSON.stringify({ type: "async_job_dispatched", at: new Date(now).toISOString(), queue: intent.queueName, jobId: intent.jobId, attempt: intent.publishAttempts + 1 }));
    } catch (error) {
      store.recordAsyncJobDispatchFailure(intent.queueName, intent.jobId, errorMessage(error), nextAttemptAt(intent, now), now);
      console.warn(JSON.stringify({ type: "async_job_dispatch_failed", at: new Date(now).toISOString(), queue: intent.queueName, jobId: intent.jobId, attempt: intent.publishAttempts + 1, code: (error as { code?: string }).code ?? "unknown" }));
    }
  }
  return pending.length;
};

/** Repairs a lost Redis handoff while leaving active/waiting/delayed jobs untouched. */
export const reconcileDispatchedAsyncJobs = async (store: AsyncJobOutboxStore, queues: AsyncJobQueues, now = Date.now()) => {
  const stale = store.listStaleDispatchedAsyncJobIntents(now - 60_000, 50);
  for (const intent of stale) {
    try {
      if (!store.isAsyncJobIntentActive(intent.queueName, intent.jobId)) {
        store.completeAsyncJobIntent(intent.queueName, intent.jobId, now);
        continue;
      }
      const queue = queues[intent.queueName];
      const job = await queue.getJob(intent.jobId);
      if (!job) {
        store.requeueAsyncJobIntent(intent.queueName, intent.jobId, now);
        continue;
      }
      const state = await job.getState();
      if (state !== "completed" && state !== "failed" && state !== "unknown") continue;
      await job.remove();
      store.requeueAsyncJobIntent(intent.queueName, intent.jobId, now);
    } catch (error) {
      console.warn(JSON.stringify({ type: "async_job_reconcile_deferred", at: new Date(now).toISOString(), queue: intent.queueName, jobId: intent.jobId, code: (error as { code?: string }).code ?? "unknown" }));
    }
  }
  return stale.length;
};

export const startAsyncJobOutboxDispatcher = (store: AsyncJobOutboxStore, queues: AsyncJobQueues) => {
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  let lastReconcileAt = 0;
  let lastCleanupAt = 0;
  const tick = () => {
    if (stopped || inFlight) return inFlight;
    const now = Date.now();
    inFlight = (async () => {
      await dispatchPendingAsyncJobs(store, queues, now);
      if (now - lastReconcileAt >= 30_000) {
        await reconcileDispatchedAsyncJobs(store, queues, now);
        lastReconcileAt = now;
      }
      if (now - lastCleanupAt >= 60 * 60_000) {
        store.purgeCompletedAsyncJobIntents(now - 7 * 24 * 60 * 60_000);
        lastCleanupAt = now;
      }
    })().catch((error) => {
      console.error(JSON.stringify({ type: "async_job_dispatcher_failed", at: new Date().toISOString(), code: (error as { code?: string }).code ?? "unknown" }));
    }).finally(() => { inFlight = undefined; });
    return inFlight;
  };
  const timer = setInterval(() => void tick(), 500);
  timer.unref();
  void tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await inFlight;
  };
};
