import { config } from "./config.js";
import { AtlasAgentProtocolError, assertSafeJson, atlasAgentCatalogForPhase, validateAtlasAgentJsonSchema, type AtlasAgentPhase, type AtlasAgentSemanticSnapshot } from "./atlas-agent-contract.js";
import { fetchOpenRouterJsonWithinDeadline, openRouterPool, type OpenRouterKeyPool } from "./openrouter.js";

export type AtlasAgentProviderInput = { instruction: string; snapshot: AtlasAgentSemanticSnapshot; maxToolCalls: number; maxRounds?: number; phase?: AtlasAgentPhase; catalogVersion?: string; catalogDigest?: string };
export type AtlasAgentProviderResult = { plan: unknown; requestId?: string; rounds?: number; catalogInspections?: number; repaired?: boolean };
export interface AtlasAgentProvider { createPlan(input: AtlasAgentProviderInput, signal?: AbortSignal): Promise<AtlasAgentProviderResult> }
export class AtlasAgentProviderError extends Error {
  readonly code: string; readonly retryable: boolean; readonly status?: number;
  constructor(code: string, message: string, retryable: boolean, status?: number) { super(message); this.name = "AtlasAgentProviderError"; this.code = code; this.retryable = retryable; this.status = status; }
}
const positiveInteger = (value: string | undefined, fallback: number) => { const parsed = Number(value ?? fallback); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; };
export const atlasAgentProviderDefaults = () => ({ model: config.atlasAgentModel, timeoutMs: positiveInteger(String(config.atlasAgentRequestTimeoutMs), 180_000), maxRounds: positiveInteger(String(config.atlasAgentMaxRounds), 8) });
const systemInstruction = [
  "你是 Firefly Atlas 视频编辑器的只读操作规划器。",
  "只能查询目录、读取有界快照并通过 submit_plan 提交计划；不能直接执行编辑。",
  "先按需查询工具契约，不得猜测工具名、参数、实体ID或素材。",
  "operations 的 sequence 必须从1连续递增；只引用快照中存在的稳定ID。",
  "所有计划都会由用户确认并由浏览器再次校验。必须调用 submit_plan。",
].join("\n");
const metaTools = [
  { type: "function", function: { name: "list_categories", description: "列出当前阶段可用的工具类别", parameters: { type: "object", additionalProperties: false, properties: {} } } },
  { type: "function", function: { name: "get_tool_contracts", description: "按类别或工具名读取原子工具契约", parameters: { type: "object", additionalProperties: false, properties: { category: { type: "string" }, names: { type: "array", maxItems: 12, items: { type: "string" } } } } } },
  { type: "function", function: { name: "inspect_snapshot", description: "读取语义快照的一个有界分区", parameters: { type: "object", additionalProperties: false, properties: { section: { type: "string", enum: ["summary", "tracks", "clips", "assets", "selection", "markers"] }, ids: { type: "array", maxItems: 50, items: { type: "string" } } }, required: ["section"] } } },
  { type: "function", function: { name: "submit_plan", description: "提交最终操作计划", parameters: { type: "object", additionalProperties: false, properties: { version: { type: "integer", enum: [1] }, summary: { type: "string", minLength: 1, maxLength: 500 }, operations: { type: "array", minItems: 1, maxItems: 32, items: { type: "object", additionalProperties: false, properties: { sequence: { type: "integer", minimum: 1 }, tool: { type: "string" }, args: { type: "object" } }, required: ["sequence", "tool", "args"] } } }, required: ["version", "summary", "operations"] } } },
] as const;
type ProviderOptions = { model?: string; timeoutMs?: number; maxRounds?: number; baseUrl?: string; origin?: string; keyPool?: OpenRouterKeyPool; fetchImpl?: typeof fetch };
type ChatMessage = Record<string, unknown>;
const parseArguments = (value: unknown) => { try { const parsed = JSON.parse(typeof value === "string" ? value : "{}"); assertSafeJson(parsed); return parsed as Record<string, unknown>; } catch { throw new AtlasAgentProviderError("AGENT_PROVIDER_INVALID_TOOL_ARGUMENTS", "Agent 返回了无效的工具参数", false); } };
const responseMessage = (data: unknown) => {
  const choices = data && typeof data === "object" ? (data as { choices?: unknown }).choices : undefined;
  const message = Array.isArray(choices) && choices[0] && typeof choices[0] === "object" ? (choices[0] as { message?: unknown }).message : undefined;
  if (!message || typeof message !== "object") throw new AtlasAgentProviderError("AGENT_PROVIDER_EMPTY_RESPONSE", "Agent 服务没有返回操作计划", false);
  return message as Record<string, unknown>;
};

