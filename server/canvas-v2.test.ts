import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canvasDocumentV2Schema, DEFAULT_CANVAS_DOCUMENT_V1, parseCanvasDocument, toCanvasDocumentV2 } from "./canvas-document.js";
import { UserStore, type CanvasProjectAsset } from "./db.js";
import { migrateDatabase } from "./migrations.js";

describe("Canvas V2 document contract", () => {
  it("converts legacy documents without losing nodes or edge direction", () => {
    const legacy = { ...DEFAULT_CANVAS_DOCUMENT_V1, nodes: [
      { id: "text-1", type: "text", title: "场景", position: { x: 0, y: 0 }, width: 220, height: 160, metadata: { content: "雨夜" } },
      { id: "video-1", type: "video", title: "镜头", position: { x: 300, y: 0 }, width: 320, height: 180, metadata: { mediaRef: { source: "generation", taskId: "task-1" } } },
    ], connections: [{ id: "edge-1", fromNodeId: "text-1", toNodeId: "video-1" }] };
    const converted = toCanvasDocumentV2(parseCanvasDocument(JSON.stringify(legacy)));
    expect(converted.version).toBe(2);
    expect(converted.nodes[0]?.data.markdown).toBe("雨夜");
    expect(converted.nodes[1]?.data.legacyMediaRef).toEqual({ source: "generation", taskId: "task-1" });
    expect(converted.connections[0]).toMatchObject({ source: "text-1", target: "video-1", sourceHandle: "right", targetHandle: "left", relation: "context" });
  });

  it("rejects unsupported relations and dangling group parents", () => {
    const base = { version: 2 as const, viewport: { x: 0, y: 0, k: 1 }, background: "dots" as const, preferences: { edgesHidden: false, snapToGrid: true, minimapOpen: true, panMode: false } };
    const node = (id: string, type: "text" | "image" | "video" | "group") => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 240, height: 160, data: {} });
    expect(() => canvasDocumentV2Schema.parse({ ...base, nodes: [node("video", "video"), node("text", "text")], connections: [{ id: "bad", source: "video", target: "text", sourceHandle: "right", targetHandle: "left", relation: "context" }] })).toThrow("不支持从 video 连接到 text");
    expect(() => canvasDocumentV2Schema.parse({ ...base, nodes: [{ ...node("image", "image"), parentId: "missing" }], connections: [] })).toThrow("分组节点不存在");
  });
});

describe("Canvas V2 durable recovery records", () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach((directory) => { try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* best effort */ } }));
  const store = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-canvas-v2-")); directories.push(directory);
    const target = path.join(directory, "firefly.db"); migrateDatabase(target); return new UserStore(target);
  };

  it("deduplicates project assets and restores jobs, montage and exports", () => {
    const database = store();
    const user = database.upsertFromFeishu({ openId: "ou_canvas_v2", unionId: "on_canvas_v2", tenantKey: "tenant", email: "canvas-v2@dokuai.tv", name: "Canvas", avatarUrl: "" });
    const now = Date.now();
    database.createCanvasProject({ id: "canvas-v2", ownerId: user.id, title: "V2", documentJson: JSON.stringify({ version: 2, viewport: { x: 0, y: 0, k: 1 }, background: "dots", preferences: { edgesHidden: false, snapToGrid: true, minimapOpen: true, panMode: false }, nodes: [], connections: [] }), revision: 0, createdAt: now, updatedAt: now });
    const asset: CanvasProjectAsset = { id: "project-asset-1", ownerId: user.id, canvasId: "canvas-v2", kind: "video", sourceType: "generation", sourceId: "task-1", title: "镜头", contentType: "video/mp4", size: 42, status: "ready", createdAt: now, updatedAt: now };
    expect(database.upsertCanvasProjectAsset(asset).id).toBe(asset.id);
    expect(database.upsertCanvasProjectAsset({ ...asset, id: "duplicate-id", title: "更新标题", updatedAt: now + 1 }).id).toBe(asset.id);
    expect(database.listCanvasProjectAssets("canvas-v2", user.id)).toHaveLength(1);
    expect(database.updateCanvasProjectAssetStatusBySource("generation", "task-1", "copying")).toBe(1);
    expect(database.readCanvasProjectAsset(asset.id)?.status).toBe("copying");
    expect(database.updateCanvasProjectAssetStatusBySource("generation", "task-1", "ready")).toBe(1);
    database.createCanvasJob({ id: "canvas-job-1", ownerId: user.id, canvasId: "canvas-v2", nodeId: "video-1", kind: "video", status: "running", payload: {}, providerTaskId: "task-1", partialText: "", createdAt: now, updatedAt: now });
    expect(database.readCanvasJobByProviderTask("task-1")?.id).toBe("canvas-job-1");
    database.updateCanvasJob("canvas-job-1", { status: "succeeded", resultAssetId: asset.id, error: null });
    expect(database.readCanvasJob("canvas-job-1")).toMatchObject({ status: "succeeded", resultAssetId: asset.id });
    database.createCanvasMontage({ id: "montage-1", ownerId: user.id, canvasId: "canvas-v2", revision: 0, timeline: { video: [] }, createdAt: now, updatedAt: now });
    expect(database.updateCanvasMontage("montage-1", user.id, 0, { video: [asset.id] })?.revision).toBe(1);
    database.createCanvasExport({ id: "export-1", ownerId: user.id, canvasId: "canvas-v2", montageId: "montage-1", status: "uploading", objectKey: "canvas-exports/export-1.mp4", tosUploadId: "tos-1", parts: [], createdAt: now, updatedAt: now });
    database.updateCanvasExport("export-1", { status: "ready", parts: [{ partNumber: 1, etag: "etag" }], resultAssetId: asset.id, error: null });
    expect(database.readCanvasExport("export-1")).toMatchObject({ status: "ready", resultAssetId: asset.id, parts: [{ partNumber: 1, etag: "etag" }] });
    database.close();
  });

  it("enforces the per-user active image job limit atomically", () => {
    const database = store();
    const first = database.upsertFromFeishu({ openId: "ou_canvas_limit_1", unionId: "on_canvas_limit_1", tenantKey: "tenant", email: "canvas-limit-1@dokuai.tv", name: "One", avatarUrl: "" });
    const second = database.upsertFromFeishu({ openId: "ou_canvas_limit_2", unionId: "on_canvas_limit_2", tenantKey: "tenant", email: "canvas-limit-2@dokuai.tv", name: "Two", avatarUrl: "" });
    const now = Date.now();
    database.createCanvasProject({ id: "canvas-limit", ownerId: first.id, title: "Limits", documentJson: JSON.stringify(DEFAULT_CANVAS_DOCUMENT_V1), revision: 0, createdAt: now, updatedAt: now });
    const job = (id: string, ownerId: string) => ({ id, ownerId, canvasId: "canvas-limit", nodeId: id, kind: "image" as const, status: "queued" as const, payload: {}, partialText: "", createdAt: now, updatedAt: now });
    expect(database.createCanvasImageJobWithinLimit(job("job-1", first.id), 2)).toBe(true);
    expect(database.createCanvasImageJobWithinLimit(job("job-2", first.id), 2)).toBe(true);
    expect(database.createCanvasImageJobWithinLimit(job("job-3", first.id), 2)).toBe(false);
    expect(database.createCanvasImageJobWithinLimit(job("job-other", second.id), 2)).toBe(true);
    database.updateCanvasJob("job-1", { status: "succeeded" });
    expect(database.createCanvasImageJobWithinLimit(job("job-3", first.id), 2)).toBe(true);
    database.close();
  });
});
