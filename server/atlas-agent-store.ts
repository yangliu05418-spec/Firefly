import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { AtlasAgentProtocolError, assertSafeJson, type AtlasAgentPlan, type AtlasAgentRisk } from "./atlas-agent-contract.js";

export type AtlasAgentRunStatus = "queued" | "planning" | "awaiting_confirmation" | "ready" | "running" | "succeeded" | "failed" | "cancelled";

export type AtlasAgentRun = {
  id: string;
  ownerId: string;
  projectId: string;
  idempotencyKey: string;
  status: AtlasAgentRunStatus;
  instruction: string;
  baseRevision: number;
  catalogVersion: string;
  catalogDigest: string;
  requestDigest: string;
  plan?: AtlasAgentPlan;
  errorCode?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};

export type AtlasAgentEvent = {
  runId: string;
  sequence: number;
  type: string;
  payload: unknown;
  createdAt: number;
};

export type AtlasAgentOperationReceipt = {
  runId: string;
  sequence: number;
  planDigest: string;
  requestDigest: string;
  status: "succeeded" | "failed";
  risk: AtlasAgentRisk;
  requiresConfirmation: boolean;
  result: unknown;
  beforeRevision: number;
  afterRevision: number;
  historyNodeId?: string;
  createdAt: number;
  updatedAt: number;
};

type RunRow = {
  id: string; owner_id: string; project_id: string; idempotency_key: string; status: AtlasAgentRunStatus;
  instruction: string; base_revision: number; catalog_version: string; catalog_digest: string; plan_json: string | null;
  error_code: string | null; created_at: number; updated_at: number; completed_at: number | null;
};
type EventRow = { run_id: string; sequence: number; type: string; payload_json: string; created_at: number };
type OperationRow = {
  run_id: string; sequence: number; plan_digest: string; request_digest: string; status: "succeeded" | "failed";
  risk: AtlasAgentRisk; requires_confirmation: number; result_json: string; before_revision: number; after_revision: number;
  history_node_id: string | null; created_at: number; updated_at: number;
};

type PlanEnvelope = { requestDigest: string; plan?: AtlasAgentPlan };

const parseEnvelope = (json: string | null): PlanEnvelope => {
  if (!json) return { requestDigest: "" };
  try {
    const parsed = JSON.parse(json) as PlanEnvelope;
    assertSafeJson(parsed);
    if (!parsed || typeof parsed !== "object" || typeof parsed.requestDigest !== "string") return { requestDigest: "" };
    return parsed;
  } catch {
    return { requestDigest: "" };
  }
};

