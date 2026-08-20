import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "./config.js";
import { UserStore, type CanvasProject } from "./db.js";
import { migrateDatabase } from "./migrations.js";
import { countCanvasNodes, DEFAULT_CANVAS_DOCUMENT, parseCanvasDocument, parseCanvasDocumentSafe } from "./canvas-document.js";
import { publicCanvasProject, publicCanvasProjectDetail } from "./canvas-public.js";

const makeUser = (store: UserStore, email: string) =>
  store.upsertFromFeishu({ openId: `ou_${email}`, unionId: `on_${email}`, tenantKey: "tenant-dokuai", email, name: email.split("@")[0], avatarUrl: "" });

let clock = Date.now();
const makeProject = (id: string, ownerId: string, title: string, documentJson = JSON.stringify(DEFAULT_CANVAS_DOCUMENT), revision = 0, updatedAt = ++clock): CanvasProject => ({
  id, ownerId, title, documentJson, revision, createdAt: updatedAt, updatedAt
});

const documentWithNodes = (count: number, overrides: Partial<CanvasProject> = {}) => {
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: `node-${index}`, type: "text", title: `节点 ${index}`,
    position: { x: index * 100, y: 0 }, width: 220, height: 160, metadata: {}
  }));
  return JSON.stringify({ version: 1, viewport: { x: 0, y: 0, k: 1 }, background: "dots", nodes, connections: [] });
};

describe("canvas project persistence", () => {
  const directories: string[] = [];

  afterEach(() => directories.splice(0).forEach((directory) => {
    try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 60 }); } catch { /* temp dir; best effort */ }
  }));

  const freshStore = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "firefly-canvas-")); directories.push(directory);
    const databasePath = path.join(directory, "canvas.db");
    migrateDatabase(databasePath);
    return new UserStore(databasePath);
  };

  it("creates, reads, and lists projects ordered by most recent update", () => {
    const store = freshStore();
    const owner = makeUser(store, "owner@dokuai.tv");
    const other = makeUser(store, "other@dokuai.tv");
    const older = makeProject("canvas-older", owner.id, "旧画布");
    const newer = makeProject("canvas-newer", owner.id, "新画布", documentWithNodes(3), 0, older.updatedAt + 1000);
    store.createCanvasProject(older);
    store.createCanvasProject(newer);

    expect(store.readCanvasProject("canvas-older")?.title).toBe("旧画布");
    expect(store.listCanvasProjects(owner.id, 10, 0).map((p) => p.id)).toEqual(["canvas-newer", "canvas-older"]);
    expect(store.listCanvasProjects(other.id, 10, 0)).toEqual([]);
    expect(store.listCanvasProjects(owner.id, 1, 1).map((p) => p.id)).toEqual(["canvas-older"]);
    store.close();
  });

  it("keeps revision isolation per owner and enforces the optimistic lock", () => {
    const store = freshStore();
    const owner = makeUser(store, "lock-owner@dokuai.tv");
    const other = makeUser(store, "lock-other@dokuai.tv");
    store.createCanvasProject(makeProject("canvas-lock", owner.id, "锁定画布"));
    expect(store.readCanvasProject("canvas-lock")?.revision).toBe(0);

    expect(store.updateCanvasProjectDocument("canvas-lock", other.id, documentWithNodes(1), 0)).toBeNull();

    const stale = store.updateCanvasProjectDocument("canvas-lock", owner.id, documentWithNodes(1), 0);
    expect(stale).toEqual({ status: "ok", revision: 1 });

    const conflict = store.updateCanvasProjectDocument("canvas-lock", owner.id, documentWithNodes(2), 0);
    expect(conflict).toEqual({ status: "conflict", currentRevision: 1 });

    const retry = store.updateCanvasProjectDocument("canvas-lock", owner.id, documentWithNodes(2), 1);
    expect(retry).toEqual({ status: "ok", revision: 2 });
    expect(store.readCanvasProject("canvas-lock")?.revision).toBe(2);
    store.close();
  });

  it("renames and soft-deletes with owner isolation, keeping the document revision", () => {
    const store = freshStore();
    const owner = makeUser(store, "rename-owner@dokuai.tv");
    const other = makeUser(store, "rename-other@dokuai.tv");
    store.createCanvasProject(makeProject("canvas-rename", owner.id, "原名"));
    store.updateCanvasProjectDocument("canvas-rename", owner.id, documentWithNodes(1), 0);

    expect(store.renameCanvasProject("canvas-rename", other.id, "越权改名")).toBe(false);
    expect(store.renameCanvasProject("canvas-rename", owner.id, "新名字")).toBe(true);
    expect(store.readCanvasProject("canvas-rename")?.title).toBe("新名字");
    expect(store.readCanvasProject("canvas-rename")?.revision).toBe(1);

    expect(store.softDeleteCanvasProject("canvas-rename", other.id)).toBe(false);
    expect(store.softDeleteCanvasProject("canvas-rename", owner.id)).toBe(true);
    expect(store.readCanvasProject("canvas-rename")).toBeNull();
    expect(store.listCanvasProjects(owner.id, 10, 0)).toEqual([]);
    store.close();
  });
});

describe("canvas document validation and projection", () => {
  it("validates and defaults a full document", () => {
    const parsed = parseCanvasDocument(documentWithNodes(2));
    expect(parsed.version).toBe(1);
    if (parsed.version !== 1) throw new Error("expected v1 fixture");
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[0].title).toBe("节点 0");
    expect(parsed.nodes[0].metadata).toEqual({});
  });

  it("rejects invalid shapes and tolerates corrupt JSON", () => {
    expect(() => parseCanvasDocument('{"version":2,"viewport":{},"background":"x","preferences":{},"nodes":[],"connections":[]}')).toThrow();
    expect(() => parseCanvasDocument('{"version":1,"viewport":{"x":0,"y":0,"k":1},"background":"dots","nodes":[{"id":"n1","type":"text","position":{"x":0,"y":0}}],"connections":[]}')).toThrow();
    expect(() => parseCanvasDocument('{"version":1,"viewport":{"x":0,"y":0,"k":1},"background":"dots","nodes":[],"connections":[{"id":"c1","fromNodeId":"n1"}]}')).toThrow();
    expect(parseCanvasDocumentSafe("not json at all")).toBeNull();
    expect(countCanvasNodes("garbage")).toBe(0);
    expect(countCanvasNodes(documentWithNodes(5))).toBe(5);
  });

  it("projects list items without leaking documents and counts nodes", () => {
    const project = makeProject("canvas-proj", "user-1", "投影画布", documentWithNodes(4), 3);
    expect(publicCanvasProject(project)).toEqual({ id: "canvas-proj", title: "投影画布", nodeCount: 4, updatedAt: project.updatedAt });
    const detail = publicCanvasProjectDetail(project);
    expect(detail.revision).toBe(3);
    expect(detail.document?.nodes).toHaveLength(4);
    expect(publicCanvasProjectDetail({ ...project, documentJson: "corrupt" }).document).toBeNull();
  });
});
