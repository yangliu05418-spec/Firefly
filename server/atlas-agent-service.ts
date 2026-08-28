import crypto from "node:crypto";
import { config } from "./config.js";
import {
  ATLAS_AGENT_CATALOG_DIGEST,
  ATLAS_AGENT_CATALOG_VERSION,
  ATLAS_AGENT_MAX_TOOL_CALLS,
  AtlasAgentProtocolError,
  assertSafeJson,
  atlasAgentResultReceiptDigest,
  digestJson,
  normalizeAtlasAgentPlan,
  parseAtlasAgentSemanticSnapshot,
  type AtlasAgentSemanticSnapshot,
} from "./atlas-agent-contract.js";
import { AtlasAgentProviderError, type AtlasAgentProvider } from "./atlas-agent-provider.js";
import { AtlasAgentSqliteStore, type AtlasAgentEvent, type AtlasAgentRun } from "./atlas-agent-store.js";

const positiveInteger = (value: string | undefined, fallback: number, maximum: number) => {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

export const atlasAgentServiceDefaults = () => ({
  maxToolCalls: positiveInteger(String(config.atlasAgentMaxToolCalls), ATLAS_AGENT_MAX_TOOL_CALLS, ATLAS_AGENT_MAX_TOOL_CALLS),
  maxRounds: positiveInteger(String(config.atlasAgentMaxRounds), 8, 8),
});

export type AtlasAgentQueuePayload = {
  runId: string;
  ownerId: string;
  projectId: string;
  requestDigest: string;
  snapshot: AtlasAgentSemanticSnapshot;
};

export type CreateAtlasAgentRunInput = {
  ownerId: string;
  projectId: string;
  idempotencyKey: string;
  instruction: string;
  baseRevision: number;
  snapshot: unknown;
};

export type AtlasAgentOperationResultInput = {
  sequence: number;
  planDigest: string;
  status: "succeeded" | "failed";
  result: unknown;
  beforeRevision: number;
  afterRevision: number;
  historyNodeId?: string;
  requestDigest?: string;
  leaseToken: string;
};

export type AtlasAgentExecutionAuthorizer = {
  hasActiveLease: (input: { ownerId: string; projectId: string; leaseToken: string; now: number }) => boolean;
  resolveExportAsset: (input: { ownerId: string; projectId: string; assetId: string }) => {
    ownerId: string;
    projectId: string;
    status: string;
    sourceType: string;
  } | null;
};

const denyExecution: AtlasAgentExecutionAuthorizer = {
  hasActiveLease: () => false,
  resolveExportAsset: () => null,
};

const boundedText = (value: unknown, field: string, maximum: number) => {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new AtlasAgentProtocolError(400, "AGENT_INPUT_INVALID", `${field} 无效`);
  }
  return value.trim();
};

