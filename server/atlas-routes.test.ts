import fs from "node:fs";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAtlasRouter, type AtlasAssetPresentation, type AtlasImportSource, type AtlasStorageDependencies, type AtlasVerifiedObject } from "./atlas-routes.js";
import { AtlasStore, type AtlasTransferPart } from "./atlas-store.js";
import { UserStore } from "./db.js";
import { migrateDatabase } from "./migrations.js";

describe("Atlas project API", () => {
  // WHATWG fetch rejects a fixed set of unsafe ports. Windows may assign one
  // of them to listen(0), which makes an otherwise valid integration test fail
  // before the request reaches Express.
  const fetchForbiddenPorts = new Set([
    1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69,
    77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119,
    123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515,
    526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990,
    993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000,
    6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
  ]);
  const directories: string[] = [];
  const stores: AtlasStore[] = [];
  const servers: ReturnType<express.Express["listen"]>[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
    stores.splice(0).forEach((store) => store.close());
    directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
  });

  const setup = async (options: {
    partSize?: number;
    resolveSource?: (ownerId: string, sourceType: string, sourceId: string) => AtlasImportSource | null;
    describeAsset?: (assetId: string) => AtlasAssetPresentation;
    registerGlobalAsset?: (input: { id: string; objectKey: string; assetType: "Video"; status: "Active" }) => void | Promise<void>;
  } = {}) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-atlas-routes-"));
    directories.push(directory);
    const databasePath = path.join(directory, "firefly.db");
    migrateDatabase(databasePath);
    const users = new UserStore(databasePath);
    const owner = users.upsertFromFeishu({ openId: "routes-owner", unionId: "union-owner", tenantKey: "tenant", email: "routes-owner@dokuai.tv", name: "Owner", avatarUrl: "owner.png" });
    const other = users.upsertFromFeishu({ openId: "routes-other", unionId: "union-other", tenantKey: "tenant", email: "routes-other@dokuai.tv", name: "Other", avatarUrl: "other.png" });
    users.close();
    const store = new AtlasStore(databasePath);
    stores.push(store);

    let uploadSequence = 0;
    let idSequence = 0;
    const objects = new Map<string, AtlasVerifiedObject>();
    const uploads = new Map<string, string>();
    const uploadedParts = new Map<string, AtlasTransferPart[]>();
    const deleted: string[] = [];
    const aborted: { objectKey: string; uploadId: string }[] = [];
    const storage: AtlasStorageDependencies = {
      createMultipartUpload: async ({ objectKey }) => {
        const id = `tos-upload-${++uploadSequence}`;
        uploads.set(id, objectKey);
        return id;
      },
      signUploadPart: ({ objectKey, uploadId, partNumber }) => `https://tos.example/${encodeURIComponent(objectKey)}?uploadId=${uploadId}&part=${partNumber}`,
      listParts: async ({ uploadId }) => {
        if (!uploads.has(uploadId)) throw Object.assign(new Error("multipart upload no longer exists"), { statusCode: 404, code: "NoSuchUpload" });
        return uploadedParts.get(uploadId) ?? [];
      },
      completeMultipartUpload: async ({ objectKey, uploadId, parts }: { objectKey: string; uploadId: string; parts: AtlasTransferPart[] }) => {
        if (uploads.get(uploadId) !== objectKey) throw new Error("unknown multipart upload");
        uploadedParts.set(uploadId, parts);
        uploads.delete(uploadId);
      },
      abortMultipartUpload: async (input) => { aborted.push(input); },
      deleteObject: async (objectKey) => { objects.delete(objectKey); deleted.push(objectKey); },
      verifyObject: async (objectKey) => {
        const object = objects.get(objectKey);
        if (!object) throw Object.assign(new Error("object not ready"), { statusCode: 404, code: "NoSuchKey" });
        return object;
      },
      copyObject: async ({ sourceObjectKey, destinationObjectKey, contentType }) => {
        const source = objects.get(sourceObjectKey);
        if (!source) throw new Error("source object missing");
        objects.set(destinationObjectKey, { ...source, contentType });
      },
      signedObjectUrl: (objectKey, { attachment }) => `https://tos.example/${encodeURIComponent(objectKey)}?attachment=${attachment ? 1 : 0}`,
      enqueueDelete: (objectKey) => { deleted.push(objectKey); },
    };

    const app = express();
    app.use(express.json());
    app.use("/api/atlas", createAtlasRouter({
      store,
      requireAuth: (req, res, next) => {
        const selected = req.header("x-test-user") === other.id ? other : owner;
        res.locals.user = { id: selected.id, email: selected.email, name: selected.name, avatarUrl: selected.avatarUrl };
        next();
      },
      storage,
      resolveImportSource: async ({ ownerId, sourceType, sourceId }) => options.resolveSource?.(ownerId, sourceType, sourceId) ?? null,
      describeAsset: (asset) => options.describeAsset?.(asset.id) ?? {},
      registerGlobalAsset: options.registerGlobalAsset,
      partSize: options.partSize ?? 4,
      now: () => 1_000,
      randomId: () => `atlas-id-${++idSequence}`,
    }));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: error instanceof Error ? error.message : "unexpected" });
    });
    let server: ReturnType<express.Express["listen"]>;
    let port = 0;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      port = (server.address() as AddressInfo).port;
      if (!fetchForbiddenPorts.has(port)) break;
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      port = 0;
    }
    if (!port) throw new Error("Unable to allocate a fetch-safe test port");
    servers.push(server!);
    const request = async (url: string, init: RequestInit = {}, requester = owner.id) => fetch(`http://127.0.0.1:${port}/api/atlas${url}`, {
      ...init,
      headers: { "content-type": "application/json", "x-test-user": requester, ...init.headers },
      redirect: "manual",
    });
    const json = async <T = Record<string, unknown>>(response: Response) => response.json() as Promise<T>;
    return { store, owner, other, objects, uploads, uploadedParts, deleted, aborted, storage, request, json };
  };

  it("reuses Firefly identity and hides projects across users", async () => {
    const api = await setup();
    const bootstrap = await api.request("/bootstrap");
    expect(await api.json(bootstrap)).toMatchObject({ user: { id: api.owner.id }, capabilities: { agent: true, partSize: 4 } });

    const created = await api.request("/projects", { method: "POST", body: JSON.stringify({ title: "Atlas剪辑" }) });
    expect(created.status).toBe(201);
    const project = await api.json<{ id: string; revision: number }>(created);
    expect(project.revision).toBe(0);
    expect(await api.json<{ items: unknown[] }>(await api.request("/projects"))).toMatchObject({ items: [{ id: project.id }] });
    expect(await api.json<{ items: unknown[] }>(await api.request("/projects", {}, api.other.id))).toEqual({ items: [] });
    expect((await api.request(`/projects/${project.id}`, {}, api.other.id)).status).toBe(404);

    expect((await api.request(`/projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ title: "过期写入", expectedRevision: 1 }) })).status).toBe(409);
    const renamed = await api.request(`/projects/${project.id}`, { method: "PUT", body: JSON.stringify({ title: "正式片名", expectedRevision: 0 }) });
    expect(await api.json(renamed)).toMatchObject({ title: "正式片名", revision: 0 });
    expect((await api.request(`/projects/${project.id}`, { method: "DELETE" }, api.other.id)).status).toBe(404);
    expect((await api.request(`/projects/${project.id}`, { method: "DELETE" })).status).toBe(204);
  });

  it("binds one durable Firefly generation session and isolates destination recovery", async () => {
    const api = await setup();
    const project = await api.json<{ id: string }>(await api.request("/projects", {
      method: "POST", body: JSON.stringify({ title: "生成投递" }),
    }));
    const first = await api.request(`/projects/${project.id}/generation-session`, { method: "POST" });
    expect(first.status).toBe(201);
    const session = await api.json<{ sessionId: string; projectId: string }>(first);
    expect(session.projectId).toBe(project.id);
    expect(await api.json(await api.request(`/projects/${project.id}/generation-session`, { method: "POST" }))).toEqual(session);
    expect((await api.request(`/projects/${project.id}/generation-session`, { method: "POST" }, api.other.id)).status).toBe(404);

    api.store.createGenerationDestinations({
      ownerId: api.owner.id, projectId: project.id, sessionId: session.sessionId,
      sourceType: "video", sourceId: "video-task-1",
      outputs: [{ id: "destination-1", outputKey: "video" }], now: 1_000,
    });
    expect(api.store.claimGenerationDestination("destination-1", 1_001)).toMatchObject({ status: "copying" });
    api.store.releaseGenerationDestination("destination-1", undefined, "TOS_TEMPORARY_ERROR", 1_002);
    const list = await api.json<{ items: Array<{ id: string; status: string }> }>(await api.request(`/projects/${project.id}/generation-destinations`));
    expect(list.items).toEqual([expect.objectContaining({ id: "destination-1", status: "failed" })]);
    expect((await api.request(`/projects/${project.id}/generation-destinations`, {}, api.other.id)).status).toBe(404);
    expect((await api.request(`/projects/${project.id}/generation-destinations/destination-1/retry`, { method: "POST" }, api.other.id)).status).toBe(404);
    const retry = await api.request(`/projects/${project.id}/generation-destinations/destination-1/retry`, { method: "POST" });
    expect(retry.status).toBe(202);
    expect(await api.json(retry)).toMatchObject({ id: "destination-1", status: "pending" });
  });

  it("returns a conflict for a second editor and supports renew, release and takeover", async () => {
    const api = await setup();
    const project = await api.json<{ id: string }>(await api.request("/projects", { method: "POST", body: JSON.stringify({ title: "租约项目" }) }));
    const first = await api.request(`/projects/${project.id}/lease`, { method: "POST", body: JSON.stringify({ deviceId: "browser-tab-a" }) });
    const lease = await api.json<{ token: string }>(first);
    expect((await api.request(`/projects/${project.id}/lease`, { method: "POST", body: JSON.stringify({ deviceId: "browser-tab-a" }) })).status).toBe(409);
    expect(first.status).toBe(201);
    expect((await api.request(`/projects/${project.id}/lease`, { method: "POST", body: JSON.stringify({ deviceId: "browser-tab-b" }) })).status).toBe(409);
    expect((await api.request(`/projects/${project.id}/lease`, { method: "PUT", body: JSON.stringify({ token: lease.token }) })).status).toBe(200);
    expect((await api.request(`/projects/${project.id}/lease`, { method: "PUT", body: JSON.stringify({ token: lease.token }) }, api.other.id)).status).toBe(404);
    expect((await api.request(`/projects/${project.id}/lease`, { method: "POST", body: JSON.stringify({ deviceId: "browser-tab-b", takeover: true }) })).status).toBe(201);
    expect((await api.request(`/projects/${project.id}/lease`, { method: "DELETE", body: JSON.stringify({ token: lease.token }) })).status).toBe(204);
  });

  it("uploads, verifies and restores an immutable cloud checkpoint", async () => {
    const api = await setup({ partSize: 4 });
    const project = await api.json<{ id: string }>(await api.request("/projects", { method: "POST", body: JSON.stringify({ title: "恢复项目" }) }));
    const lease = await api.json<{ token: string }>(await api.request(`/projects/${project.id}/lease`, { method: "POST", body: JSON.stringify({ deviceId: "browser-tab-checkpoint" }) }));
    const digest = "a".repeat(64);
    const started = await api.request(`/projects/${project.id}/checkpoints`, {
      method: "POST", body: JSON.stringify({ expectedRevision: 0, leaseToken: lease.token, digest, size: 8 }),
    });
    expect(started.status).toBe(201);
    const checkpoint = await api.json<{ checkpointId: string; transfer: { id: string }; parts: { partNumber: number }[] }>(started);
    expect(checkpoint.parts.map((part) => part.partNumber)).toEqual([1, 2]);
    const transfer = api.store.readTransferForVersion(checkpoint.checkpointId, api.owner.id)!;
    api.objects.set(transfer.objectKey, { size: 8, contentType: "application/gzip", etag: "checkpoint-etag", metadata: { sha256: digest } });
    const completed = await api.request(`/projects/${project.id}/checkpoints/${checkpoint.checkpointId}/complete`, {
      method: "POST", body: JSON.stringify({ leaseToken: lease.token, parts: [{ partNumber: 1, etag: "p1" }, { partNumber: 2, etag: "p2" }] }),
    });
    expect(await api.json(completed)).toMatchObject({ checkpointId: checkpoint.checkpointId, revision: 1, status: "ready" });
    expect(api.store.readProject(project.id, api.owner.id)?.revision).toBe(1);
    const download = await api.request(`/projects/${project.id}/checkpoint`);
    expect(download.status).toBe(302);
    expect(download.headers.get("location")).toContain("attachment=0");
    expect((await api.request(`/projects/${project.id}/checkpoint`, {}, api.other.id)).status).toBe(404);
  });

  it("recovers a checkpoint when CompleteMultipart succeeded but its response and UploadId were lost", async () => {
    const api = await setup({ partSize: 4 });
    const project = await api.json<{ id: string }>(await api.request("/projects", { method: "POST", body: JSON.stringify({ title: "响应丢失" }) }));
    const lease = await api.json<{ token: string }>(await api.request(`/projects/${project.id}/lease`, { method: "POST", body: JSON.stringify({ deviceId: "checkpoint-loss-tab" }) }));
    const digest = "b".repeat(64);
    const started = await api.json<{ checkpointId: string }>(await api.request(`/projects/${project.id}/checkpoints`, {
      method: "POST", body: JSON.stringify({ expectedRevision: 0, leaseToken: lease.token, digest, size: 8 }),
    }));
    const transfer = api.store.readTransferForVersion(started.checkpointId, api.owner.id)!;
    const parts = [{ partNumber: 1, etag: "p1" }, { partNumber: 2, etag: "p2" }];
    api.store.markTransferVerifying(transfer.id, api.owner.id, parts, 1_000);
    api.uploads.delete(transfer.tosUploadId!);
    api.objects.set(transfer.objectKey, { size: 8, contentType: "application/gzip", etag: "checkpoint-etag", metadata: { sha256: digest } });

    const recovered = await api.request(`/projects/${project.id}/checkpoints/${started.checkpointId}/complete`, {
      method: "POST", body: JSON.stringify({ leaseToken: lease.token, parts }),
    });
    expect(recovered.status).toBe(200);
    expect(await api.json(recovered)).toMatchObject({ checkpointId: started.checkpointId, revision: 1, status: "ready" });
  });

  it("recovers an errored uploading checkpoint after a lease takeover without blocking on the old digest", async () => {
    const api = await setup();
    const project = await api.json<{ id: string }>(await api.request("/projects", { method: "POST", body: JSON.stringify({ title: "P0恢复" }) }));
    const oldLease = await api.json<{ token: string }>(await api.request(`/projects/${project.id}/lease`, {
      method: "POST", body: JSON.stringify({ deviceId: "old-tab-checkpoint" }),
    }));
    const firstResponse = await api.request(`/projects/${project.id}/checkpoints`, {
      method: "POST", body: JSON.stringify({ expectedRevision: 0, leaseToken: oldLease.token, digest: "a".repeat(64), size: 8 }),
    });
    expect(firstResponse.status).toBe(201);
    const first = await api.json<{ checkpointId: string; transfer: { id: string } }>(firstResponse);
    const oldTransfer = api.store.readTransfer(first.transfer.id, api.owner.id)!;
    api.store.recordTransferError(oldTransfer.id, api.owner.id, "SignatureDoesNotMatch", 1_001);
    const newLease = await api.json<{ token: string }>(await api.request(`/projects/${project.id}/lease`, {
      method: "POST", body: JSON.stringify({ deviceId: "new-tab-checkpoint", takeover: true }),
    }));
    const recoveredResponse = await api.request(`/projects/${project.id}/checkpoints`, {
      method: "POST", body: JSON.stringify({ expectedRevision: 0, leaseToken: newLease.token, digest: "b".repeat(64), size: 9 }),
    });
    expect(recoveredResponse.status).toBe(201);
    const recovered = await api.json<{ checkpointId: string; transfer: { id: string } }>(recoveredResponse);
    expect(recovered.checkpointId).toBe(first.checkpointId);
    expect(api.aborted).toContainEqual({ objectKey: oldTransfer.objectKey, uploadId: oldTransfer.tosUploadId });
    expect(api.store.readVersion(first.checkpointId, api.owner.id)).toMatchObject({
      status: "uploading", leaseGeneration: 2, digest: "b".repeat(64), size: 9,
    });
    expect(api.store.readTransfer(recovered.transfer.id, api.owner.id)).toMatchObject({ status: "uploading", error: undefined });
  });

  it("reuses the current multipart after a transient checkpoint error when the payload is unchanged", async () => {
    const api = await setup({ partSize: 4 });
    const project = await api.json<{ id: string }>(await api.request("/projects", {
      method: "POST", body: JSON.stringify({ title: "断点续传" }),
    }));
    const lease = await api.json<{ token: string }>(await api.request(`/projects/${project.id}/lease`, {
      method: "POST", body: JSON.stringify({ deviceId: "same-tab-retry" }),
    }));
    const body = { expectedRevision: 0, leaseToken: lease.token, digest: "a".repeat(64), size: 8 };
    const first = await api.json<{ checkpointId: string; transfer: { id: string } }>(await api.request(
      `/projects/${project.id}/checkpoints`, { method: "POST", body: JSON.stringify(body) },
    ));
    const originalUploadId = api.store.readTransfer(first.transfer.id, api.owner.id)!.tosUploadId;
    api.store.recordTransferError(first.transfer.id, api.owner.id, "SignatureDoesNotMatch", 1_001);

    const retry = await api.request(`/projects/${project.id}/checkpoints`, {
      method: "POST", body: JSON.stringify(body),
    });
    expect(retry.status).toBe(200);
    expect(await api.json(retry)).toMatchObject({
      checkpointId: first.checkpointId,
      transfer: { id: first.transfer.id, status: "uploading" },
    });
    expect(api.store.readTransfer(first.transfer.id, api.owner.id)?.tosUploadId).toBe(originalUploadId);
    expect(api.aborted).toEqual([]);
    expect(api.deleted).toEqual([]);
    expect(api.uploads.size).toBe(1);
  });

  it("returns 425 for a healthy stale upload and fences a late completion after reset claim", async () => {
    const api = await setup();
    const project = await api.json<{ id: string }>(await api.request("/projects", { method: "POST", body: JSON.stringify({ title: "并发围栏" }) }));
    const oldLease = await api.json<{ token: string }>(await api.request(`/projects/${project.id}/lease`, {
      method: "POST", body: JSON.stringify({ deviceId: "old-completing-tab" }),
    }));
    const first = await api.json<{ checkpointId: string; transfer: { id: string } }>(await api.request(`/projects/${project.id}/checkpoints`, {
      method: "POST", body: JSON.stringify({ expectedRevision: 0, leaseToken: oldLease.token, digest: "a".repeat(64), size: 8 }),
    }));
    const transfer = api.store.readTransfer(first.transfer.id, api.owner.id)!;
    const parts = [{ partNumber: 1, etag: "p1" }, { partNumber: 2, etag: "p2" }];
    api.uploadedParts.set(transfer.tosUploadId!, parts);
    expect(api.store.markTransferVerifying(transfer.id, api.owner.id, parts, 1_001)).toBe(true);
    const newLease = await api.json<{ token: string }>(await api.request(`/projects/${project.id}/lease`, {
      method: "POST", body: JSON.stringify({ deviceId: "new-waiting-tab", takeover: true }),
    }));
    const waiting = await api.request(`/projects/${project.id}/checkpoints`, {
      method: "POST", body: JSON.stringify({ expectedRevision: 0, leaseToken: newLease.token, digest: "b".repeat(64), size: 9 }),
    });
    expect(waiting.status).toBe(425);
    expect(await api.json(waiting)).toMatchObject({ code: "ATLAS_CHECKPOINT_STALE_IN_FLIGHT" });
    expect(api.aborted).toEqual([]);
    expect(api.deleted).toEqual([]);

    api.store.recordTransferError(transfer.id, api.owner.id, "SignatureDoesNotMatch", 1_002);
    expect(api.store.reserveCheckpoint({
      id: "unused", transferId: "unused", ownerId: api.owner.id, projectId: project.id, expectedRevision: 0,
      objectKey: transfer.objectKey, digest: "b".repeat(64), size: 9, partSize: 4, partCount: 3,
      now: 1_003, expiresAt: 100_000, leaseTokenHash: crypto.createHash("sha256").update(newLease.token).digest("hex"),
    })).toMatchObject({ status: "recoverable" });
    expect(api.store.claimFailedCheckpointReset({
      versionId: first.checkpointId, transferId: transfer.id, ownerId: api.owner.id, projectId: project.id,
      expectedRevision: 0, now: 1_004, leaseTokenHash: crypto.createHash("sha256").update(newLease.token).digest("hex"), claimToken: "winner",
    })).toMatchObject({ status: "ok" });
    const complete = vi.spyOn(api.storage, "completeMultipartUpload");
    const late = await api.request(`/projects/${project.id}/checkpoints/${first.checkpointId}/complete`, {
      method: "POST", body: JSON.stringify({ leaseToken: newLease.token, parts }),
    });
    expect(late.status).toBe(409);
    expect(await api.json(late)).toMatchObject({ code: "ATLAS_CHECKPOINT_STATE_CHANGED" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("fails closed when checkpoint SHA-256 metadata is absent and recovers after authoritative metadata appears", async () => {
    const api = await setup({ partSize: 4 });
    const project = await api.json<{ id: string }>(await api.request("/projects", { method: "POST", body: JSON.stringify({ title: "摘要校验" }) }));
    const lease = await api.json<{ token: string }>(await api.request(`/projects/${project.id}/lease`, { method: "POST", body: JSON.stringify({ deviceId: "checkpoint-digest-tab" }) }));
    const digest = "c".repeat(64);
    const started = await api.json<{ checkpointId: string }>(await api.request(`/projects/${project.id}/checkpoints`, {
      method: "POST", body: JSON.stringify({ expectedRevision: 0, leaseToken: lease.token, digest, size: 4 }),
    }));
    const transfer = api.store.readTransferForVersion(started.checkpointId, api.owner.id)!;
    const parts = [{ partNumber: 1, etag: "p1" }];
    api.objects.set(transfer.objectKey, { size: 4, contentType: "application/gzip", etag: "checkpoint-etag" });
    const rejected = await api.request(`/projects/${project.id}/checkpoints/${started.checkpointId}/complete`, {
      method: "POST", body: JSON.stringify({ leaseToken: lease.token, parts }),
    });
    expect(rejected.status).toBe(422);
    expect(await api.json(rejected)).toMatchObject({ code: "ATLAS_CHECKPOINT_DIGEST_MISMATCH" });
    expect(api.store.readProject(project.id, api.owner.id)?.revision).toBe(0);

    api.objects.set(transfer.objectKey, { size: 4, contentType: "application/gzip", etag: "checkpoint-etag", metadata: { sha256: digest } });
    expect((await api.request(`/projects/${project.id}/checkpoints/${started.checkpointId}/complete`, {
      method: "POST", body: JSON.stringify({ leaseToken: lease.token, parts }),
    })).status).toBe(200);
  });

  it("supports resumable direct uploads and stable owned media redirects", async () => {
    const api = await setup({ partSize: 4 });
    const project = await api.json<{ id: string }>(await api.request("/projects", { method: "POST", body: JSON.stringify({ title: "上传项目" }) }));
    const started = await api.request(`/projects/${project.id}/uploads`, {
      method: "POST", body: JSON.stringify({ name: "镜头 01.mp4", kind: "video", contentType: "video/mp4", size: 10 }),
    });
    expect(started.status).toBe(201);
    const upload = await api.json<{ asset: { id: string }; transfer: { id: string; partCount: number }; parts: { partNumber: number }[] }>(started);
    expect(upload.transfer.partCount).toBe(3);
    expect(upload.parts).toHaveLength(3);
    const activeTransfer = api.store.readTransfer(upload.transfer.id, api.owner.id)!;
    api.uploadedParts.set(activeTransfer.tosUploadId!, [{ partNumber: 1, etag: "p1-server" }]);
    expect((await api.request(`/projects/${project.id}/uploads/${upload.transfer.id}/parts/sign`, {
      method: "POST", body: JSON.stringify({ partNumbers: [3, 3] }),
    }, api.other.id)).status).toBe(404);
    const signed = await api.request(`/projects/${project.id}/uploads/${upload.transfer.id}/parts/sign`, {
      method: "POST", body: JSON.stringify({ partNumbers: [3, 2, 3] }),
    });
    expect(await api.json<{ completedParts: { partNumber: number }[]; parts: { partNumber: number }[] }>(signed)).toMatchObject({
      completedParts: [{ partNumber: 1 }], parts: [{ partNumber: 2 }, { partNumber: 3 }],
    });
    expect(await api.json(await api.request(`/projects/${project.id}/uploads/${upload.transfer.id}`))).toMatchObject({ completedParts: [{ partNumber: 1 }] });

    const stored = api.store.readAsset(upload.asset.id, api.owner.id)!;
    api.objects.set(stored.objectKey, { size: 10, contentType: "video/mp4", etag: "video-etag" });
    const complete = await api.request(`/projects/${project.id}/uploads/${upload.transfer.id}/complete`, {
      method: "POST", body: JSON.stringify({ parts: [
        { partNumber: 3, etag: "p3" }, { partNumber: 1, etag: "p1" }, { partNumber: 2, etag: "p2" },
      ] }),
    });
    expect(await api.json(complete)).toMatchObject({ id: upload.asset.id, status: "ready", mediaUrl: `/api/atlas/project-assets/${upload.asset.id}/media` });
    const media = await api.request(`/project-assets/${upload.asset.id}/media?download=1`);
    expect(media.status).toBe(302);
    expect(media.headers.get("location")).toContain("attachment=1");
    expect((await api.request(`/project-assets/${upload.asset.id}/media`, {}, api.other.id)).status).toBe(404);
  });

  it("reconciles an uploaded asset before ListParts after a lost completion response", async () => {
    const api = await setup({ partSize: 4 });
    const project = await api.json<{ id: string }>(await api.request("/projects", { method: "POST", body: JSON.stringify({ title: "素材恢复" }) }));
    const started = await api.json<{ asset: { id: string }; transfer: { id: string } }>(await api.request(`/projects/${project.id}/uploads`, {
      method: "POST", body: JSON.stringify({ name: "frame.png", kind: "image", contentType: "image/png", size: 4 }),
    }));
    const transfer = api.store.readTransfer(started.transfer.id, api.owner.id)!;
    const parts = [{ partNumber: 1, etag: "p1" }];
    api.store.markTransferVerifying(transfer.id, api.owner.id, parts, 1_000);
    api.uploads.delete(transfer.tosUploadId!);
    api.objects.set(transfer.objectKey, { size: 4, contentType: "image/png", etag: "image-etag" });
    const recovered = await api.request(`/projects/${project.id}/uploads/${transfer.id}/complete`, {
      method: "POST", body: JSON.stringify({ parts }),
    });
    expect(recovered.status).toBe(200);
    expect(await api.json(recovered)).toMatchObject({ id: started.asset.id, status: "ready" });
  });

  it("retains and resumes the same multipart upload when initial signing fails", async () => {
    const api = await setup({ partSize: 4 });
    const project = await api.json<{ id: string }>(await api.request("/projects", { method: "POST", body: JSON.stringify({ title: "清理上传" }) }));
    const intent = { name: "clip.mp4", kind: "video", contentType: "video/mp4", size: 8, idempotencyKey: "upload-intent-0001" };
    api.storage.signUploadPart = async () => { throw new Error("signing unavailable"); };
    const response = await api.request(`/projects/${project.id}/uploads`, {
      method: "POST", body: JSON.stringify(intent),
    });
    expect(response.status).toBe(201);
    const deferred = await api.json<{ uploadId: string; initialSigningPending: boolean; parts: unknown[] }>(response);
    expect(deferred).toMatchObject({ initialSigningPending: true, parts: [] });
    expect(api.aborted).toHaveLength(0);
    const [durable] = api.store.listExpiredTransfers(Number.MAX_SAFE_INTEGER);
    expect(durable).toMatchObject({ status: "uploading", tosUploadId: "tos-upload-1" });
    api.storage.signUploadPart = ({ objectKey, uploadId, partNumber }) => `https://tos.example/${encodeURIComponent(objectKey)}?uploadId=${uploadId}&part=${partNumber}`;
    expect((await api.request(`/projects/${project.id}/uploads/${deferred.uploadId}/parts/sign`, {
      method: "POST", body: JSON.stringify({ partNumbers: [1, 2] }),
    })).status).toBe(200);
    const resumed = await api.request(`/projects/${project.id}/uploads`, { method: "POST", body: JSON.stringify(intent) });
    expect(resumed.status).toBe(200);
    expect(await api.json(resumed)).toMatchObject({ uploadId: durable!.id, transfer: { status: "uploading" } });
    expect(api.uploads.size).toBe(1);
  });

  it("makes upload initialization idempotent and bounds active sessions per user", async () => {
    const api = await setup({ partSize: 4 });
    const project = await api.json<{ id: string }>(await api.request("/projects", { method: "POST", body: JSON.stringify({ title: "并发上传" }) }));
    const firstBody = { name: "first.png", kind: "image", contentType: "image/png", size: 4, idempotencyKey: "stable-upload-intent-1" };
    const first = await api.json<{ uploadId: string; asset: { id: string } }>(await api.request(`/projects/${project.id}/uploads`, {
      method: "POST", body: JSON.stringify(firstBody),
    }));
    const repeatedResponse = await api.request(`/projects/${project.id}/uploads`, { method: "POST", body: JSON.stringify(firstBody) });
    expect(repeatedResponse.status).toBe(200);
    expect(await api.json(repeatedResponse)).toMatchObject({ uploadId: first.uploadId, asset: { id: first.asset.id } });
    expect(api.uploads.size).toBe(1);

    const conflicting = await api.request(`/projects/${project.id}/uploads`, {
      method: "POST", body: JSON.stringify({ ...firstBody, name: "different.png" }),
    });
    expect(conflicting.status).toBe(409);
    expect(await api.json(conflicting)).toMatchObject({ code: "ATLAS_UPLOAD_INTENT_CONFLICT" });

    for (let index = 2; index <= 8; index += 1) {
      expect((await api.request(`/projects/${project.id}/uploads`, {
        method: "POST", body: JSON.stringify({
          name: `asset-${index}.png`, kind: "image", contentType: "image/png", size: 4,
          idempotencyKey: `stable-upload-intent-${index}`,
        }),
      })).status).toBe(201);
    }
    const limited = await api.request(`/projects/${project.id}/uploads`, {
      method: "POST", body: JSON.stringify({
        name: "ninth.png", kind: "image", contentType: "image/png", size: 4,
        idempotencyKey: "stable-upload-intent-9",
      }),
    });
    expect(limited.status).toBe(429);
    expect(await api.json(limited)).toMatchObject({ code: "ATLAS_UPLOAD_CONCURRENCY_LIMIT" });
  });

  it("converges concurrent creation of the same upload intent on one durable TOS session", async () => {
    const api = await setup({ partSize: 4 });
    const project = await api.json<{ id: string }>(await api.request("/projects", { method: "POST", body: JSON.stringify({ title: "并发意图" }) }));
    let arrivals = 0;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    api.storage.createMultipartUpload = async ({ objectKey }) => {
      const uploadId = `race-upload-${++arrivals}`;
      api.uploads.set(uploadId, objectKey);
      if (arrivals === 2) releaseBarrier();
      await barrier;
      return uploadId;
    };
    const body = JSON.stringify({
      name: "same.mov", kind: "video", contentType: "video/quicktime", size: 8,
      idempotencyKey: "same-concurrent-upload-intent",
    });
    const [left, right] = await Promise.all([
      api.request(`/projects/${project.id}/uploads`, { method: "POST", body }),
      api.request(`/projects/${project.id}/uploads`, { method: "POST", body }),
    ]);
    expect([left.status, right.status].sort()).toEqual([200, 201]);
    const [leftPayload, rightPayload] = await Promise.all([
      api.json<{ uploadId: string; transfer: { tosUploadId?: string } }>(left),
      api.json<{ uploadId: string; transfer: { tosUploadId?: string } }>(right),
    ]);
    expect(rightPayload.uploadId).toBe(leftPayload.uploadId);
    expect(rightPayload.transfer.tosUploadId).toBe(leftPayload.transfer.tosUploadId);
    expect(api.aborted).toHaveLength(1);
    expect(api.aborted[0]!.uploadId).not.toBe(leftPayload.transfer.tosUploadId);
  });

  it("accepts an unknown-size streaming export, resumes TOS parts and registers it globally once", async () => {
    const registered: { id: string; objectKey: string; assetType: "Video"; status: "Active" }[] = [];
    const api = await setup({ partSize: 4, registerGlobalAsset: (input) => { registered.push(input); } });
    const project = await api.json<{ id: string }>(await api.request("/projects", { method: "POST", body: JSON.stringify({ title: "导出项目" }) }));
    const started = await api.request(`/projects/${project.id}/uploads`, {
      method: "POST", body: JSON.stringify({ name: "result.mp4", kind: "video", contentType: "video/mp4", size: null, purpose: "export" }),
    });
    expect(started.status).toBe(201);
    const upload = await api.json<{ uploadId: string; partSize: number; asset: { id: string }; transfer: { partCount: number } }>(started);
    expect(upload).toMatchObject({ partSize: 4, transfer: { partCount: 0 } });
    const transfer = api.store.readTransfer(upload.uploadId, api.owner.id)!;
    expect(transfer.objectKey).toMatch(new RegExp(`^atlas/exports/[a-f0-9]{2}/${api.owner.id}/${project.id}/${upload.asset.id}/result\\.mp4$`));
    expect((await api.request(`/projects/${project.id}/uploads/${upload.uploadId}/parts/sign`, {
      method: "POST", body: JSON.stringify({ partNumbers: [1, 2] }),
    })).status).toBe(200);
    api.uploadedParts.set(transfer.tosUploadId!, [{ partNumber: 1, etag: "one" }, { partNumber: 2, etag: "two" }]);
    api.objects.set(transfer.objectKey, { size: 6, contentType: "video/mp4", etag: "export-etag" });
    const completed = await api.request(`/projects/${project.id}/uploads/${upload.uploadId}/complete`, {
      method: "POST", body: JSON.stringify({ parts: [{ partNumber: 1, etag: "lost-response" }], totalSize: 6, purpose: "export" }),
    });
    expect(await api.json(completed)).toMatchObject({ id: upload.asset.id, sourceType: "atlas_export", status: "ready" });
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({ id: upload.asset.id, objectKey: transfer.objectKey, assetType: "Video", status: "Active" });
    expect(api.store.readGlobalAssetRegistration(upload.asset.id, api.owner.id)).toMatchObject({ status: "completed" });
    expect((await api.request(`/projects/${project.id}/uploads/${upload.uploadId}/complete`, {
      method: "POST", body: JSON.stringify({ parts: [{ partNumber: 1, etag: "one" }], totalSize: 6, purpose: "export" }),
    })).status).toBe(200);
    expect(registered).toHaveLength(1);
    expect((await api.request(`/projects/${project.id}/assets/${upload.asset.id}`, { method: "DELETE" })).status).toBe(204);
    expect(api.deleted).toEqual([]);
  });

  it("keeps a completed export ready while global asset registration is retried from its outbox", async () => {
    let attempts = 0;
    const registered: string[] = [];
    const api = await setup({
      partSize: 4,
      registerGlobalAsset: ({ id }) => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("catalog unavailable"), { code: "CATALOG_UNAVAILABLE" });
        registered.push(id);
      },
    });
    const project = await api.json<{ id: string }>(await api.request("/projects", {
      method: "POST", body: JSON.stringify({ title: "回流补偿" }),
    }));
    const upload = await api.json<{ uploadId: string; asset: { id: string } }>(await api.request(`/projects/${project.id}/uploads`, {
      method: "POST",
      body: JSON.stringify({
        name: "result.mp4", kind: "video", contentType: "video/mp4", size: null,
        purpose: "export", idempotencyKey: "export-outbox-retry",
      }),
    }));
    const transfer = api.store.readTransfer(upload.uploadId, api.owner.id)!;
    api.uploadedParts.set(transfer.tosUploadId!, [{ partNumber: 1, etag: "one" }, { partNumber: 2, etag: "two" }]);
    api.objects.set(transfer.objectKey, { size: 6, contentType: "video/mp4", etag: "export-etag" });

    const completed = await api.request(`/projects/${project.id}/uploads/${upload.uploadId}/complete`, {
      method: "POST",
      body: JSON.stringify({ parts: [{ partNumber: 1, etag: "one" }, { partNumber: 2, etag: "two" }], totalSize: 6, purpose: "export" }),
    });
    expect(completed.status).toBe(200);
    expect(await api.json(completed)).toMatchObject({ id: upload.asset.id, status: "ready" });
    expect(api.store.readGlobalAssetRegistration(upload.asset.id, api.owner.id)).toMatchObject({
      status: "pending", attemptCount: 1, lastError: "catalog unavailable",
    });

    const reconciled = await api.request(`/projects/${project.id}/uploads/${upload.uploadId}/complete`, {
      method: "POST",
      body: JSON.stringify({ parts: [{ partNumber: 1, etag: "one" }, { partNumber: 2, etag: "two" }], totalSize: 6, purpose: "export" }),
    });
    expect(reconciled.status).toBe(200);
    expect(registered).toEqual([upload.asset.id]);
    expect(api.store.readGlobalAssetRegistration(upload.asset.id, api.owner.id)).toMatchObject({ status: "completed", attemptCount: 1 });
  });

  it("copies a Firefly asset once and schedules only owned deletion", async () => {
    const source: AtlasImportSource = { objectKey: "generated/source.png", fileName: "人物.png", kind: "image", contentType: "image/png", size: 12 };
    const api = await setup({ resolveSource: (_ownerId, _sourceType, sourceId) => sourceId === "source-1" ? source : null });
    api.objects.set(source.objectKey, { size: 12, contentType: "image/png", etag: "source-etag" });
    const project = await api.json<{ id: string }>(await api.request("/projects", { method: "POST", body: JSON.stringify({ title: "导入项目" }) }));
    const first = await api.request(`/projects/${project.id}/assets/import`, {
      method: "POST", body: JSON.stringify({ sourceType: "generated", sourceId: "source-1" }),
    });
    expect(first.status).toBe(201);
    const asset = await api.json<{ id: string; status: string }>(first);
    expect(asset.status).toBe("ready");
    const repeated = await api.request(`/projects/${project.id}/assets/import`, {
      method: "POST", body: JSON.stringify({ sourceType: "generated", sourceId: "source-1" }),
    });
    expect(repeated.status).toBe(200);
    expect(await api.json(repeated)).toMatchObject({ id: asset.id });
    expect((await api.request(`/projects/${project.id}/assets/${asset.id}`, { method: "DELETE" }, api.other.id)).status).toBe(404);
    expect((await api.request(`/projects/${project.id}/assets/${asset.id}`, { method: "DELETE" })).status).toBe(204);
    expect(api.deleted).toHaveLength(1);
  });

  it("exposes a generated video immediately from its stable Firefly route while the project copy is pending", async () => {
    const api = await setup({
      describeAsset: () => ({ thumbnailUrl: "/api/generations/video-task/poster", duration: 8, width: 1920, height: 1080, hasAudio: true }),
    });
    const project = await api.json<{ id: string }>(await api.request("/projects", { method: "POST", body: JSON.stringify({ title: "立即剪辑" }) }));
    api.store.createImportedAsset({
      id: "destination-video", ownerId: api.owner.id, projectId: project.id,
      sourceType: "generation", sourceId: "video-task", kind: "video",
      objectKey: "atlas/assets/deferred.mp4", fileName: "雨夜追车-video-ta.mp4",
      contentType: "video/mp4", size: 8_000_000, now: 1_000,
    });

    const response = await api.request(`/projects/${project.id}/assets`);
    expect(response.status).toBe(200);
    expect(await api.json(response)).toMatchObject({ items: [{
      id: "destination-video", status: "copying",
      mediaUrl: "/api/generations/video-task/media",
      thumbnailUrl: "/api/generations/video-task/poster",
      duration: 8, width: 1920, height: 1080, hasAudio: true,
    }] });
  });

  it("rejects Firefly server-side copies above the documented 5 GiB CopyObject boundary", async () => {
    const source: AtlasImportSource = {
      objectKey: "generated/large.mp4", fileName: "large.mp4", kind: "video",
      contentType: "video/mp4", size: 5 * 1024 * 1024 * 1024 + 1,
    };
    const api = await setup({ resolveSource: () => source });
    const project = await api.json<{ id: string }>(await api.request("/projects", { method: "POST", body: JSON.stringify({ title: "大文件" }) }));
    const response = await api.request(`/projects/${project.id}/assets/import`, {
      method: "POST", body: JSON.stringify({ sourceType: "generated", sourceId: "large-source" }),
    });
    expect(response.status).toBe(422);
    expect(await api.json(response)).toMatchObject({ code: "ATLAS_IMPORT_TOO_LARGE" });
  });

  it("recovers an idempotent Firefly asset copy that was left failed", async () => {
    const source: AtlasImportSource = { objectKey: "generated/retry.png", fileName: "重试.png", kind: "image", contentType: "image/png", size: 12 };
    const api = await setup({ resolveSource: (_ownerId, _sourceType, sourceId) => sourceId === "retry-source" ? source : null });
    api.objects.set(source.objectKey, { size: 12, contentType: "image/png", etag: "source-etag" });
    const project = await api.json<{ id: string }>(await api.request("/projects", { method: "POST", body: JSON.stringify({ title: "复制恢复" }) }));
    api.storage.copyObject = async () => { throw Object.assign(new Error("temporary copy failure"), { statusCode: 503 }); };
    expect((await api.request(`/projects/${project.id}/assets/import`, {
      method: "POST", body: JSON.stringify({ sourceType: "generated", sourceId: "retry-source" }),
    })).status).toBe(500);

    api.storage.copyObject = async ({ sourceObjectKey, destinationObjectKey, contentType }) => {
      const stored = api.objects.get(sourceObjectKey);
      if (!stored) throw Object.assign(new Error("missing source"), { statusCode: 404, code: "NoSuchKey" });
      api.objects.set(destinationObjectKey, { ...stored, contentType });
    };
    const recovered = await api.request(`/projects/${project.id}/assets/import`, {
      method: "POST", body: JSON.stringify({ sourceType: "generated", sourceId: "retry-source" }),
    });
    expect(recovered.status).toBe(200);
    expect(await api.json(recovered)).toMatchObject({ status: "ready" });
  });
});
