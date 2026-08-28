import { config } from "./config.js";
import {
  ATLAS_AGENT_CATALOG_DIGEST,
  ATLAS_AGENT_CATALOG_VERSION,
  ATLAS_AGENT_PLAN_JSON_SCHEMA,
  ATLAS_AGENT_TOOL_CATALOG,
  AtlasAgentProtocolError,
  assertSafeJson,
  type AtlasAgentSemanticSnapshot,
} from "./atlas-agent-contract.js";
import { fetchOpenRouterJsonWithinDeadline, openRouterPool, type OpenRouterKeyPool } from "./openrouter.js";

export type AtlasAgentProviderInput = {
  instruction: string;
  snapshot: AtlasAgentSemanticSnapshot;
  maxToolCalls: number;
};

export type AtlasAgentProviderResult = {
  plan: unknown;
  requestId?: string;
};

export interface AtlasAgentProvider {
  createPlan(input: AtlasAgentProviderInput, signal?: AbortSignal): Promise<AtlasAgentProviderResult>;
}

export class AtlasAgentProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(code: string, message: string, retryable: boolean, status?: number) {
    super(message);
    this.name = "AtlasAgentProviderError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

const positiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const atlasAgentProviderDefaults = () => ({
  model: config.atlasAgentModel || config.canvasTextModel,
  timeoutMs: positiveInteger(String(config.atlasAgentRequestTimeoutMs), 180_000),
});

const systemInstruction = [
  "你是 Firefly Atlas 视频编辑器的操作规划器。",
  "只能使用提供的原子工具，不得创造工具、URL、文件路径、素材或时间线实体。",
  "仅返回符合 JSON Schema 的操作计划；operations 的 sequence 必须从 1 连续递增。",
  "如需导出，request_export 最多出现一次且必须是 operations 的最后一步。",
  "删除和导出仍会由编辑器请求用户确认，不要尝试绕过确认。",
  "不要在 summary 或参数中复述用户隐私数据。",
].join("\n");

const extractContent = (data: unknown) => {
  if (!data || typeof data !== "object") throw new AtlasAgentProviderError("AGENT_PROVIDER_INVALID_RESPONSE", "Agent 服务返回了无效响应", false);
  const record = data as Record<string, unknown>;
  if (record.error && typeof record.error === "object") throw new AtlasAgentProviderError("AGENT_PROVIDER_REJECTED", "Agent 服务拒绝了当前请求", false, 400);
  const choices = record.choices;
  const message = Array.isArray(choices) && choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>).message : undefined;
  const content = message && typeof message === "object" ? (message as Record<string, unknown>).content : undefined;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((part) => {
    if (typeof part === "string") return part;
    if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") return String((part as Record<string, unknown>).text);
    return "";
  }).join("").trim();
  throw new AtlasAgentProviderError("AGENT_PROVIDER_EMPTY_RESPONSE", "Agent 服务没有返回操作计划", false);
};

const parsePlanJson = (text: string) => {
  const candidate = text.startsWith("```") ? text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "") : text;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    assertSafeJson(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof AtlasAgentProtocolError) throw error;
    throw new AtlasAgentProviderError("AGENT_PROVIDER_INVALID_JSON", "Agent 服务没有返回有效的操作计划", false);
  }
};

type ProviderOptions = {
  model?: string;
  timeoutMs?: number;
  baseUrl?: string;
  origin?: string;
  keyPool?: OpenRouterKeyPool;
  fetchImpl?: typeof fetch;
};

export class OpenRouterAtlasAgentProvider implements AtlasAgentProvider {
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly origin: string;
  private readonly keyPool: OpenRouterKeyPool;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ProviderOptions = {}) {
    const defaults = atlasAgentProviderDefaults();
    this.model = options.model ?? defaults.model;
    this.timeoutMs = options.timeoutMs ?? defaults.timeoutMs;
    this.baseUrl = (options.baseUrl ?? config.openrouterBaseUrl).replace(/\/$/, "");
    this.origin = options.origin ?? config.origin;
    this.keyPool = options.keyPool ?? openRouterPool();
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createPlan(input: AtlasAgentProviderInput, signal?: AbortSignal): Promise<AtlasAgentProviderResult> {
    const requestBody = {
      model: this.model,
      temperature: 0,
      messages: [
        { role: "system", content: systemInstruction },
        {
          role: "user",
          content: JSON.stringify({
            instruction: input.instruction,
            semanticSnapshot: input.snapshot,
            catalog: { version: ATLAS_AGENT_CATALOG_VERSION, digest: ATLAS_AGENT_CATALOG_DIGEST, tools: ATLAS_AGENT_TOOL_CATALOG },
            maxToolCalls: input.maxToolCalls,
          }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "atlas_operation_plan", strict: true, schema: ATLAS_AGENT_PLAN_JSON_SCHEMA },
      },
    };
    let lastError = new AtlasAgentProviderError("AGENT_PROVIDER_UNAVAILABLE", "Agent 服务暂时不可用，请稍后重试", true, 503);
    for (let attempt = 0; attempt < Math.max(1, this.keyPool.size); attempt += 1) {
      const key = this.keyPool.next();
      if (!key) throw lastError;
      try {
        const fetchImpl: typeof fetch = signal ? (url, init = {}) => {
          const signals = [init.signal, signal].filter((value): value is AbortSignal => Boolean(value));
          return this.fetchImpl(url, { ...init, signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals) });
        } : this.fetchImpl;
        const result = await fetchOpenRouterJsonWithinDeadline(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "HTTP-Referer": this.origin,
            "X-Title": "Firefly Atlas",
          },
          body: JSON.stringify(requestBody),
        }, this.timeoutMs, fetchImpl);
        const requestId = result.response.headers.get("x-request-id") ?? result.response.headers.get("x-openrouter-request-id") ?? undefined;
        if (result.response.ok) {
          this.keyPool.reportSuccess(key);
          return { plan: parsePlanJson(extractContent(result.data)), requestId };
        }
        const status = result.response.status;
        this.keyPool.reportFailure(key, status);
        if (status === 401 || status === 403) {
          lastError = new AtlasAgentProviderError("AGENT_PROVIDER_UNAUTHORIZED", "Agent 模型未授权，请联系管理员", false, status);
          if (status === 401) continue;
          throw lastError;
        }
        if (status === 429 || status >= 500) {
          lastError = new AtlasAgentProviderError(status === 429 ? "AGENT_PROVIDER_RATE_LIMITED" : "AGENT_PROVIDER_UNAVAILABLE", "Agent 服务繁忙，请稍后重试", true, status);
          continue;
        }
        throw new AtlasAgentProviderError("AGENT_PROVIDER_REJECTED", "Agent 服务拒绝了当前请求", false, status);
      } catch (error) {
        if (signal?.aborted) throw new AtlasAgentProviderError("AGENT_PROVIDER_CANCELLED", "Agent 任务已取消", false);
        if (error instanceof AtlasAgentProviderError || error instanceof AtlasAgentProtocolError) {
          if (error instanceof AtlasAgentProviderError && error.retryable) lastError = error;
          else throw error;
          continue;
        }
        this.keyPool.reportFailure(key, "network");
        lastError = new AtlasAgentProviderError(
          error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name) ? "AGENT_PROVIDER_TIMEOUT" : "AGENT_PROVIDER_NETWORK_ERROR",
          error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name) ? "Agent 服务响应超时，请稍后重试" : "Agent 服务网络异常，请稍后重试",
          true,
        );
      }
    }
    throw lastError;
  }
}
