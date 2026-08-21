import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchPendingAsyncJobs, reconcileDispatchedAsyncJobs, type AsyncJobQueues } from "./async-job-outbox.js";
import { UserStore, type StoredTask } from "./db.js";
import { migrateDatabase } from "./migrations.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

const createStore = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-outbox-"));
  directories.push(directory);
  const databasePath = path.join(directory, "firefly.db");
  migrateDatabase(databasePath);
  const store = new UserStore(databasePath);
  const owner = store.upsertFromFeishu({ openId: "ou_owner", unionId: "on_owner", tenantKey: "tenant", email: "owner@dokuai.tv", name: "Owner", avatarUrl: "" });
  return { store, owner };
};

const task = (id: string, ownerId: string, createdAt = 100): StoredTask => ({
  id, ownerId, visibility: "private", status: "queued", mediaStatus: "none", prompt: "雨夜列车",
  model: "seedance-2-5-pro", mode: "text", ratio: "16:9", resolution: "720p", duration: 5,
  request: { prompt: "雨夜列车", assets: [] }, createdAt, updatedAt: createdAt,
});

const queues = (add: ReturnType<typeof vi.fn>, getJob = vi.fn(async () => undefined)) => {
  const queue = { add, getJob };
  return { generation: queue, "image-generation": queue, "canvas-jobs": queue } as unknown as AsyncJobQueues;
};

describe("durable async job outbox", () => {
  it("commits task admission and queue intent in one capacity-checked transaction", () => {
    const { store, owner } = createStore();
    const first = task("task-1", owner.id);
    const intent = { queueName: "generation" as const, jobId: first.id, jobName: "generate", payload: { input: first.request } };

    expect(store.createTaskWithinLimit(first, 1, intent)).toBe(true);
    expect(store.readTask(first.id)).toMatchObject({ status: "queued" });
    expect(store.readAsyncJobIntent("generation", first.id)).toMatchObject({ status: "pending", payload: intent.payload, publishAttempts: 0 });
    expect(store.asyncJobOutboxStats()).toMatchObject({ pending: 1, dispatched: 0, oldestPendingAt: first.createdAt });

    const rejected = task("task-2", owner.id);
    expect(store.createTaskWithinLimit(rejected, 1, { ...intent, jobId: rejected.id })).toBe(false);
    expect(store.readTask(rejected.id)).toBeNull();
    expect(store.readAsyncJobIntent("generation", rejected.id)).toBeNull();
    store.close();
  });

  it("reuses a client generation id without consuming capacity or duplicating the queue intent", () => {
    const { store, owner } = createStore();
    const first = task("task-idempotent", owner.id);
    const intent = { queueName: "generation" as const, jobId: first.id, jobName: "generate", payload: { input: first.request } };

    expect(store.admitTaskWithinLimit(first, 1, intent)).toMatchObject({ status: "created", task: { id: first.id, prompt: "雨夜列车" } });
    expect(store.admitTaskWithinLimit({ ...first, prompt: "不应覆盖第一次请求", updatedAt: 200 }, 1, intent)).toMatchObject({
      status: "existing", task: { id: first.id, prompt: "雨夜列车" },
    });
    expect(store.asyncJobOutboxStats()).toMatchObject({ pending: 1, dispatched: 0 });
    expect(store.readAsyncJobIntent("generation", first.id)).toMatchObject({ status: "pending", payload: intent.payload });
    store.close();
  });

  it("persists the complete image payload and retries beyond provider key cooldowns", async () => {
    const { store, owner } = createStore();
    const createdAt = 200;
    const imageTask = {
      id: "image-task-1", ownerId: owner.id, model: "google/image", modelName: "Image", ratio: "16:9",
      resolution: "1024", prompt: "雨夜列车", requestedCount: 2, status: "running" as const,
      items: [], failures: [], createdAt, updatedAt: createdAt,
    };
    const payload = {
      ownerId: owner.id, model: imageTask.model, prompt: imageTask.prompt, ratio: imageTask.ratio,
      resolution: imageTask.resolution, count: 2, referenceUploadIds: ["upload-reference-1234567890"],
    };

    expect(store.createImageGenerationWithinLimit(imageTask, 2, {
      queueName: "image-generation", jobId: imageTask.id, jobName: "generate-image", payload,
    })).toBe(true);
    expect(store.readAsyncJobIntent("image-generation", imageTask.id)).toMatchObject({ status: "pending", payload });
    const add = vi.fn(async () => ({ id: imageTask.id }));
    await dispatchPendingAsyncJobs(store, queues(add), createdAt);
    expect(add).toHaveBeenCalledWith("generate-image", payload, expect.objectContaining({
      jobId: imageTask.id,
      attempts: 5,
      backoff: expect.objectContaining({ type: "exponential", delay: 15_000 }),
    }));
    store.close();
  });

  it("acknowledges a queue outage without losing the job and retries with the stable job id", async () => {
    const { store, owner } = createStore();
    const record = task("task-retry", owner.id);
    store.createTaskWithinLimit(record, 2, { queueName: "generation", jobId: record.id, jobName: "generate", payload: { input: record.request } });
    const add = vi.fn().mockRejectedValueOnce(new Error("redis reconnecting")).mockResolvedValueOnce({ id: record.id });
    const adapters = queues(add);

    await dispatchPendingAsyncJobs(store, adapters, 100);
    const retry = store.readAsyncJobIntent("generation", record.id)!;
    expect(retry).toMatchObject({ status: "pending", publishAttempts: 1, lastError: "redis reconnecting" });

    await dispatchPendingAsyncJobs(store, adapters, retry.availableAt);
    expect(store.readAsyncJobIntent("generation", record.id)).toMatchObject({ status: "dispatched", publishAttempts: 2, lastError: undefined });
    expect(add).toHaveBeenLastCalledWith("generate", { input: record.request }, expect.objectContaining({ jobId: record.id, attempts: 4 }));
    store.close();
  });

  it("requeues a lost Redis handoff and completes an intent whose durable task is terminal", async () => {
    const { store, owner } = createStore();
    const record = task("task-recover", owner.id);
    store.createTaskWithinLimit(record, 2, { queueName: "generation", jobId: record.id, jobName: "generate", payload: { input: record.request } });
    store.markAsyncJobDispatched("generation", record.id, 100);
    const adapters = queues(vi.fn(), vi.fn(async () => undefined));

    await reconcileDispatchedAsyncJobs(store, adapters, 60_101);
    expect(store.readAsyncJobIntent("generation", record.id)).toMatchObject({ status: "pending", availableAt: 60_101 });

    store.markAsyncJobDispatched("generation", record.id, 70_000);
    store.saveTask({ ...record, status: "failed", updatedAt: 70_001 });
    await reconcileDispatchedAsyncJobs(store, adapters, 130_001);
    expect(store.readAsyncJobIntent("generation", record.id)).toMatchObject({ status: "complete", payload: {} });
    store.close();
  });
});
