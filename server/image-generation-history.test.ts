import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UserStore, type ImageGenerationTask, type MediaObject } from "./db.js";
import { migrateDatabase } from "./migrations.js";
import { publicImageGeneration } from "./image-generation-public.js";

describe("image generation history", () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

  const freshStore = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-image-history-"));
    directories.push(directory);
    const databasePath = path.join(directory, "firefly.db");
    migrateDatabase(databasePath);
    return new UserStore(databasePath);
  };

  const makeTask = (id: string, ownerId: string, createdAt: number): ImageGenerationTask => ({
    id, ownerId, model: "model-1", modelName: "Nano Banana", ratio: "1:1", resolution: "1024",
    prompt: "雨夜窗边的台灯", referenceUploadIds: [], requestedCount: 1, status: "running", items: [], failures: [],
    createdAt, updatedAt: createdAt,
  });

  it("persists, lists and completes image requests per owner", () => {
    const store = freshStore();
    const owner = store.upsertFromFeishu({ openId: "ou_owner", unionId: "on_owner", tenantKey: "tenant", email: "owner@dokuai.tv", name: "Owner", avatarUrl: "" });
    const other = store.upsertFromFeishu({ openId: "ou_other", unionId: "on_other", tenantKey: "tenant", email: "other@dokuai.tv", name: "Other", avatarUrl: "" });
    store.createImageGeneration({ ...makeTask("image-task-1", owner.id, 10), referenceUploadIds: ["upload-reference-1234567890"] });
    store.createImageGeneration(makeTask("image-task-2", other.id, 20));

    store.updateImageGeneration("image-task-1", owner.id, { status: "succeeded", items: [{ mediaId: "gen-1" }], failures: [] });
    expect(store.listImageGenerations(owner.id).map((task) => task.id)).toEqual(["image-task-1"]);
    expect(store.listImageGenerations(other.id).map((task) => task.id)).toEqual(["image-task-2"]);
    expect(publicImageGeneration(store.readImageGeneration("image-task-1")!)).not.toHaveProperty("ownerId");
    expect(store.readImageGeneration("image-task-1")).toMatchObject({ status: "succeeded", referenceUploadIds: ["upload-reference-1234567890"], items: [{ mediaId: "gen-1" }] });
    store.close();
  });

  it("atomically reuses a client request id without consuming another slot or duplicating its outbox intent", () => {
    const store = freshStore();
    const owner = store.upsertFromFeishu({ openId: "ou_admit", unionId: "on_admit", tenantKey: "tenant", email: "admit@dokuai.tv", name: "Admit", avatarUrl: "" });
    const first = makeTask("image-task-idempotent", owner.id, 10);
    const intent = { queueName: "image-generation" as const, jobId: first.id, jobName: "generate-image", payload: { ownerId: owner.id } };

    expect(store.admitImageGenerationWithinLimit(first, 1, intent)).toMatchObject({ status: "created", task: { prompt: "雨夜窗边的台灯" } });
    expect(store.admitImageGenerationWithinLimit({ ...first, prompt: "不应覆盖第一次请求", updatedAt: 20 }, 1, intent)).toMatchObject({
      status: "existing", task: { prompt: "雨夜窗边的台灯" },
    });
    expect(store.asyncJobOutboxStats()).toMatchObject({ pending: 1, dispatched: 0 });
    expect(store.admitImageGenerationWithinLimit(makeTask("image-task-over-limit", owner.id, 30), 1)).toMatchObject({ status: "limit" });
    store.close();
  });

  it("does not resurrect a soft-deleted request id", () => {
    const store = freshStore();
    const owner = store.upsertFromFeishu({ openId: "ou_deleted", unionId: "on_deleted", tenantKey: "tenant", email: "deleted@dokuai.tv", name: "Deleted", avatarUrl: "" });
    const task = makeTask("image-task-deleted-id", owner.id, 10);
    store.createImageGeneration(task);
    expect(store.softDeleteImageGeneration(task.id, owner.id)).toBe(true);

    expect(store.admitImageGenerationWithinLimit({ ...task, createdAt: 20, updatedAt: 20 }, 1)).toMatchObject({
      status: "existing", task: { id: task.id, deletedAt: expect.any(Number) },
    });
    store.close();
  });

  it("soft deletes the bundle and schedules its generated media for deletion", () => {
    const store = freshStore();
    const owner = store.upsertFromFeishu({ openId: "ou_owner_2", unionId: "on_owner_2", tenantKey: "tenant", email: "owner2@dokuai.tv", name: "Owner", avatarUrl: "" });
    const task = makeTask("image-task-delete", owner.id, 10);
    const media: MediaObject = { id: "gen-delete", ownerId: owner.id, kind: "generated", objectKey: "generated/aa/gen-delete.png", status: "ready", fileName: "image.png", contentType: "image/png", size: 12, etag: "etag", createdAt: 10, updatedAt: 10 };
    store.upsertMedia(media);
    store.createImageGeneration({ ...task, status: "succeeded", items: [{ mediaId: media.id }] });

    expect(store.softDeleteImageGeneration(task.id, owner.id)).toBe(true);
    expect(store.readImageGeneration(task.id)).toBeNull();
    expect(store.readMedia(media.id)?.status).toBe("delete_pending");
    store.close();
  });
});
