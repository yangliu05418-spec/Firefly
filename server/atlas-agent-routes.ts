import express, { type Request, type RequestHandler, type Response } from "express";
import { AtlasAgentProtocolError } from "./atlas-agent-contract.js";
import { type AtlasAgentQueuePayload, AtlasAgentService, formatAtlasAgentSseEvent } from "./atlas-agent-service.js";

export type AtlasAgentQueue = {
  add: (name: string, payload: AtlasAgentQueuePayload, options: {
    jobId: string; attempts: number; backoff: { type: "exponential"; delay: number };
    removeOnComplete: number; removeOnFail: number;
  }) => Promise<unknown>;
};

export type AtlasAgentRouterDependencies = {
  service: AtlasAgentService;
  queue: AtlasAgentQueue;
  requireAuth: RequestHandler;
  enabled?: boolean;
  eventPollIntervalMs?: number;
};

const route = (handler: (request: Request, response: Response) => Promise<unknown> | unknown): RequestHandler =>
  (request, response, next) => void Promise.resolve().then(() => handler(request, response)).catch((error) => {
    if (error instanceof AtlasAgentProtocolError) return response.status(error.status).json({ error: error.message, code: error.code });
    next(error);
  });

const userId = (response: Response) => {
  const value = (response.locals.user as { id?: unknown } | undefined)?.id;
  if (typeof value !== "string" || !value) throw new AtlasAgentProtocolError(401, "ATLAS_AUTH_REQUIRED", "请使用企业飞书账号登录");
  return value;
};
const parameter = (value: string | string[]) => Array.isArray(value) ? value[0] : value;
const publicRun = (run: ReturnType<AtlasAgentService["getRun"]>) => ({
  id: run.id, projectId: run.projectId, status: run.status, instruction: run.instruction,
  baseRevision: run.baseRevision, catalogVersion: run.catalogVersion, catalogDigest: run.catalogDigest,
  plan: run.plan, errorCode: run.errorCode, createdAt: run.createdAt, updatedAt: run.updatedAt, completedAt: run.completedAt,
});
const runInProject = (service: AtlasAgentService, ownerId: string, projectId: string, runId: string) => {
  const run = service.getRun(ownerId, runId);
  if (run.projectId !== projectId) throw new AtlasAgentProtocolError(404, "AGENT_RUN_NOT_FOUND", "Agent 任务不存在");
  return run;
};
const eventCursor = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new AtlasAgentProtocolError(400, "AGENT_EVENT_CURSOR_INVALID", "Agent 事件游标无效");
  return parsed;
};

