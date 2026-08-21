import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UserStore, type MediaObject, type UserAsset } from "./db.js";
import { migrateDatabase } from "./migrations.js";

describe("asset media promotion reconciliation", () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach((directory) => {
    try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 60 }); } catch { /* best effort */ }
  }));

  const freshStore = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-asset-media-"));
    directories.push(directory);
    const databasePath = path.join(directory, "assets.db");
    migrateDatabase(databasePath);
    return new UserStore(databasePath);
  };

  const add = (store: UserStore, ownerId: string, id: string, objectKey: string, deletedAt?: number) => {
    const asset: UserAsset = {
      id: `asset-${id}`, ownerId, groupId: "group-1", uploadId: `upload-${id}`,
      name: `${id}.png`, assetType: "Image", status: "Active", category: "material",
      providerAssetId: `asset-provider-${id}`, createdAt: 1, updatedAt: 1, deletedAt
    };
    const media: MediaObject = {
      id: `media-${id}`, ownerId, uploadId: `upload-${id}`, kind: "input", objectKey,
      status: "ready", fileName: `${id}.png`, contentType: "image/png", size: 10, etag: "etag",
      createdAt: 1, updatedAt: 1
    };
    store.upsertUserAsset(asset);
    store.upsertMedia(media);
  };

  it("selects only live user assets that still point at the temporary inputs prefix", () => {
    const store = freshStore();
    const owner = store.upsertFromFeishu({
      openId: "ou_owner", unionId: "on_owner", tenantKey: "tenant-dokuai",
      email: "owner@dokuai.tv", name: "Owner", avatarUrl: ""
    });
    expect(owner.id).toBeTruthy();
    add(store, owner.id, "temporary", `inputs/aa/${owner.id}/upload-temporary/temporary.png`);
    add(store, owner.id, "durable", `assets/bb/${owner.id}/upload-durable/durable.png`);
    add(store, owner.id, "deleted", `inputs/cc/${owner.id}/upload-deleted/deleted.png`, 2);
    expect(store.listUserAssetsNeedingMediaPromotion()).toEqual([
      expect.objectContaining({ id: "asset-temporary", uploadId: "upload-temporary" })
    ]);
    store.close();
  });

  it("keeps finalizing uploads invisible until the worker marks them ready", () => {
    const store = freshStore();
    const owner = store.upsertFromFeishu({
      openId: "ou_upload", unionId: "on_upload", tenantKey: "tenant-dokuai",
      email: "upload@dokuai.tv", name: "Uploader", avatarUrl: ""
    });
    const media: MediaObject = {
      id: "input:upload-pending", ownerId: owner.id, uploadId: "upload-pending", kind: "input",
      objectKey: "inputs/aa/upload-pending/image.png", status: "uploading", fileName: "image.png",
      contentType: "image/png", size: 10, etag: "etag", createdAt: 1, updatedAt: 1
    };
    store.upsertMedia(media);
    expect(store.readUpload("upload-pending")).toBeNull();
    expect(store.readUploadState("upload-pending")).toMatchObject({ status: "uploading" });
    expect(store.listFinalizingUploads().map((item) => item.id)).toEqual(["input:upload-pending"]);
    expect(store.markUploadReady(media.id)).toBe(true);
    expect(store.readUpload("upload-pending")).toMatchObject({ status: "ready" });
    expect(store.listFinalizingUploads()).toEqual([]);
    store.close();
  });
});