export class OpenRouterAtlasAgentProvider implements AtlasAgentProvider {
  private readonly model: string; private readonly timeoutMs: number; private readonly maxRounds: number; private readonly baseUrl: string; private readonly origin: string; private readonly keyPool: OpenRouterKeyPool; private readonly fetchImpl: typeof fetch;
  constructor(options: ProviderOptions = {}) {
    const defaults = atlasAgentProviderDefaults(); this.model = options.model ?? defaults.model; this.timeoutMs = options.timeoutMs ?? defaults.timeoutMs; this.maxRounds = options.maxRounds ?? defaults.maxRounds;
    this.baseUrl = (options.baseUrl ?? config.openrouterBaseUrl).replace(/\/$/, ""); this.origin = options.origin ?? config.origin; this.keyPool = options.keyPool ?? openRouterPool(); this.fetchImpl = options.fetchImpl ?? fetch;
  }
  private async complete(messages: ChatMessage[], signal?: AbortSignal) {
    let lastError = new AtlasAgentProviderError("AGENT_PROVIDER_UNAVAILABLE", "Agent 服务暂时不可用，请稍后重试", true, 503);
    for (let attempt = 0; attempt < Math.max(1, this.keyPool.size); attempt += 1) {
      const key = this.keyPool.next(); if (!key) throw lastError;
      try {
        const fetchImpl: typeof fetch = signal ? (url, init = {}) => this.fetchImpl(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, signal]) : signal }) : this.fetchImpl;
        const result = await fetchOpenRouterJsonWithinDeadline(`${this.baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": this.origin, "X-Title": "Firefly Atlas" }, body: JSON.stringify({ model: this.model, temperature: 0, messages, tools: metaTools, tool_choice: "required", provider: { require_parameters: true } }) }, this.timeoutMs, fetchImpl);
        const requestId = result.response.headers.get("x-request-id") ?? result.response.headers.get("x-openrouter-request-id") ?? undefined;
        if (result.response.ok) { this.keyPool.reportSuccess(key); return { message: responseMessage(result.data), requestId }; }
        const status = result.response.status; this.keyPool.reportFailure(key, status);
        if (status === 401 || status === 403) throw new AtlasAgentProviderError("AGENT_PROVIDER_UNAUTHORIZED", "Agent 模型未授权，请联系管理员", false, status);
        if (status === 429 || status >= 500) { lastError = new AtlasAgentProviderError(status === 429 ? "AGENT_PROVIDER_RATE_LIMITED" : "AGENT_PROVIDER_UNAVAILABLE", "Agent 服务繁忙，请稍后重试", true, status); continue; }
        throw new AtlasAgentProviderError("AGENT_PROVIDER_REJECTED", "Agent 服务拒绝了当前请求", false, status);
      } catch (error) {
        if (signal?.aborted) throw new AtlasAgentProviderError("AGENT_PROVIDER_CANCELLED", "Agent 任务已取消", false);
        if (error instanceof AtlasAgentProviderError || error instanceof AtlasAgentProtocolError) { if (error instanceof AtlasAgentProviderError && error.retryable) { lastError = error; continue; } throw error; }
        this.keyPool.reportFailure(key, "network"); lastError = new AtlasAgentProviderError("AGENT_PROVIDER_NETWORK_ERROR", "Agent 服务网络异常，请稍后重试", true);
      }
    }
    throw lastError;
  }
  async createPlan(input: AtlasAgentProviderInput, signal?: AbortSignal): Promise<AtlasAgentProviderResult> {
    const catalog = atlasAgentCatalogForPhase(input.phase ?? "full");
    if ((input.catalogVersion && catalog.version !== input.catalogVersion) || (input.catalogDigest && catalog.digest !== input.catalogDigest)) throw new AtlasAgentProtocolError(409, "AGENT_CATALOG_MISMATCH", "Agent工具目录已经更新");
    const categories = [...new Map(catalog.tools.map((tool) => [tool.category, tool.categoryLabel])).entries()].map(([id, label]) => ({ id, label }));
    const definitions = new Map<string, (typeof catalog.tools)[number]>(catalog.tools.map((tool) => [tool.name, tool]));
    const validateSubmittedPlan = (value: Record<string, unknown>) => {
      const operations = Array.isArray(value.operations) ? value.operations : [];
      if (value.version !== 1 || typeof value.summary !== "string" || !value.summary.trim() || value.summary.length > 500 || operations.length < 1 || operations.length > input.maxToolCalls) return "计划顶层结构无效";
      for (let index = 0; index < operations.length; index += 1) {
        const operation = operations[index];
        if (!operation || typeof operation !== "object" || Array.isArray(operation)) return `第${index + 1}步结构无效`;
        const item = operation as Record<string, unknown>; const definition = typeof item.tool === "string" ? definitions.get(item.tool) : undefined;
        if (item.sequence !== index + 1 || !definition) return `第${index + 1}步工具或序号无效`;
        const validation = validateAtlasAgentJsonSchema(definition.schema, item.args);
        if (!validation.valid) return `第${index + 1}步参数无效：${validation.message}`;
      }
      return null;
    };
    const messages: ChatMessage[] = [{ role: "system", content: systemInstruction }, { role: "user", content: JSON.stringify({ instruction: input.instruction, project: { revision: input.snapshot.revision, durationMs: input.snapshot.durationMs, trackCount: input.snapshot.tracks.length, clipCount: input.snapshot.clips.length, assetCount: input.snapshot.assets.length }, selection: input.snapshot.selection, catalog: { version: catalog.version, digest: catalog.digest, categories }, maxToolCalls: input.maxToolCalls }) }];
    let requestId: string | undefined; let inspections = 0; let repaired = false; let repairUsed = false;
    for (let round = 1; round <= Math.min(this.maxRounds, input.maxRounds ?? this.maxRounds); round += 1) {
      const completion = await this.complete(messages, signal); requestId = completion.requestId ?? requestId;
      const toolCalls = Array.isArray(completion.message.tool_calls) ? completion.message.tool_calls as Array<Record<string, unknown>> : [];
      if (!toolCalls.length) throw new AtlasAgentProviderError("AGENT_PROVIDER_TOOL_CALL_REQUIRED", "Agent 没有提交可执行计划", false);
      messages.push({ role: "assistant", content: completion.message.content ?? null, tool_calls: toolCalls });
      for (const call of toolCalls) {
        const fn = call.function && typeof call.function === "object" ? call.function as Record<string, unknown> : {}; const name = String(fn.name ?? ""); const args = parseArguments(fn.arguments); const toolCallId = String(call.id ?? `round-${round}`); let output: unknown;
        if (name === "list_categories") output = { categories };
        else if (name === "get_tool_contracts") { const names = Array.isArray(args.names) ? args.names.filter((value): value is string => typeof value === "string").slice(0, 12) : []; output = { tools: catalog.tools.filter((tool) => names.includes(tool.name) || (!names.length && tool.category === args.category)).slice(0, 12) }; inspections += 1; }
        else if (name === "inspect_snapshot") { const ids = new Set(Array.isArray(args.ids) ? args.ids.filter((value): value is string => typeof value === "string").slice(0, 50) : []); const section = String(args.section); if (section === "summary") output = { revision: input.snapshot.revision, durationMs: input.snapshot.durationMs, counts: { tracks: input.snapshot.tracks.length, clips: input.snapshot.clips.length, assets: input.snapshot.assets.length, markers: input.snapshot.markers?.length ?? 0 } }; else { const value = input.snapshot[section as "tracks" | "clips" | "assets" | "selection" | "markers"]; output = Array.isArray(value) && ids.size ? value.filter((item) => item && typeof item === "object" && ids.has(String((item as { id?: unknown }).id))) : value; } inspections += 1; }
        else if (name === "submit_plan") { try { assertSafeJson(args, { maxDepth: 16, maxNodes: 20_000, maxStringLength: 5_000 }); const validationError = validateSubmittedPlan(args); if (validationError) throw new AtlasAgentProtocolError(422, "AGENT_PLAN_INVALID", validationError); return { plan: args, requestId, rounds: round, catalogInspections: inspections, repaired }; } catch (error) { if (repairUsed) throw error; repairUsed = true; repaired = true; output = { error: error instanceof Error ? error.message.slice(0, 500) : "计划结构无效", instruction: "仅修正该校验错误并重新调用 submit_plan" }; } }
        else output = { error: "未知元工具" };
        messages.push({ role: "tool", tool_call_id: toolCallId, content: JSON.stringify(output) });
      }
    }
    throw new AtlasAgentProviderError("AGENT_PROVIDER_MAX_ROUNDS", "Agent 规划超过轮次上限，请简化指令后重试", false);
  }
}