const mapRun = (row?: RunRow): AtlasAgentRun | null => {
  if (!row) return null;
  const envelope = parseEnvelope(row.plan_json);
  return {
    id: row.id, ownerId: row.owner_id, projectId: row.project_id, idempotencyKey: row.idempotency_key,
    status: row.status, instruction: row.instruction, baseRevision: row.base_revision,
    catalogVersion: row.catalog_version, catalogDigest: row.catalog_digest, requestDigest: envelope.requestDigest,
    plan: envelope.plan, errorCode: row.error_code ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
};

const parseJson = (value: string) => {
  try { return JSON.parse(value) as unknown; } catch { return null; }
};

const mapEvent = (row: EventRow): AtlasAgentEvent => ({
  runId: row.run_id, sequence: row.sequence, type: row.type, payload: parseJson(row.payload_json), createdAt: row.created_at,
});

const mapOperation = (row: OperationRow): AtlasAgentOperationReceipt => ({
  runId: row.run_id, sequence: row.sequence, planDigest: row.plan_digest, requestDigest: row.request_digest,
  status: row.status, risk: row.risk, requiresConfirmation: Boolean(row.requires_confirmation), result: parseJson(row.result_json),
  beforeRevision: row.before_revision, afterRevision: row.after_revision, historyNodeId: row.history_node_id ?? undefined,
  createdAt: row.created_at, updatedAt: row.updated_at,
});

export type CreateAtlasAgentRunRecord = {
  id: string; ownerId: string; projectId: string; idempotencyKey: string; instruction: string; baseRevision: number;
  catalogVersion: string; catalogDigest: string; requestDigest: string; now: number;
};

export type StoreOperationResult =
  | { kind: "created"; receipt: AtlasAgentOperationReceipt; run: AtlasAgentRun }
  | { kind: "duplicate"; receipt: AtlasAgentOperationReceipt; run: AtlasAgentRun }
  | { kind: "digest_conflict"; run: AtlasAgentRun };

export class AtlasAgentSqliteStore {
  private readonly database: Database.Database;
  private readonly ownsDatabase: boolean;

  constructor(database: Database.Database, ownsDatabase = false) {
    this.database = database;
    this.ownsDatabase = ownsDatabase;
    try {
      this.database.prepare("SELECT id, owner_id, project_id, idempotency_key, status, instruction, base_revision, catalog_version, catalog_digest, plan_json, error_code, created_at, updated_at, completed_at FROM atlas_agent_runs LIMIT 0");
      this.database.prepare("SELECT run_id, sequence, type, payload_json, created_at FROM atlas_agent_events LIMIT 0");
      this.database.prepare("SELECT run_id, sequence, plan_digest, request_digest, status, risk, requires_confirmation, result_json, before_revision, after_revision, history_node_id, created_at, updated_at FROM atlas_agent_operations LIMIT 0");
    } catch (error) {
      throw new Error("Atlas Agent Schema 12 尚未就绪", { cause: error });
    }
  }

  static open(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const database = new Database(databasePath);
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    try { return new AtlasAgentSqliteStore(database, true); }
    catch (error) { database.close(); throw error; }
  }

  close() {
    if (this.ownsDatabase && this.database.open) this.database.close();
  }

  private appendEvent(runId: string, type: string, payload: unknown, now: number) {
    assertSafeJson(payload);
    const next = (this.database.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM atlas_agent_events WHERE run_id = ?").get(runId) as { sequence: number }).sequence;
    this.database.prepare("INSERT INTO atlas_agent_events (run_id, sequence, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(runId, next, type, JSON.stringify(payload), now);
    return next;
  }

  readProjectRevision(ownerId: string, projectId: string) {
    return this.database.prepare("SELECT revision FROM atlas_projects WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").get(projectId, ownerId) as { revision: number } | undefined;
  }

  createRun(input: CreateAtlasAgentRunRecord): { run: AtlasAgentRun; created: boolean } {
    return this.database.transaction(() => {
      const project = this.readProjectRevision(input.ownerId, input.projectId);
      if (!project) throw new AtlasAgentProtocolError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas 项目不存在");
      if (project.revision !== input.baseRevision) throw new AtlasAgentProtocolError(409, "AGENT_REVISION_CONFLICT", "项目已经更新，请刷新后重试");
      const existing = mapRun(this.database.prepare("SELECT * FROM atlas_agent_runs WHERE owner_id = ? AND project_id = ? AND idempotency_key = ?").get(input.ownerId, input.projectId, input.idempotencyKey) as RunRow | undefined);
      if (existing) {
        if (existing.requestDigest !== input.requestDigest) throw new AtlasAgentProtocolError(409, "AGENT_IDEMPOTENCY_CONFLICT", "幂等键已用于不同的 Agent 请求");
        return { run: existing, created: false };
      }
      this.database.prepare(`
        INSERT INTO atlas_agent_runs
          (id, owner_id, project_id, idempotency_key, status, instruction, base_revision, catalog_version, catalog_digest, plan_json, error_code, created_at, updated_at, completed_at)
        VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
      `).run(input.id, input.ownerId, input.projectId, input.idempotencyKey, input.instruction, input.baseRevision, input.catalogVersion, input.catalogDigest, JSON.stringify({ requestDigest: input.requestDigest }), input.now, input.now);
      this.appendEvent(input.id, "run_created", { status: "queued", baseRevision: input.baseRevision }, input.now);
      const run = this.readRun(input.id, input.ownerId);
      if (!run) throw new Error("创建 Agent Run 后无法读取记录");
      return { run, created: true };
    }).immediate();
  }

  readRun(id: string, ownerId?: string) {
    const row = ownerId
      ? this.database.prepare("SELECT * FROM atlas_agent_runs WHERE id = ? AND owner_id = ?").get(id, ownerId)
      : this.database.prepare("SELECT * FROM atlas_agent_runs WHERE id = ?").get(id);
    return mapRun(row as RunRow | undefined);
  }

  readOperation(runId: string, ownerId: string, sequence: number) {
    if (!this.readRun(runId, ownerId)) return null;
    const row = this.database.prepare("SELECT * FROM atlas_agent_operations WHERE run_id = ? AND sequence = ?")
      .get(runId, sequence) as OperationRow | undefined;
    return row ? mapOperation(row) : null;
  }

  claimPlanning(runId: string, now: number) {
    return this.database.transaction(() => {
      const current = this.readRun(runId);
      if (!current) return null;
      if (current.status === "planning") return current;
      if (current.status !== "queued") return current;
      this.database.prepare("UPDATE atlas_agent_runs SET status = 'planning', updated_at = ? WHERE id = ? AND status = 'queued'").run(now, runId);
      this.appendEvent(runId, "planning_started", { status: "planning" }, now);
      return this.readRun(runId);
    }).immediate();
  }

  savePlan(runId: string, plan: AtlasAgentPlan, now: number) {
    return this.database.transaction(() => {
      const current = this.readRun(runId);
      if (!current || current.status !== "planning") return current;
      const status: AtlasAgentRunStatus = plan.operations.some((operation) => operation.requiresConfirmation) ? "awaiting_confirmation" : "ready";
      this.database.prepare("UPDATE atlas_agent_runs SET status = ?, plan_json = ?, error_code = NULL, updated_at = ? WHERE id = ? AND status = 'planning'")
        .run(status, JSON.stringify({ requestDigest: current.requestDigest, plan }), now, runId);
      this.appendEvent(runId, "plan_ready", { status, plan }, now);
      return this.readRun(runId);
    }).immediate();
  }

  failRun(runId: string, errorCode: string, now: number) {
    return this.database.transaction(() => {
      const current = this.readRun(runId);
      if (!current || ["succeeded", "failed", "cancelled"].includes(current.status)) return current;
      this.database.prepare("UPDATE atlas_agent_runs SET status = 'failed', error_code = ?, updated_at = ?, completed_at = ? WHERE id = ?")
        .run(errorCode, now, now, runId);
      this.appendEvent(runId, "run_failed", { status: "failed", errorCode }, now);
      return this.readRun(runId);
    }).immediate();
  }

  confirmRun(runId: string, ownerId: string, approved: boolean, now: number) {
    return this.database.transaction(() => {
      const current = this.readRun(runId, ownerId);
      if (!current) throw new AtlasAgentProtocolError(404, "AGENT_RUN_NOT_FOUND", "Agent 任务不存在");
      const project = this.readProjectRevision(ownerId, current.projectId);
      if (!project) throw new AtlasAgentProtocolError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas 项目不存在");
      if (approved && project.revision !== current.baseRevision) {
        throw new AtlasAgentProtocolError(409, "AGENT_REVISION_CONFLICT", "项目已在规划期间更新，请重新生成 Agent 计划");
      }
      if (current.status !== "awaiting_confirmation") {
        if ((approved && ["ready", "running", "succeeded"].includes(current.status)) || (!approved && current.status === "cancelled")) return current;
        throw new AtlasAgentProtocolError(409, "AGENT_RUN_NOT_CONFIRMABLE", "Agent 任务当前无法确认");
      }
      const status: AtlasAgentRunStatus = approved ? "ready" : "cancelled";
      this.database.prepare("UPDATE atlas_agent_runs SET status = ?, updated_at = ?, completed_at = ? WHERE id = ? AND status = 'awaiting_confirmation'")
        .run(status, now, approved ? null : now, runId);
      this.appendEvent(runId, approved ? "plan_confirmed" : "run_cancelled", { status }, now);
      return this.readRun(runId, ownerId)!;
    }).immediate();
  }

  cancelRun(runId: string, ownerId: string, now: number) {
    return this.database.transaction(() => {
      const current = this.readRun(runId, ownerId);
      if (!current) throw new AtlasAgentProtocolError(404, "AGENT_RUN_NOT_FOUND", "Agent 任务不存在");
      if (current.status === "cancelled") return current;
      if (["succeeded", "failed"].includes(current.status)) throw new AtlasAgentProtocolError(409, "AGENT_RUN_TERMINAL", "Agent 任务已经结束");
      this.database.prepare("UPDATE atlas_agent_runs SET status = 'cancelled', updated_at = ?, completed_at = ? WHERE id = ?")
        .run(now, now, runId);
      this.appendEvent(runId, "run_cancelled", { status: "cancelled" }, now);
      return this.readRun(runId, ownerId)!;
    }).immediate();
  }

  listEvents(runId: string, ownerId: string, afterSequence = 0, limit = 200) {
    if (!this.readRun(runId, ownerId)) throw new AtlasAgentProtocolError(404, "AGENT_RUN_NOT_FOUND", "Agent 任务不存在");
    return (this.database.prepare("SELECT * FROM atlas_agent_events WHERE run_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?")
      .all(runId, afterSequence, Math.max(1, Math.min(500, limit))) as EventRow[]).map(mapEvent);
  }

  recordOperationResult(input: {
    runId: string; ownerId: string; sequence: number; plan: AtlasAgentPlan; requestDigest: string; status: "succeeded" | "failed";
    risk: AtlasAgentRisk; requiresConfirmation: boolean; result: unknown; beforeRevision: number; afterRevision: number;
    historyNodeId?: string; now: number;
  }): StoreOperationResult {
    return this.database.transaction(() => {
      const current = this.readRun(input.runId, input.ownerId);
      if (!current) throw new AtlasAgentProtocolError(404, "AGENT_RUN_NOT_FOUND", "Agent 任务不存在");
      const existing = this.database.prepare("SELECT * FROM atlas_agent_operations WHERE run_id = ? AND sequence = ?").get(input.runId, input.sequence) as OperationRow | undefined;
      if (existing) {
        const receipt = mapOperation(existing);
        if (receipt.requestDigest === input.requestDigest && receipt.planDigest === input.plan.planDigest) return { kind: "duplicate" as const, receipt, run: current };
        if (!["failed", "cancelled"].includes(current.status)) {
          this.database.prepare("UPDATE atlas_agent_runs SET status = 'failed', error_code = 'OPERATION_REPLAY_CONFLICT', updated_at = ?, completed_at = ? WHERE id = ?")
            .run(input.now, input.now, input.runId);
          this.appendEvent(input.runId, "operation_replay_conflict", { sequence: input.sequence, errorCode: "OPERATION_REPLAY_CONFLICT" }, input.now);
        }
        return { kind: "digest_conflict" as const, run: this.readRun(input.runId, input.ownerId)! };
      }
      if (!current.plan || current.plan.planDigest !== input.plan.planDigest) throw new AtlasAgentProtocolError(409, "AGENT_PLAN_CHANGED", "Agent 操作计划已经变化");
      if (!(["ready", "running"] as AtlasAgentRunStatus[]).includes(current.status)) throw new AtlasAgentProtocolError(409, "AGENT_RUN_NOT_EXECUTABLE", "Agent 任务尚未获得执行授权");
      const project = this.readProjectRevision(input.ownerId, current.projectId);
      if (!project) throw new AtlasAgentProtocolError(404, "ATLAS_PROJECT_NOT_FOUND", "Atlas 项目不存在");
      const planChangesTimeline = input.plan.operations.some((operation) => operation.tool !== "request_export");
      const maximumExpectedProjectRevision = current.baseRevision + (planChangesTimeline ? 1 : 0);
      if (project.revision < current.baseRevision || project.revision > maximumExpectedProjectRevision) {
        throw new AtlasAgentProtocolError(409, "AGENT_REVISION_CONFLICT", "项目版本已超出 Agent 计划的原子事务范围");
      }
      const previous = input.sequence > 1 ? this.database.prepare("SELECT * FROM atlas_agent_operations WHERE run_id = ? AND sequence = ?").get(input.runId, input.sequence - 1) as OperationRow | undefined : undefined;
      if (input.sequence > 1 && !previous) throw new AtlasAgentProtocolError(409, "AGENT_OPERATION_OUT_OF_ORDER", "Agent 操作回执必须按顺序提交");
      const operation = input.plan.operations[input.sequence - 1]!;
      const priorHasEdit = input.plan.operations.slice(0, input.sequence - 1).some((candidate) => candidate.tool !== "request_export");
      const expectedBeforeRevision = current.baseRevision + (priorHasEdit ? 1 : 0);
      const expectedAfterRevision = input.status === "succeeded" && operation.tool !== "request_export"
        ? current.baseRevision + 1
        : expectedBeforeRevision;
      if (input.beforeRevision !== expectedBeforeRevision || input.afterRevision !== expectedAfterRevision) {
        throw new AtlasAgentProtocolError(409, "AGENT_REVISION_CONFLICT", "编辑器版本与 Agent 原子事务不一致");
      }
      const priorHistory = this.database.prepare(`
        SELECT history_node_id FROM atlas_agent_operations
        WHERE run_id = ? AND history_node_id IS NOT NULL
        ORDER BY sequence ASC LIMIT 1
      `).get(input.runId) as Pick<OperationRow, "history_node_id"> | undefined;
      if (operation.tool !== "request_export" && input.status === "succeeded"
        && priorHistory?.history_node_id && input.historyNodeId !== priorHistory.history_node_id) {
        throw new AtlasAgentProtocolError(409, "AGENT_HISTORY_CONFLICT", "同一 Agent 计划必须归入一个撤销事务");
      }
      assertSafeJson(input.result, { maxDepth: 12, maxNodes: 2_000, maxStringLength: 20_000 });
      this.database.prepare(`
        INSERT INTO atlas_agent_operations
          (run_id, sequence, plan_digest, request_digest, status, risk, requires_confirmation, result_json, before_revision, after_revision, history_node_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.runId, input.sequence, input.plan.planDigest, input.requestDigest, input.status, input.risk, input.requiresConfirmation ? 1 : 0, JSON.stringify(input.result), input.beforeRevision, input.afterRevision, input.historyNodeId ?? null, input.now, input.now);
      let status: AtlasAgentRunStatus = "running";
      let errorCode: string | null = null;
      let completedAt: number | null = null;
      if (input.status === "failed") { status = "failed"; errorCode = "OPERATION_FAILED"; completedAt = input.now; }
      else if (input.sequence === input.plan.operations.length) { status = "succeeded"; completedAt = input.now; }
      this.database.prepare("UPDATE atlas_agent_runs SET status = ?, error_code = ?, updated_at = ?, completed_at = ? WHERE id = ?")
        .run(status, errorCode, input.now, completedAt, input.runId);
      this.appendEvent(input.runId, "operation_result", {
        sequence: input.sequence, status: input.status, beforeRevision: input.beforeRevision, afterRevision: input.afterRevision,
        historyNodeId: input.historyNodeId ?? null, runStatus: status,
      }, input.now);
      const receipt = mapOperation(this.database.prepare("SELECT * FROM atlas_agent_operations WHERE run_id = ? AND sequence = ?").get(input.runId, input.sequence) as OperationRow);
      return { kind: "created" as const, receipt, run: this.readRun(input.runId, input.ownerId)! };
    }).immediate();
  }
}
