import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CANVAS_DOCUMENT } from "./canvas-document.js";
import { canvasGeneratedAssetId, canvasGeneratedMediaId } from "./canvas-job-media.js";
import { UserStore, type CanvasJob, type CanvasProjectAsset, type MediaObject, type StoredTask } from "./db.js";
import { migrateDatabase } from "./migrations.js";

describe("canvas generated image lifecycle", () => {
  const directories: string[] = [];

  afterEach(() => directories.splice(0).forEach((directory) => {
    try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 60 }); } catch { /* temp dir; best effort */ }
  }));

  const harness = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-canvas-job-"));
    directories.push(directory);
    const databasePath = path.join(directory, "canvas.db");
    migrateDatabase(databasePath);
    const store = new UserStore(databasePath);
    const owner = store.upsertFromFeishu({ openId: "ou_canvas_job", unionId: "on_canvas_job", tenantKey: "tenant-dokuai", email: "canvas-job@dokuai.tv", name: "Canvas Job", avatarUrl: "" });
    const now = Date.now();
    store.createCanvasProject({ id: "canvas-1", ownerId: owner.id, title: "测试画布", documentJson: JSON.stringify(DEFAULT_CANVAS_DOCUMENT), revision: 0, createdAt: now, updatedAt: now });
    const job: CanvasJob = {
      id: "canvas-job-1", ownerId: owner.id, canvasId: "canvas-1", nodeId: "node-1", kind: "image",
      status: "running", payload: {}, partialText: "", createdAt: now, updatedAt: now,
    };
    store.createCanvasJob(job);
    const mediaId = canvasGeneratedMediaId(job.id);
    const media: MediaObject = {
      id: mediaId, ownerId: owner.id, kind: "generated", objectKey: `generated/${mediaId}.png`, status: "ready",
      fileName: "canvas.png", contentType: "image/png", size: 1024, etag: "etag", createdAt: now, updatedAt: now,
    };
    store.upsertMedia(media);
    const asset: CanvasProjectAsset = {
      id: canvasGeneratedAssetId(job.id), ownerId: owner.id, canvasId: "canvas-1", kind: "image",
      sourceType: "generated", sourceId: mediaId, title: "生成结果", contentType: "image/png", size: 1024,
      status: "ready", createdAt: now, updatedAt: now,
    };
    return { store, owner, job, mediaId, asset };
  };

  it("uses stable IDs so a BullMQ retry can reuse an already persisted result", () => {
    expect(canvasGeneratedMediaId("canvas-job-1")).toBe(canvasGeneratedMediaId("canvas-job-1"));
    expect(canvasGeneratedMediaId("canvas-job-1")).not.toBe(canvasGeneratedMediaId("canvas-job-2"));
    expect(canvasGeneratedAssetId("canvas-job-1")).toBe(canvasGeneratedAssetId("canvas-job-1"));
  });

  it("atomically commits the project asset and prevents a late cancellation from deleting it", () => {
    const { store, job, mediaId, asset } = harness();

    const completed = store.completeCanvasGeneratedJob(job.id, asset);
    const cancellation = store.cancelCanvasJob(job.id);

    expect(completed?.job).toMatchObject({ status: "succeeded", resultAssetId: asset.id });
    expect(completed?.asset.sourceId).toBe(mediaId);
    expect(cancellation).toMatchObject({ changed: false, job: { status: "succeeded" } });
    expect(store.markUnreferencedGeneratedMediaForDeletion(mediaId, job.ownerId)).toBe(false);
    expect(store.readMedia(mediaId)?.status).toBe("ready");
    store.close();
  });

  it("keeps cancellation terminal and garbage-collects an uncommitted generated object", () => {
    const { store, job, mediaId, asset } = harness();

    const cancellation = store.cancelCanvasJob(job.id);
    const lateCompletion = store.completeCanvasGeneratedJob(job.id, asset);
    const lateTextCompletion = store.transitionActiveCanvasJob(job.id, { status: "succeeded", partialText: "late" });

    expect(cancellation).toMatchObject({ changed: true, job: { status: "cancelled" } });
    expect(lateCompletion).toBeNull();
    expect(lateTextCompletion).toBeNull();
    expect(store.markUnreferencedGeneratedMediaForDeletion(mediaId, job.ownerId)).toBe(true);
    expect(store.readMedia(mediaId)?.status).toBe("delete_pending");
    store.close();
  });

  it("does not create a late video project asset after cancellation won", () => {
    const { store, owner } = harness();
    const now = Date.now();
    const videoJob: CanvasJob = {
      id: "canvas-video-job-1", ownerId: owner.id, canvasId: "canvas-1", nodeId: "video-node-1", kind: "video",
      status: "running", payload: {}, providerTaskId: "video-task-1", partialText: "", createdAt: now, updatedAt: now,
    };
    store.createCanvasJob(videoJob);
    store.cancelCanvasJob(videoJob.id);

    const attached = store.attachCanvasProjectAssetToActiveJob(videoJob.id, {
      id: "canvas-video-asset-1", ownerId: owner.id, canvasId: "canvas-1", kind: "video",
      sourceType: "generation", sourceId: "video-task-1", title: "视频结果", contentType: "video/mp4", size: 2048,
      status: "ready", createdAt: now, updatedAt: now,
    }, true);

    expect(attached).toBeNull();
    expect(store.readCanvasProjectAssetBySource("canvas-1", "generation", "video-task-1")).toBeNull();
    store.close();
  });

  it("atomically arbitrates task deletion against output media archival", () => {
    const { store, owner } = harness();
    const makeTask = (id: string): StoredTask => ({
      id, ownerId: owner.id, visibility: "private", status: "succeeded", mediaStatus: "archiving", mediaRevision: 0,
      prompt: "test", model: "seedance-test", mode: "text", ratio: "16:9", resolution: "720p", duration: 5,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    const makeOutput = (taskId: string): MediaObject => ({
      id: `${taskId}:output`, ownerId: owner.id, taskId, kind: "output", objectKey: `outputs/${taskId}.mp4`,
      status: "ready", fileName: "result.mp4", contentType: "video/mp4", size: 4096, etag: "etag",
      createdAt: Date.now(), updatedAt: Date.now(),
    });

    const archived = makeTask("task-archive-wins");
    store.saveTask(archived);
    expect(store.commitTaskMediaIfActive(archived.id, makeOutput(archived.id), true)).toMatchObject({ status: "succeeded", mediaStatus: "ready", mediaRevision: 1 });
    expect(store.softDeleteTask(archived.id, owner.id)).toBe(true);
    expect(store.readMedia(`${archived.id}:output`)?.status).toBe("delete_pending");

    const cancelled = makeTask("task-delete-wins");
    store.saveTask(cancelled);
    expect(store.softDeleteTask(cancelled.id, owner.id)).toBe(true);
    expect(store.commitTaskMediaIfActive(cancelled.id, makeOutput(cancelled.id), true)).toBeNull();
    expect(store.readMedia(`${cancelled.id}:output`)).toBeNull();
    store.close();
  });

  it("never resurrects a deleted generation task from a stale worker snapshot", () => {
    const { store, owner } = harness();
    const stale: StoredTask = {
      id: "task-stale-write", ownerId: owner.id, visibility: "private", status: "running", mediaStatus: "none", mediaRevision: 0,
      prompt: "test", model: "seedance-test", mode: "text", ratio: "16:9", resolution: "720p", duration: 5,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    store.saveTask(stale);
    expect(store.softDeleteTask(stale.id, owner.id)).toBe(true);

    const persisted = store.saveTask({ ...stale, status: "succeeded", updatedAt: Date.now() + 1000 });

    expect(persisted.deletedAt).toBeTypeOf("number");
    expect(store.readTask(stale.id)).toBeNull();
    expect(store.readTask(stale.id, true)?.deletedAt).toBe(persisted.deletedAt);
    store.close();
  });
});
