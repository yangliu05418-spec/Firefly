import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { AtlasAgentProtocolError, atlasAgentResultReceiptDigest } from "./atlas-agent-contract.js";
import { AtlasAgentProviderError, type AtlasAgentProvider } from "./atlas-agent-provider.js";
import { AtlasAgentService, formatAtlasAgentSseEvent } from "./atlas-agent-service.js";
import { AtlasAgentSqliteStore } from "./atlas-agent-store.js";

const LEASE_TOKEN = "lease-token-".padEnd(43, "x");

const createSchema = (database: Database.Database) => database.exec(`
  CREATE TABLE atlas_projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, revision INTEGER NOT NULL, deleted_at INTEGER);
  CREATE TABLE atlas_agent_runs (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL, instruction TEXT NOT NULL, base_revision INTEGER NOT NULL, catalog_version TEXT NOT NULL,
    catalog_digest TEXT NOT NULL, plan_json TEXT, error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    completed_at INTEGER, UNIQUE(owner_id, project_id, idempotency_key)
  );
  CREATE TABLE atlas_agent_events (
    run_id TEXT NOT NULL, sequence INTEGER NOT NULL, type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL,
    UNIQUE(run_id, sequence)
  );
  CREATE TABLE atlas_agent_operations (
    run_id TEXT NOT NULL, sequence INTEGER NOT NULL, plan_digest TEXT NOT NULL, request_digest TEXT NOT NULL,
    status TEXT NOT NULL, risk TEXT NOT NULL, requires_confirmation INTEGER NOT NULL, result_json TEXT NOT NULL,
    before_revision INTEGER NOT NULL, after_revision INTEGER NOT NULL, history_node_id TEXT, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, UNIQUE(run_id, sequence)
  );
`);

const semanticSnapshot = (revision = 0) => ({
  version: 1 as const, revision, durationMs: 10_000,
  tracks: [{ id: "track-1", kind: "video" as const, muted: false, locked: false, clipIds: ["clip-1", "clip-2"] }],
  clips: [
    { id: "clip-1", trackId: "track-1", kind: "video" as const, startMs: 0, durationMs: 5_000 },
    { id: "clip-2", trackId: "track-1", kind: "video" as const, startMs: 5_000, durationMs: 5_000 },
  ],
  assets: [], selection: { clipIds: ["clip-1"], trackIds: [] },
});

const validPlan = {
  version: 1 as const,
  summary: "切割并删除多余片段",
  operations: [
    { sequence: 1, tool: "splitClip", args: { clipId: "clip-1", splitTime: 2.5 } },
    { sequence: 2, tool: "deleteClip", args: { clipId: "clip-2" } },
  ],
};

const harness = (
  provider: AtlasAgentProvider = { createPlan: vi.fn(async () => ({ plan: validPlan, requestId: "provider-1" })) },
  assets = new Map<string, { ownerId: string; projectId: string; status: string; sourceType: string }>([
    ["atlas-export-1", { ownerId: "user-a", projectId: "project-1", status: "ready", sourceType: "atlas_export" }],
  ]),
) => {
  const database = new Database(":memory:");
  createSchema(database);
  database.prepare("INSERT INTO atlas_projects (id, owner_id, revision, deleted_at) VALUES ('project-1', 'user-a', 0, NULL)").run();
  const store = new AtlasAgentSqliteStore(database);
  return {
    database,
    store,
    service: new AtlasAgentService({
      store,
      provider,
      maxToolCalls: 8,
      executionAuthorizer: {
        hasActiveLease: ({ ownerId, projectId, leaseToken }) => ownerId === "user-a" && projectId === "project-1" && leaseToken === LEASE_TOKEN,
        resolveExportAsset: ({ assetId }) => assets.get(assetId) ?? null,
      },
    }),
  };
};

