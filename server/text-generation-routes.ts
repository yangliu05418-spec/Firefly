import type { Express, Response } from "express";
import type { Redis } from "ioredis";
import { config } from "./config.js";
import { requireAuth, type SessionUser } from "./auth.js";
import { users } from "./store.js";
import { OpenRouterKeyPool } from "./openrouter.js";
import { textModelCatalog } from "./text-model-catalog.js";
import { consumeTextResponse, textFailure, textRequestBody, textRequestSchema, TextGenerationError } from "./text-generation.js";

const pool = new OpenRouterKeyPool(config.openrouterApiKeys);
const durationMs = 10 * 60_000;
const admissionScript = `
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1])
if redis.call('EXISTS',KEYS[2]) == 1 then return 0 end
if redis.call('ZCARD',KEYS[1]) >= 3 then return -1 end
redis.call('ZADD',KEYS[1],ARGV[2],ARGV[3]); redis.call('PEXPIRE',KEYS[1],ARGV[4])
redis.call('SET',KEYS[2],'accepted','PX',86400000)
return 1`;
// Authentication/same-origin checks run before this router in the application.
export function registerTextGenerationRoutes(app: Express, redis: Redis) {
  app.get("/api/text-models", requireAuth, (_req, res) => res.json({ items: textModelCatalog(), configured: pool.size > 0 }));
  app.post("/api/text-generations", requireAuth, async (req, res) => {
    const user = res.locals.user as SessionUser;
    const parsed = textRequestSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "请输入内容并选择支持的文本模型与创作会话。", code: "TEXT_INVALID_REQUEST" }); return; }
    const input = parsed.data;
    const session = users.readCreationSession(input.sessionId);
    if (!session || session.ownerId !== user.id || session.deletedAt) { res.status(404).json({ error: "创作会话不可用" }); return; }
    const key = pool.next();
    if (!key) { res.status(503).json(textFailure(new TextGenerationError("TEXT_AUTH_FAILED"))); return; }
    const leaseKey = `text:active:${user.id}`;
    const requestKey = `text:request:${user.id}:${input.requestId}`;
    let admitted: number;
    try { admitted = Number(await redis.eval(admissionScript, 2, leaseKey, requestKey, Date.now(), Date.now() + durationMs + 30_000, input.requestId, durationMs + 30_000)); }
    catch { res.status(503).json({ code: "TEXT_ADMISSION_UNAVAILABLE", error: "服务暂时无法接纳请求，请稍后重试。" }); return; }
    if (admitted !== 1) { res.status(admitted === 0 ? 409 : 429).json({ code: admitted === 0 ? "TEXT_ALREADY_ADMITTED" : "TEXT_CONCURRENCY_LIMIT", error: admitted === 0 ? "本次请求已接纳，不会重复生成。请查看已有输出。" : "已有三个文本请求正在生成，请等待完成或停止后重试。" }); return; }
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("TEXT_TIMEOUT")), durationMs);
    const abort = () => { if (!res.writableEnded) controller.abort(new Error("CLIENT_DISCONNECTED")); };
    res.once("close", abort);
    const log = (event: string, extra: Record<string, unknown> = {}) => console.info(JSON.stringify({ type: event, userId: user.id, caseId: res.locals.requestId, requestId: input.requestId, sessionId: input.sessionId, model: input.model, elapsedMs: Date.now() - startedAt, ...extra }));
    res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const heartbeat = setInterval(() => { if (!res.destroyed) res.write(": keepalive\n\n"); }, 15_000);
    log("text_generation_started");
    try {
      users.touchCreationSession(input.sessionId, user.id, input.prompt);
      const response = await fetch(`${config.openrouterBaseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": config.origin, "X-OpenRouter-Title": "Firefly Studio" },
        body: JSON.stringify(textRequestBody(input.model, input.prompt)), signal: controller.signal,
      });
      const providerId = response.headers.get("x-generation-id");
      await consumeTextResponse(response, (event) => writeEvent(res, event, controller.signal));
      pool.reportSuccess(key);
      log("text_generation_completed", { providerId });
    } catch (error) {
      const timeoutError = controller.signal.aborted && controller.signal.reason?.message === "TEXT_TIMEOUT";
      const failure = textFailure(timeoutError ? new TextGenerationError("TEXT_TIMEOUT") : error);
      if (error instanceof TextGenerationError && [401, 429].includes(error.status)) pool.reportFailure(key, error.status);
      log(controller.signal.aborted && !timeoutError ? "text_generation_cancelled" : "text_generation_failed", { code: failure.code });
      if (!res.destroyed) res.write(`data: ${JSON.stringify({ type: "error", ...failure, requestId: res.locals.requestId })}\n\n`);
    } finally {
      clearTimeout(timeout); clearInterval(heartbeat); res.removeListener("close", abort);
      controller.abort();
      if (!res.destroyed) res.end();
      await redis.zrem(leaseKey, input.requestId).catch(() => log("text_generation_lease_release_failed"));
    }
  });
}

async function writeEvent(res: Response, event: unknown, signal: AbortSignal) {
  signal.throwIfAborted();
  if (res.destroyed) throw new Error("CLIENT_DISCONNECTED");
  if (res.write(`data: ${JSON.stringify(event)}\n\n`)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { res.off("drain", drain); signal.removeEventListener("abort", abort); };
    const drain = () => { cleanup(); resolve(); };
    const abort = () => { cleanup(); reject(signal.reason); };
    res.once("drain", drain); signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