export const createAtlasAgentRouter = (dependencies: AtlasAgentRouterDependencies) => {
  const router = express.Router();
  const pollIntervalMs = Math.max(250, Math.min(5_000, dependencies.eventPollIntervalMs ?? 1_000));
  // Scope authentication and the optional feature gate to Agent paths. A
  // disabled Agent must never intercept Atlas bootstrap or project CRUD.
  router.use("/projects/:projectId/agent", (_request, response, next) => dependencies.enabled === false
    ? response.status(404).json({ error: "Atlas Agent 尚未开放", code: "ATLAS_AGENT_DISABLED" })
    : next());
  router.use("/projects/:projectId/agent", dependencies.requireAuth);

  router.get("/projects/:projectId/agent/capabilities", route((request, response) => {
    const ownerId = userId(response);
    const projectId = parameter(request.params.projectId);
    response.json(dependencies.service.capabilities(ownerId, projectId));
  }));

  router.post("/projects/:projectId/agent/runs", route(async (request, response) => {
    const ownerId = userId(response);
    const projectId = parameter(request.params.projectId);
    const body = request.body as Record<string, unknown> | undefined;
    const allowed = new Set(["idempotencyKey", "instruction", "baseRevision", "snapshot"]);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !allowed.has(key))) {
      throw new AtlasAgentProtocolError(400, "AGENT_INPUT_INVALID", "Agent 请求格式无效");
    }
    const created = dependencies.service.createRun({
      ownerId,
      projectId,
      idempotencyKey: body?.idempotencyKey as string,
      instruction: body?.instruction as string,
      baseRevision: body?.baseRevision as number,
      snapshot: body?.snapshot,
    });
    if (["queued", "planning"].includes(created.run.status)) {
      try {
        await dependencies.queue.add("plan", created.queuePayload, {
          jobId: created.run.id,
          attempts: 3,
          backoff: { type: "exponential", delay: 2_000 },
          removeOnComplete: 1_000,
          removeOnFail: 1_000,
        });
      } catch {
        throw new AtlasAgentProtocolError(503, "AGENT_QUEUE_UNAVAILABLE", "Agent 队列暂时不可用，请使用相同幂等键重试");
      }
    }
    response.status(202).json(publicRun(created.run));
  }));

  router.get("/projects/:projectId/agent/runs/:runId", route((request, response) => {
    const run = runInProject(dependencies.service, userId(response), parameter(request.params.projectId), parameter(request.params.runId));
    response.json(publicRun(run));
  }));

  router.get("/projects/:projectId/agent/runs/:runId/events", route((request, response) => {
    const ownerId = userId(response);
    const projectId = parameter(request.params.projectId);
    const runId = parameter(request.params.runId);
    runInProject(dependencies.service, ownerId, projectId, runId);
    let cursor = eventCursor(request.headers["last-event-id"] ?? (request.query.after as string | string[] | undefined));
    let closed = false;
    let syncing = false;
    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();
    response.write("retry: 3000\n\n");
    const sync = () => {
      if (closed || syncing) return;
      syncing = true;
      try {
        const events = dependencies.service.listEvents(ownerId, runId, cursor, 200);
        for (const event of events) {
          response.write(formatAtlasAgentSseEvent(event));
          cursor = event.sequence;
        }
      } catch {
        response.write("event: stream_error\ndata: {\"code\":\"AGENT_EVENT_STREAM_FAILED\"}\n\n");
        response.end();
        closed = true;
      } finally { syncing = false; }
    };
    sync();
    const poll = setInterval(sync, pollIntervalMs);
    poll.unref();
    const heartbeat = setInterval(() => { if (!closed) response.write(": heartbeat\n\n"); }, 15_000);
    heartbeat.unref();
    response.on("close", () => {
      closed = true;
      clearInterval(poll);
      clearInterval(heartbeat);
    });
  }));

  router.post("/projects/:projectId/agent/runs/:runId/confirm", route((request, response) => {
    const ownerId = userId(response);
    const projectId = parameter(request.params.projectId);
    const runId = parameter(request.params.runId);
    runInProject(dependencies.service, ownerId, projectId, runId);
    if (!request.body || typeof request.body.approved !== "boolean" || typeof request.body.leaseToken !== "string"
      || Object.keys(request.body).some((key) => !["approved", "leaseToken"].includes(key))) {
      throw new AtlasAgentProtocolError(400, "AGENT_CONFIRMATION_INVALID", "确认参数无效");
    }
    response.json(publicRun(dependencies.service.confirmRun(ownerId, runId, request.body.approved, request.body.leaseToken)));
  }));

  router.post("/projects/:projectId/agent/runs/:runId/operation-results", route((request, response) => {
    const ownerId = userId(response);
    const projectId = parameter(request.params.projectId);
    const runId = parameter(request.params.runId);
    runInProject(dependencies.service, ownerId, projectId, runId);
    const result = dependencies.service.recordOperationResult(ownerId, runId, request.body);
    response.status(result.kind === "duplicate" ? 200 : 201).json({
      duplicate: result.kind === "duplicate",
      requestDigest: result.requestDigest,
      run: publicRun(result.run),
      receipt: result.receipt,
    });
  }));

  router.post("/projects/:projectId/agent/runs/:runId/execution-results", route((request, response) => {
    const ownerId = userId(response);
    const projectId = parameter(request.params.projectId);
    const runId = parameter(request.params.runId);
    runInProject(dependencies.service, ownerId, projectId, runId);
    const result = dependencies.service.recordExecutionResults(ownerId, runId, request.body);
    response.status(result.kind === "duplicate" ? 200 : 201).json({
      duplicate: result.kind === "duplicate",
      run: publicRun(result.run),
      ...("requestDigest" in result ? { requestDigest: result.requestDigest } : {}),
      ...("receipt" in result ? { receipt: result.receipt } : {}),
    });
  }));

  router.post("/projects/:projectId/agent/runs/:runId/cancel", route((request, response) => {
    const ownerId = userId(response);
    const projectId = parameter(request.params.projectId);
    const runId = parameter(request.params.runId);
    runInProject(dependencies.service, ownerId, projectId, runId);
    response.json(publicRun(dependencies.service.cancelRun(ownerId, runId)));
  }));

  return router;
};