const validateCreateInput = (input: CreateAtlasAgentRunInput) => {
  assertSafeJson(input, { maxDepth: 16, maxNodes: 60_000, maxStringLength: 20_000 });
  const allowed = new Set(["ownerId", "projectId", "idempotencyKey", "instruction", "baseRevision", "snapshot"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new AtlasAgentProtocolError(400, "AGENT_INPUT_INVALID", "Agent 请求包含未知字段");
  const ownerId = boundedText(input.ownerId, "用户标识", 128);
  const projectId = boundedText(input.projectId, "项目标识", 128);
  const idempotencyKey = boundedText(input.idempotencyKey, "幂等键", 128);
  const instruction = boundedText(input.instruction, "编辑指令", 20_000);
  if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) throw new AtlasAgentProtocolError(400, "AGENT_REVISION_INVALID", "项目版本无效");
  const snapshot = parseAtlasAgentSemanticSnapshot(input.snapshot);
  if (snapshot.revision !== input.baseRevision) throw new AtlasAgentProtocolError(409, "AGENT_REVISION_CONFLICT", "语义快照版本与项目版本不一致");
  return { ownerId, projectId, idempotencyKey, instruction, baseRevision: input.baseRevision, snapshot };
};

const safeLog = (level: "info" | "warn" | "error", value: Record<string, unknown>) => {
  console[level](JSON.stringify({ at: new Date().toISOString(), ...value }));
};

export class AtlasAgentService {
  private readonly store: AtlasAgentSqliteStore;
  private readonly provider: AtlasAgentProvider;
  private readonly executionAuthorizer: AtlasAgentExecutionAuthorizer;
  private readonly maxToolCalls: number;
  private readonly activeControllers = new Map<string, AbortController>();

  constructor(input: {
    store: AtlasAgentSqliteStore;
    provider: AtlasAgentProvider;
    executionAuthorizer?: AtlasAgentExecutionAuthorizer;
    maxToolCalls?: number;
  }) {
    this.store = input.store;
    this.provider = input.provider;
    this.executionAuthorizer = input.executionAuthorizer ?? denyExecution;
    this.maxToolCalls = Math.max(1, Math.min(ATLAS_AGENT_MAX_TOOL_CALLS, input.maxToolCalls ?? atlasAgentServiceDefaults().maxToolCalls));
  }

  createRun(input: CreateAtlasAgentRunInput): { run: AtlasAgentRun; created: boolean; queuePayload: AtlasAgentQueuePayload } {
    const validated = validateCreateInput(input);
    const requestDigest = digestJson({
      ownerId: validated.ownerId,
      projectId: validated.projectId,
      instruction: validated.instruction,
      baseRevision: validated.baseRevision,
      snapshot: validated.snapshot,
      catalogVersion: ATLAS_AGENT_CATALOG_VERSION,
      catalogDigest: ATLAS_AGENT_CATALOG_DIGEST,
    });
    const result = this.store.createRun({
      id: crypto.randomUUID(),
      ownerId: validated.ownerId,
      projectId: validated.projectId,
      idempotencyKey: validated.idempotencyKey,
      instruction: validated.instruction,
      baseRevision: validated.baseRevision,
      catalogVersion: ATLAS_AGENT_CATALOG_VERSION,
      catalogDigest: ATLAS_AGENT_CATALOG_DIGEST,
      requestDigest,
      now: Date.now(),
    });
    return {
      ...result,
      queuePayload: { runId: result.run.id, ownerId: validated.ownerId, projectId: validated.projectId, requestDigest, snapshot: validated.snapshot },
    };
  }

  async processRun(payload: AtlasAgentQueuePayload, attempt = { number: 1, maximum: 1 }) {
    assertSafeJson(payload, { maxDepth: 16, maxNodes: 60_000, maxStringLength: 20_000 });
    if (!payload || typeof payload !== "object" || Array.isArray(payload)
      || Object.keys(payload).some((key) => !["runId", "ownerId", "projectId", "requestDigest", "snapshot"].includes(key))) {
      throw new AtlasAgentProtocolError(400, "AGENT_QUEUE_PAYLOAD_INVALID", "Agent 队列数据格式无效");
    }
    boundedText(payload.runId, "任务标识", 128);
    boundedText(payload.ownerId, "用户标识", 128);
    boundedText(payload.projectId, "项目标识", 128);
    if (!/^[a-f0-9]{64}$/.test(payload.requestDigest)) throw new AtlasAgentProtocolError(400, "AGENT_QUEUE_PAYLOAD_INVALID", "Agent 请求摘要无效");
    const snapshot = parseAtlasAgentSemanticSnapshot(payload.snapshot);
    const run = this.store.readRun(payload.runId);
    if (!run) return null;
    if (["queued", "planning"].includes(run.status)
      && (run.catalogVersion !== ATLAS_AGENT_CATALOG_VERSION || run.catalogDigest !== ATLAS_AGENT_CATALOG_DIGEST)) {
      this.store.failRun(run.id, "AGENT_CATALOG_MISMATCH", Date.now());
      throw new AtlasAgentProtocolError(409, "AGENT_CATALOG_MISMATCH", "Agent 工具目录已经更新，请重新发起指令");
    }
    if (run.ownerId !== payload.ownerId || run.projectId !== payload.projectId || run.requestDigest !== payload.requestDigest || snapshot.revision !== run.baseRevision) {
      this.store.failRun(run.id, "AGENT_QUEUE_PAYLOAD_MISMATCH", Date.now());
      throw new AtlasAgentProtocolError(409, "AGENT_QUEUE_PAYLOAD_MISMATCH", "Agent 队列数据与任务不一致");
    }
    if (!["queued", "planning"].includes(run.status)) return run;
    const claimed = this.store.claimPlanning(run.id, Date.now());
    if (!claimed || claimed.status !== "planning") return claimed;
    const controller = new AbortController();
    this.activeControllers.set(run.id, controller);
    const cancellationPoll = setInterval(() => {
      if (this.store.readRun(run.id)?.status === "cancelled") controller.abort();
    }, 250);
    cancellationPoll.unref();
    safeLog("info", { type: "atlas_agent_planning_started", runId: run.id, userId: run.ownerId, projectId: run.projectId, attempt: attempt.number });
    try {
      const response = await this.provider.createPlan({ instruction: run.instruction, snapshot, maxToolCalls: this.maxToolCalls }, controller.signal);
      const current = this.store.readRun(run.id);
      if (!current || current.status === "cancelled") return current;
      const plan = normalizeAtlasAgentPlan(response.plan, { runId: run.id, baseRevision: run.baseRevision, maxToolCalls: this.maxToolCalls });
      const saved = this.store.savePlan(run.id, plan, Date.now());
      safeLog("info", {
        type: "atlas_agent_plan_ready", runId: run.id, userId: run.ownerId, projectId: run.projectId,
        operationCount: plan.operations.length, requiresConfirmation: plan.operations.some((operation) => operation.requiresConfirmation),
        providerRequestId: response.requestId,
      });
      return saved;
    } catch (error) {
      const cancelled = this.store.readRun(run.id);
      if (cancelled?.status === "cancelled") return cancelled;
      const retryable = error instanceof AtlasAgentProviderError && error.retryable;
      const finalAttempt = attempt.number >= attempt.maximum;
      const errorCode = error instanceof AtlasAgentProviderError || error instanceof AtlasAgentProtocolError ? error.code : "AGENT_PROVIDER_UNKNOWN_ERROR";
      safeLog(retryable && !finalAttempt ? "warn" : "error", {
        type: retryable && !finalAttempt ? "atlas_agent_plan_retry" : "atlas_agent_plan_failed",
        runId: run.id, userId: run.ownerId, projectId: run.projectId, errorCode, attempt: attempt.number,
      });
      if (!retryable || finalAttempt) this.store.failRun(run.id, errorCode, Date.now());
      throw error;
    } finally {
      clearInterval(cancellationPoll);
      if (this.activeControllers.get(run.id) === controller) this.activeControllers.delete(run.id);
    }
  }

  getRun(ownerId: string, runId: string) {
    const run = this.store.readRun(runId, ownerId);
    if (!run) throw new AtlasAgentProtocolError(404, "AGENT_RUN_NOT_FOUND", "Agent 任务不存在");
    return run;
  }

  listEvents(ownerId: string, runId: string, afterSequence = 0, limit = 200) {
    return this.store.listEvents(runId, ownerId, afterSequence, limit);
  }

  private requireActiveLease(run: AtlasAgentRun, leaseToken: unknown) {
    if (typeof leaseToken !== "string" || leaseToken.trim().length < 32) {
      throw new AtlasAgentProtocolError(400, "AGENT_LEASE_REQUIRED", "请先取得项目编辑权");
    }
    const token = boundedText(leaseToken, "编辑租约", 256);
    if (!this.executionAuthorizer.hasActiveLease({ ownerId: run.ownerId, projectId: run.projectId, leaseToken: token, now: Date.now() })) {
      throw new AtlasAgentProtocolError(409, "AGENT_LEASE_LOST", "项目编辑权已失效，请重新接管后执行 Agent 计划");
    }
  }

  confirmRun(ownerId: string, runId: string, approved: boolean, leaseToken: string) {
    const run = this.getRun(ownerId, runId);
    this.requireActiveLease(run, leaseToken);
    return this.store.confirmRun(runId, ownerId, approved, Date.now());
  }

  cancelRun(ownerId: string, runId: string) {
    const cancelled = this.store.cancelRun(runId, ownerId, Date.now());
    this.activeControllers.get(runId)?.abort();
    return cancelled;
  }

  recordOperationResult(ownerId: string, runId: string, input: AtlasAgentOperationResultInput) {
    assertSafeJson(input, { maxDepth: 12, maxNodes: 3_000, maxStringLength: 20_000 });
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new AtlasAgentProtocolError(400, "AGENT_RESULT_INVALID", "操作回执格式无效");
    const allowed = new Set(["sequence", "planDigest", "status", "result", "beforeRevision", "afterRevision", "historyNodeId", "requestDigest", "leaseToken"]);
    if (Object.keys(input).some((key) => !allowed.has(key))) throw new AtlasAgentProtocolError(400, "AGENT_RESULT_INVALID", "操作回执包含未知字段");
    const run = this.getRun(ownerId, runId);
    if (!run.plan) throw new AtlasAgentProtocolError(409, "AGENT_PLAN_NOT_READY", "Agent 操作计划尚未就绪");
    if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) throw new AtlasAgentProtocolError(400, "AGENT_RESULT_INVALID", "操作序号无效");
    if (input.planDigest !== run.plan.planDigest) throw new AtlasAgentProtocolError(409, "AGENT_PLAN_CHANGED", "Agent 操作计划已经变化");
    if (!(["succeeded", "failed"] as const).includes(input.status)) throw new AtlasAgentProtocolError(400, "AGENT_RESULT_INVALID", "操作状态无效");
    if (!Number.isSafeInteger(input.beforeRevision) || input.beforeRevision < 0 || !Number.isSafeInteger(input.afterRevision) || input.afterRevision < 0) throw new AtlasAgentProtocolError(400, "AGENT_RESULT_INVALID", "操作版本无效");
    if (input.historyNodeId !== undefined) boundedText(input.historyNodeId, "历史节点", 128);
    const operation = run.plan.operations[input.sequence - 1];
    if (!operation || operation.sequence !== input.sequence) throw new AtlasAgentProtocolError(400, "AGENT_RESULT_INVALID", "操作序号不在计划内");
    const receiptDigest = atlasAgentResultReceiptDigest({
      runId, sequence: input.sequence, planDigest: input.planDigest, status: input.status, result: input.result,
      beforeRevision: input.beforeRevision, afterRevision: input.afterRevision, historyNodeId: input.historyNodeId,
    });
    if (input.requestDigest !== undefined && input.requestDigest !== receiptDigest) throw new AtlasAgentProtocolError(409, "AGENT_RESULT_DIGEST_INVALID", "操作回执摘要不一致");
    // A lost HTTP response must be recoverable even when the editor lease expires
    // before retry. The authenticated owner may only retrieve the byte-identical
    // durable receipt; any new or conflicting mutation still requires a live lease.
    const existing = this.store.readOperation(runId, ownerId, input.sequence);
    if (existing?.requestDigest === receiptDigest && existing.planDigest === input.planDigest) {
      return { kind: "duplicate" as const, receipt: existing, run, requestDigest: receiptDigest };
    }
    this.requireActiveLease(run, input.leaseToken);
    if (input.status === "succeeded" && operation.tool !== "request_export") {
      if (!input.historyNodeId) throw new AtlasAgentProtocolError(400, "AGENT_HISTORY_REQUIRED", "编辑操作必须归入可撤销事务");
      if (!input.result || typeof input.result !== "object" || Array.isArray(input.result)
        || (input.result as { changed?: unknown }).changed !== true) {
        throw new AtlasAgentProtocolError(409, "AGENT_OPERATION_NOT_APPLIED", "编辑器未确认操作已经生效");
      }
    }
    if (operation.tool === "request_export") {
      if (input.historyNodeId !== undefined) throw new AtlasAgentProtocolError(400, "AGENT_EXPORT_HISTORY_INVALID", "导出操作不能伪装成可撤销编辑");
      if (input.status === "succeeded") {
        const result = input.result as { status?: unknown; assetId?: unknown } | null;
        if (!result || typeof result !== "object" || result.status !== "ready"
          || typeof result.assetId !== "string" || !result.assetId.trim()) {
          throw new AtlasAgentProtocolError(409, "AGENT_EXPORT_NOT_READY", "导出尚未完成归档，不能标记为成功");
        }
        const asset = this.executionAuthorizer.resolveExportAsset({ ownerId, projectId: run.projectId, assetId: result.assetId.trim() });
        if (!asset || asset.ownerId !== ownerId || asset.projectId !== run.projectId
          || asset.status !== "ready" || asset.sourceType !== "atlas_export") {
          throw new AtlasAgentProtocolError(409, "AGENT_EXPORT_NOT_READY", "导出资产尚未通过项目归档校验");
        }
      }
    }
    const stored = this.store.recordOperationResult({
      runId, ownerId, sequence: input.sequence, plan: run.plan, requestDigest: receiptDigest, status: input.status,
      risk: operation.risk, requiresConfirmation: operation.requiresConfirmation, result: input.result,
      beforeRevision: input.beforeRevision, afterRevision: input.afterRevision, historyNodeId: input.historyNodeId, now: Date.now(),
    });
    if (stored.kind === "digest_conflict") throw new AtlasAgentProtocolError(409, "OPERATION_REPLAY_CONFLICT", "同一操作序号收到了不同回执");
    return { ...stored, requestDigest: receiptDigest };
  }
}

const safeSseEventName = (value: string) => /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : "message";

export const formatAtlasAgentSseEvent = (event: AtlasAgentEvent) => {
  assertSafeJson(event.payload);
  return `id: ${event.sequence}\nevent: ${safeSseEventName(event.type)}\ndata: ${JSON.stringify(event.payload)}\n\n`;
};
