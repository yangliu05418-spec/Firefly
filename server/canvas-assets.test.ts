import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UserStore } from "./db.js";
import { canvasAssetObjectKey } from "./canvas-assets.js";

const makeUser = (store: UserStore, email: string) =>
  store.upsertFromFeishu({ openId: "ou_" + email, unionId: "on_" + email, tenantKey: "tenant-dokuai", email, name: email.split("@")[0], avatarUrl: "" });

describe("canvas asset persistence", () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach((directory) => {
    try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 60 }); } catch { /* best effort */ }
  }));

  const freshStore = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-canvas-asset-")); directories.push(directory);
    return new UserStore(path.join(directory, "assets.db"));
  };

  it("creates, reads, and transitions canvas asset status", () => {
    const store = freshStore();
    const owner = makeUser(store, "asset-owner@dokuai.tv");
    store.createCanvasProject({ id: "canvas-1", ownerId: owner.id, title: "画布", documentJson: "{}", revision: 0, createdAt: Date.now(), updatedAt: Date.now() });
    const now = Date.now();
    store.createCanvasAsset({ id: "canvas-asset-1", ownerId: owner.id, canvasId: "canvas-1", sourceUploadId: "upload-1", objectKey: "canvas/aa/owner/canvas-1/canvas-asset-1/pic.png", fileName: "pic.png", contentType: "image/png", size: 0, etag: "", status: "copying", createdAt: now, updatedAt: now });
    expect(store.readCanvasAsset("canvas-asset-1")?.status).toBe("copying");
    store.updateCanvasAsset("canvas-asset-1", { status: "ready", size: 2048, etag: "abc" });
    const ready = store.readCanvasAsset("canvas-asset-1")!;
    expect(ready.status).toBe("ready");
    expect(ready.size).toBe(2048);
    expect(ready.etag).toBe("abc");
    store.updateCanvasAsset("canvas-asset-1", { status: "failed" });
    expect(store.readCanvasAsset("canvas-asset-1")?.status).toBe("failed");
    store.close();
  });

  it("isolates assets by owner and soft-deletes them", () => {
    const store = freshStore();
    const owner = makeUser(store, "owner@dokuai.tv");
    const other = makeUser(store, "other@dokuai.tv");
    store.createCanvasProject({ id: "canvas-1", ownerId: owner.id, title: "画布", documentJson: "{}", revision: 0, createdAt: Date.now(), updatedAt: Date.now() });
    const now = Date.now();
    store.createCanvasAsset({ id: "canvas-asset-2", ownerId: owner.id, canvasId: "canvas-1", objectKey: "canvas/bb/owner/canvas-1/canvas-asset-2/a.mp4", fileName: "a.mp4", contentType: "video/mp4", size: 10, etag: "e", status: "ready", createdAt: now, updatedAt: now });
    expect(store.softDeleteCanvasAsset("canvas-asset-2", other.id)).toBe(false);
    expect(store.readCanvasAsset("canvas-asset-2")).not.toBeNull();
    store.softDeleteCanvasAsset("canvas-asset-2", owner.id);
    expect(store.readCanvasAsset("canvas-asset-2")).toBeNull();
    store.close();
  });

  it("builds durable canvas/ prefixed object keys", () => {
    const key = canvasAssetObjectKey("user-1", "canvas-9", "canvas-asset-3", "参考 图 片 (2).png");
    expect(key.startsWith("canvas/")).toBe(true);
    expect(key.includes("/user-1/canvas-9/canvas-asset-3/")).toBe(true);
    expect(key.endsWith(".png")).toBe(true);
    expect(key).toContain("参考");
    expect(key).not.toContain(" ");
    const key2 = canvasAssetObjectKey("user-1", "canvas-9", "canvas-asset-3", "参考 图 片 (2).png");
    expect(key2).toBe(key);
    expect(key.length).toBeLessThan(300);
  });
});
