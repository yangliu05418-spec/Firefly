import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UserStore, type UploadSession } from "./db.js";
import { migrateDatabase } from "./migrations.js";

describe("durable upload sessions", () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

  it("survives a process restart and follows the upload lifecycle", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-upload-session-"));
    directories.push(directory);
    const databasePath = path.join(directory, "firefly.db");
    migrateDatabase(databasePath);
    let store = new UserStore(databasePath);
    const owner = store.upsertFromFeishu({ openId: "upload-open", unionId: "upload-union", tenantKey: "tenant", email: "upload@dokuai.tv", name: "Uploader", avatarUrl: "" });
    const session: UploadSession = {
      id: "upload-durable", ownerId: owner.id, objectKey: "inputs/aa/upload-durable/a.png", tosUploadId: "tos-upload-1",
      fileName: "a.png", mediaKind: "image", contentType: "image/png", size: 1024, partSize: 16 * 1024 * 1024,
      partCount: 1, state: "uploading", createdAt: 1, updatedAt: 1, expiresAt: Date.now() + 86_400_000,
    };
    store.createUploadSession(session);
    store.close();

    store = new UserStore(databasePath);
    expect(store.readUploadSession(session.id)).toEqual(session);
    expect(store.updateUploadSessionState(session.id, owner.id, "finalizing")).toBe(true);
    store.upsertMedia({ id: `input:${session.id}`, ownerId: owner.id, uploadId: session.id, kind: "input", objectKey: session.objectKey, status: "uploading", fileName: session.fileName, contentType: session.contentType, size: session.size, etag: "etag", createdAt: 2, updatedAt: 2 });
    expect(store.markUploadReady(`input:${session.id}`)).toBe(true);
    expect(store.readUploadSession(session.id)?.state).toBe("completed");
    store.close();
  });

  it("purges expired sessions after the TOS multipart lifetime", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-upload-expiry-"));
    directories.push(directory);
    const databasePath = path.join(directory, "firefly.db");
    migrateDatabase(databasePath);
    const store = new UserStore(databasePath);
    const owner = store.upsertFromFeishu({ openId: "expiry-open", unionId: "expiry-union", tenantKey: "tenant", email: "expiry@dokuai.tv", name: "Uploader", avatarUrl: "" });
    const add = (id: string, state: UploadSession["state"]) => store.createUploadSession({ id, ownerId: owner.id, objectKey: `inputs/${id}.png`, tosUploadId: `tos-${id}`, fileName: `${id}.png`, mediaKind: "image", contentType: "image/png", size: 1, partSize: 1, partCount: 1, state, createdAt: 1, updatedAt: 1, expiresAt: 2 });
    add("expired-complete", "completed");
    add("expired-active", "uploading");
    expect(store.deleteExpiredUploadSessions(3)).toBe(2);
    expect(store.readUploadSession("expired-complete")).toBeNull();
    expect(store.readUploadSession("expired-active")).toBeNull();
    store.close();
  });
});