describe("Atlas Agent service", () => {
  it("creates an idempotent run and rejects reuse for a different snapshot", () => {
    const { database, service } = harness();
    const input = { ownerId: "user-a", projectId: "project-1", idempotencyKey: "request-1", instruction: "剪辑", baseRevision: 0, snapshot: semanticSnapshot() };
    const first = service.createRun(input);
    const duplicate = service.createRun(input);

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.run.id).toBe(first.run.id);
    expect(() => service.createRun({ ...input, instruction: "另一条指令" })).toThrowError(/幂等键/);
    database.close();
  });

  it("rejects a snapshot whose revision is stale on the server", () => {
    const { database, service } = harness();
    database.prepare("UPDATE atlas_projects SET revision = 1 WHERE id = 'project-1'").run();
    expect(() => service.createRun({
      ownerId: "user-a", projectId: "project-1", idempotencyKey: "request-stale", instruction: "剪辑",
      baseRevision: 0, snapshot: semanticSnapshot(0),
    })).toThrowError(/项目已经更新/);
    database.close();
  });

  it("persists a plan, derives confirmation policy, and accepts ordered idempotent receipts", async () => {
    const { database, service } = harness();
    const created = service.createRun({ ownerId: "user-a", projectId: "project-1", idempotencyKey: "request-1", instruction: "切割并删除", baseRevision: 0, snapshot: semanticSnapshot() });
    const planned = await service.processRun(created.queuePayload);

    expect(planned).toMatchObject({ status: "awaiting_confirmation", plan: { operations: [{ risk: "medium", requiresConfirmation: true }, { risk: "destructive", requiresConfirmation: true }] } });
    const confirmed = service.confirmRun("user-a", created.run.id, true, LEASE_TOKEN);
    expect(confirmed.status).toBe("ready");
    const plan = confirmed.plan!;
    const firstInput = { sequence: 1, planDigest: plan.planDigest, status: "succeeded" as const, result: { changed: true }, beforeRevision: 0, afterRevision: 1, historyNodeId: "history-1", leaseToken: LEASE_TOKEN };
    const first = service.recordOperationResult("user-a", created.run.id, firstInput);
    // A response may be lost after the durable commit. Exact replay remains
    // readable after lease expiry, while any different receipt still requires
    // a live lease and follows the conflict path below.
    const duplicate = service.recordOperationResult("user-a", created.run.id, {
      ...firstInput,
      leaseToken: "expired-lease".padEnd(43, "x"),
    });
    expect(first.kind).toBe("created");
    expect(duplicate.kind).toBe("duplicate");
    expect(first.run.status).toBe("running");

    const second = service.recordOperationResult("user-a", created.run.id, {
      sequence: 2, planDigest: plan.planDigest, status: "succeeded", result: { changed: true }, beforeRevision: 1, afterRevision: 1, historyNodeId: "history-1",
      leaseToken: LEASE_TOKEN,
    });
    expect(second.run.status).toBe("succeeded");
    expect(() => service.recordOperationResult("user-a", created.run.id, { ...firstInput, result: { changed: true, replayedAs: "different" } }))
      .toThrowError(/不同回执/);
    expect(service.getRun("user-a", created.run.id)).toMatchObject({ status: "failed", errorCode: "OPERATION_REPLAY_CONFLICT" });
    database.close();
  });

  it("closes the run when the browser rolls back the native editor transaction", async () => {
    const { database, service, store } = harness();
    const created = service.createRun({ ownerId: "user-a", projectId: "project-1", idempotencyKey: "request-rollback", instruction: "切割并删除", baseRevision: 0, snapshot: semanticSnapshot() });
    const planned = await service.processRun(created.queuePayload);
    const plan = service.confirmRun("user-a", created.run.id, true, LEASE_TOKEN).plan!;

    const result = service.recordExecutionResults("user-a", created.run.id, {
      planDigest: plan.planDigest,
      leaseToken: LEASE_TOKEN,
      results: planned!.plan!.operations.map((operation) => ({
        sequence: operation.sequence,
        status: "failed" as const,
        result: { code: "EXECUTION_ROLLED_BACK" },
      })),
    });

    expect(result).toMatchObject({ kind: "failed", run: { status: "failed", errorCode: "AGENT_EXECUTION_ROLLED_BACK" } });
    expect(store.listEvents(created.run.id, "user-a").at(-1)).toMatchObject({ type: "run_failed" });
    expect(() => service.recordOperationResult("user-a", created.run.id, {
      sequence: 1, planDigest: plan.planDigest, status: "succeeded", result: { changed: true },
      beforeRevision: 0, afterRevision: 1, historyNodeId: "history-1", leaseToken: LEASE_TOKEN,
    })).toThrowError(/尚未获得执行授权/);
    database.close();
  });

  it("checks optional client receipt digests and rejects out-of-order revisions", async () => {
    const provider: AtlasAgentProvider = { createPlan: async () => ({ plan: { ...validPlan, operations: [validPlan.operations[0]] } }) };
    const { database, service } = harness(provider);
    const created = service.createRun({ ownerId: "user-a", projectId: "project-1", idempotencyKey: "request-1", instruction: "切割", baseRevision: 0, snapshot: semanticSnapshot() });
    const planned = await service.processRun(created.queuePayload);
    const plan = service.confirmRun("user-a", created.run.id, true, LEASE_TOKEN).plan!;
    const input = { sequence: 1, planDigest: plan.planDigest, status: "succeeded" as const, result: { changed: true }, beforeRevision: 0, afterRevision: 1, historyNodeId: "history-1", leaseToken: LEASE_TOKEN };
    const correct = atlasAgentResultReceiptDigest({
      runId: created.run.id, sequence: input.sequence, planDigest: input.planDigest, status: input.status, result: input.result,
      beforeRevision: input.beforeRevision, afterRevision: input.afterRevision, historyNodeId: input.historyNodeId,
    });
    expect(() => service.recordOperationResult("user-a", created.run.id, { ...input, requestDigest: "0".repeat(64) })).toThrowError(/摘要/);
    expect(service.recordOperationResult("user-a", created.run.id, { ...input, requestDigest: correct }).run.status).toBe("succeeded");
    database.close();
  });

  it("rejects no-op success and prevents a multi-operation Undo transaction from advancing revision twice", async () => {
    const { database, service } = harness();
    const created = service.createRun({ ownerId: "user-a", projectId: "project-1", idempotencyKey: "atomic-plan", instruction: "切割并删除", baseRevision: 0, snapshot: semanticSnapshot() });
    const planned = await service.processRun(created.queuePayload);
    const confirmed = service.confirmRun("user-a", created.run.id, true, LEASE_TOKEN);
    const plan = confirmed.plan!;
    expect(() => service.recordOperationResult("user-a", created.run.id, {
      sequence: 1, planDigest: plan.planDigest, status: "succeeded", result: { changed: false }, beforeRevision: 0, afterRevision: 1, historyNodeId: "history-atomic",
      leaseToken: LEASE_TOKEN,
    })).toThrowError(/生效/);
    service.recordOperationResult("user-a", created.run.id, {
      sequence: 1, planDigest: plan.planDigest, status: "succeeded", result: { changed: true }, beforeRevision: 0, afterRevision: 1, historyNodeId: "history-atomic",
      leaseToken: LEASE_TOKEN,
    });
    expect(() => service.recordOperationResult("user-a", created.run.id, {
      sequence: 2, planDigest: plan.planDigest, status: "succeeded", result: { changed: true }, beforeRevision: 1, afterRevision: 2, historyNodeId: "history-atomic",
      leaseToken: LEASE_TOKEN,
    })).toThrowError(/原子事务/);
    expect(service.recordOperationResult("user-a", created.run.id, {
      sequence: 2, planDigest: plan.planDigest, status: "succeeded", result: { changed: true }, beforeRevision: 1, afterRevision: 1, historyNodeId: "history-atomic",
      leaseToken: LEASE_TOKEN,
    }).run.status).toBe("succeeded");
    expect(planned?.plan?.baseRevision).toBe(0);
    database.close();
  });

  it("opens the explicitly confirmed Firefly export workflow without advancing the timeline revision", async () => {
    const provider: AtlasAgentProvider = { createPlan: async () => ({ plan: {
      version: 1, summary: "导出项目", operations: [{ sequence: 1, tool: "requestFireflyExport", args: { preset: "mp4_h264_aac_1080p30" } }],
    } }) };
    const { database, service } = harness(provider);
    const created = service.createRun({ ownerId: "user-a", projectId: "project-1", idempotencyKey: "export-plan", instruction: "导出", baseRevision: 0, snapshot: semanticSnapshot() });
    await service.processRun(created.queuePayload);
    const confirmed = service.confirmRun("user-a", created.run.id, true, LEASE_TOKEN);
    const plan = confirmed.plan!;
    expect(() => service.recordOperationResult("user-a", created.run.id, {
      sequence: 1, planDigest: plan.planDigest, status: "succeeded", result: { opened: true }, beforeRevision: 0, afterRevision: 0,
      leaseToken: LEASE_TOKEN,
    })).toThrowError(/尚未打开/);
    expect(() => service.recordOperationResult("user-a", created.run.id, {
      sequence: 1, planDigest: plan.planDigest, status: "succeeded", result: { status: "opened" }, beforeRevision: 0, afterRevision: 1,
      leaseToken: LEASE_TOKEN,
    })).toThrowError(/原子事务/);
    expect(service.recordOperationResult("user-a", created.run.id, {
      sequence: 1, planDigest: plan.planDigest, status: "succeeded", result: { status: "opened" }, beforeRevision: 0, afterRevision: 0,
      leaseToken: LEASE_TOKEN,
    }).run.status).toBe("succeeded");
    database.close();
  });

  it.each([
    ["missing", undefined],
    ["cross-owner", { ownerId: "user-b", projectId: "project-1", status: "ready", sourceType: "atlas_export" }],
    ["cross-project", { ownerId: "user-a", projectId: "project-2", status: "ready", sourceType: "atlas_export" }],
    ["not-ready", { ownerId: "user-a", projectId: "project-1", status: "uploading", sourceType: "atlas_export" }],
    ["not-export", { ownerId: "user-a", projectId: "project-1", status: "ready", sourceType: "local_upload" }],
  ])("rejects an invalid Firefly export-open receipt: %s", async (_case, asset) => {
    const provider: AtlasAgentProvider = { createPlan: async () => ({ plan: {
      version: 1, summary: "导出项目", operations: [{ sequence: 1, tool: "requestFireflyExport", args: { preset: "mp4_h264_aac_1080p30" } }],
    } }) };
    const assets = new Map<string, { ownerId: string; projectId: string; status: string; sourceType: string }>();
    if (asset) assets.set("claimed-export", asset);
    const { database, service } = harness(provider, assets);
    const created = service.createRun({ ownerId: "user-a", projectId: "project-1", idempotencyKey: `invalid-export-${_case}`, instruction: "导出", baseRevision: 0, snapshot: semanticSnapshot() });
    await service.processRun(created.queuePayload);
    const plan = service.confirmRun("user-a", created.run.id, true, LEASE_TOKEN).plan!;
    expect(() => service.recordOperationResult("user-a", created.run.id, {
      sequence: 1, planDigest: plan.planDigest, status: "succeeded", result: { status: "ready", assetId: "claimed-export" },
      beforeRevision: 0, afterRevision: 0, leaseToken: LEASE_TOKEN,
    })).toThrowError(/尚未打开/);
    database.close();
  });

  it("requires the active project lease for confirmation and every operation receipt", async () => {
    const { database, service } = harness();
    const created = service.createRun({ ownerId: "user-a", projectId: "project-1", idempotencyKey: "lease-required", instruction: "切割并删除", baseRevision: 0, snapshot: semanticSnapshot() });
    await service.processRun(created.queuePayload);
    expect(() => service.confirmRun("user-a", created.run.id, true, "")).toThrowError(/编辑权/);
    expect(() => service.confirmRun("user-a", created.run.id, true, "wrong-lease".padEnd(43, "x"))).toThrowError(/失效/);
    const plan = service.confirmRun("user-a", created.run.id, true, LEASE_TOKEN).plan!;
    expect(() => service.recordOperationResult("user-a", created.run.id, {
      sequence: 1, planDigest: plan.planDigest, status: "succeeded", result: { changed: true },
      beforeRevision: 0, afterRevision: 1, historyNodeId: "history-lease", leaseToken: "wrong-lease".padEnd(43, "x"),
    })).toThrowError(/失效/);
    database.close();
  });

  it("fails a queued run created with an obsolete tool catalog before calling the Provider", async () => {
    const provider: AtlasAgentProvider = { createPlan: vi.fn(async () => ({ plan: validPlan })) };
    const { database, service } = harness(provider);
    const created = service.createRun({ ownerId: "user-a", projectId: "project-1", idempotencyKey: "old-catalog", instruction: "剪辑", baseRevision: 0, snapshot: semanticSnapshot() });
    database.prepare("UPDATE atlas_agent_runs SET catalog_version = '0', catalog_digest = ? WHERE id = ?").run("0".repeat(64), created.run.id);
    await expect(service.processRun(created.queuePayload)).rejects.toMatchObject({ code: "AGENT_CATALOG_MISMATCH" });
    expect(provider.createPlan).not.toHaveBeenCalled();
    expect(service.getRun("user-a", created.run.id)).toMatchObject({ status: "failed", errorCode: "AGENT_CATALOG_MISMATCH" });
    database.close();
  });

  it("rejects confirmation and execution after the durable project revision moves outside the plan", async () => {
    const { database, service } = harness();
    const destructive = service.createRun({ ownerId: "user-a", projectId: "project-1", idempotencyKey: "stale-confirm", instruction: "删除", baseRevision: 0, snapshot: semanticSnapshot() });
    await service.processRun(destructive.queuePayload);
    database.prepare("UPDATE atlas_projects SET revision = 1 WHERE id = 'project-1'").run();
    expect(() => service.confirmRun("user-a", destructive.run.id, true, LEASE_TOKEN)).toThrowError(/规划期间更新/);

    database.prepare("UPDATE atlas_projects SET revision = 0 WHERE id = 'project-1'").run();
    const provider: AtlasAgentProvider = { createPlan: async () => ({ plan: { ...validPlan, operations: [validPlan.operations[0]] } }) };
    const secondHarness = harness(provider);
    const executable = secondHarness.service.createRun({ ownerId: "user-a", projectId: "project-1", idempotencyKey: "stale-execute", instruction: "切割", baseRevision: 0, snapshot: semanticSnapshot() });
    const planned = await secondHarness.service.processRun(executable.queuePayload);
    secondHarness.service.confirmRun("user-a", executable.run.id, true, LEASE_TOKEN);
    secondHarness.database.prepare("UPDATE atlas_projects SET revision = 2 WHERE id = 'project-1'").run();
    expect(() => secondHarness.service.recordOperationResult("user-a", executable.run.id, {
      sequence: 1, planDigest: planned!.plan!.planDigest, status: "succeeded", result: { changed: true },
      beforeRevision: 0, afterRevision: 1, historyNodeId: "history-stale",
      leaseToken: LEASE_TOKEN,
    })).toThrowError(/版本/);
    secondHarness.database.close();
    database.close();
  });

  it("keeps cancellation terminal when a late provider response arrives", async () => {
    let resolve!: (value: { plan: typeof validPlan }) => void;
    let providerSignal: AbortSignal | undefined;
    const provider: AtlasAgentProvider = { createPlan: (_input, signal) => new Promise((done) => { providerSignal = signal; resolve = done; }) };
    const { database, service } = harness(provider);
    const created = service.createRun({ ownerId: "user-a", projectId: "project-1", idempotencyKey: "request-1", instruction: "剪辑", baseRevision: 0, snapshot: semanticSnapshot() });
    const processing = service.processRun(created.queuePayload);
    service.cancelRun("user-a", created.run.id);
    expect(providerSignal?.aborted).toBe(true);
    resolve({ plan: validPlan });

    await expect(processing).resolves.toMatchObject({ status: "cancelled" });
    expect(service.getRun("user-a", created.run.id).plan).toBeUndefined();
    database.close();
  });

  it("does not expose cross-user runs and formats resumable SSE events", () => {
    const { database, service } = harness();
    const created = service.createRun({ ownerId: "user-a", projectId: "project-1", idempotencyKey: "request-1", instruction: "剪辑", baseRevision: 0, snapshot: semanticSnapshot() });
    expect(() => service.getRun("user-b", created.run.id)).toThrowError(AtlasAgentProtocolError);
    expect(() => service.listEvents("user-b", created.run.id)).toThrowError(/不存在/);
    const events = service.listEvents("user-a", created.run.id, 0);
    expect(formatAtlasAgentSseEvent(events[0])).toContain("id: 1\nevent: run_created\ndata:");
    database.close();
  });

  it("keeps retryable provider failures non-terminal until attempts are exhausted", async () => {
    const provider: AtlasAgentProvider = { createPlan: vi.fn(async () => { throw new AtlasAgentProviderError("AGENT_PROVIDER_TIMEOUT", "timeout", true); }) };
    const { database, service } = harness(provider);
    const created = service.createRun({ ownerId: "user-a", projectId: "project-1", idempotencyKey: "request-1", instruction: "剪辑", baseRevision: 0, snapshot: semanticSnapshot() });
    await expect(service.processRun(created.queuePayload, { number: 1, maximum: 2 })).rejects.toThrow();
    expect(service.getRun("user-a", created.run.id).status).toBe("planning");
    await expect(service.processRun(created.queuePayload, { number: 2, maximum: 2 })).rejects.toThrow();
    expect(service.getRun("user-a", created.run.id)).toMatchObject({ status: "failed", errorCode: "AGENT_PROVIDER_TIMEOUT" });
    database.close();
  });
});
