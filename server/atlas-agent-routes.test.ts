import { once } from "node:events";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AtlasAgentProvider } from "./atlas-agent-provider.js";
import { createAtlasAgentRouter, type AtlasAgentQueue } from "./atlas-agent-routes.js";
import { AtlasAgentService, type AtlasAgentQueuePayload } from "./atlas-agent-service.js";
import { AtlasAgentSqliteStore } from "./atlas-agent-store.js";

const schema = (database: Database.Database) => database.exec(`
  CREATE TABLE atlas_projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, revision INTEGER NOT NULL, deleted_at INTEGER);
  CREATE TABLE atlas_agent_runs (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, status TEXT NOT NULL, instruction TEXT NOT NULL, base_revision INTEGER NOT NULL, catalog_version TEXT NOT NULL, catalog_digest TEXT NOT NULL, plan_json TEXT, error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER, UNIQUE(owner_id, project_id, idempotency_key));
  CREATE TABLE atlas_agent_events (run_id TEXT NOT NULL, sequence INTEGER NOT NULL, type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(run_id, sequence));
  CREATE TABLE atlas_agent_operations (run_id TEXT NOT NULL, sequence INTEGER NOT NULL, plan_digest TEXT NOT NULL, request_digest TEXT NOT NULL, status TEXT NOT NULL, risk TEXT NOT NULL, requires_confirmation INTEGER NOT NULL, result_json TEXT NOT NULL, before_revision INTEGER NOT NULL, after_revision INTEGER NOT NULL, history_node_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(run_id, sequence));
`);
const snapshot = {
  version: 1 as const, revision: 0, durationMs: 1_000,
  tracks: [{ id: "track-1", kind: "video" as const, muted: false, locked: false, clipIds: ["clip-1"] }],
  clips: [{ id: "clip-1", trackId: "track-1", kind: "video" as const, startMs: 0, durationMs: 1_000 }],
  assets: [], selection: { clipIds: ["clip-1"], trackIds: [] },
};

describe("Atlas Agent HTTP routes", () => {
  const cleanup: Array<() => Promise<void> | void> = [];
  afterEach(async () => { while (cleanup.length) await cleanup.pop()?.(); });

  it("reuses the run/job id and resumes SSE from Last-Event-ID", async () => {
    const database = new Database(":memory:");
    schema(database);
    database.prepare("INSERT INTO atlas_projects (id, owner_id, revision, deleted_at) VALUES ('project-1', 'user-a', 0, NULL)").run();
    const store = new AtlasAgentSqliteStore(database);
    const provider: AtlasAgentProvider = { createPlan: async () => ({ plan: {
      version: 1, summary: "切割", operations: [{ sequence: 1, tool: "split_clip", args: { clipId: "clip-1", atMs: 500 } }],
    } }) };
    const service = new AtlasAgentService({ store, provider });
    const jobs: Array<{ payload: AtlasAgentQueuePayload; jobId: string }> = [];
    const queue: AtlasAgentQueue = {
      add: vi.fn(async (_name, payload, options) => { jobs.push({ payload, jobId: options.jobId }); }),
    };
    const app = express();
    app.use(express.json());
    app.use("/api/atlas", createAtlasAgentRouter({
      service, queue, eventPollIntervalMs: 250,
      requireAuth: (_request, response, next) => { response.locals.user = { id: "user-a" }; next(); },
    }));
    app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
      response.status(500).json({ error: error instanceof Error ? error.message : "failed" });
    });
    const server = app.listen(0);
    await once(server, "listening");
    cleanup.push(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); database.close(); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/atlas`;
    const body = { idempotencyKey: "request-1", instruction: "切割", baseRevision: 0, snapshot };
    const first = await fetch(`${base}/projects/project-1/agent/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const firstRun = await first.json() as { id: string };
    const duplicate = await fetch(`${base}/projects/project-1/agent/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const duplicateRun = await duplicate.json() as { id: string };

    expect(first.status).toBe(202);
    expect(duplicateRun.id).toBe(firstRun.id);
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map((job) => job.jobId))).toEqual(new Set([firstRun.id]));
    await service.processRun(jobs[0].payload);

    const controller = new AbortController();
    const stream = await fetch(`${base}/projects/project-1/agent/runs/${firstRun.id}/events`, {
      headers: { "Last-Event-ID": "1" }, signal: controller.signal,
    });
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("event: plan_ready")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    controller.abort();
    expect(text).not.toContain("event: run_created");
    expect(text).toContain("id: 2\nevent: planning_started");
    expect(text).toContain("event: plan_ready");
  });

  it("does not intercept core Atlas routes when Agent is disabled", async () => {
    const database = new Database(":memory:");
    schema(database);
    const store = new AtlasAgentSqliteStore(database);
    const provider: AtlasAgentProvider = { createPlan: async () => ({ plan: {
      version: 1, summary: "noop", operations: [{ sequence: 1, tool: "create_track", args: { trackId: "track-2", kind: "video" } }],
    } }) };
    const service = new AtlasAgentService({ store, provider });
    let authenticationCalls = 0;
    const app = express();
    app.use(express.json());
    app.use("/api/atlas", createAtlasAgentRouter({
      service,
      enabled: false,
      queue: { add: vi.fn(async () => undefined) },
      requireAuth: (_request, response, next) => {
        authenticationCalls += 1;
        response.locals.user = { id: "user-a" };
        next();
      },
    }));
    app.get("/api/atlas/bootstrap", (_request, response) => response.json({ status: "core-ready" }));
    const server = app.listen(0);
    await once(server, "listening");
    cleanup.push(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); database.close(); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/atlas`;

    const core = await fetch(`${base}/bootstrap`);
    const agent = await fetch(`${base}/projects/project-1/agent/runs`);

    expect(core.status).toBe(200);
    expect(await core.json()).toEqual({ status: "core-ready" });
    expect(authenticationCalls).toBe(0);
    expect(agent.status).toBe(404);
    expect(await agent.json()).toMatchObject({ code: "ATLAS_AGENT_DISABLED" });
  });
});
