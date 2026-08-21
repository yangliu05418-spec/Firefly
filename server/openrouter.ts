import { config } from "./config.js";

/**
 * OpenRouter 图片生成客户端。
 * - 多 Key 负载均衡：round-robin 轮询；
 * - 智能轮换：401（密钥失效）长冷却、429（限流）/5xx（服务错误）短冷却、
 *   网络错误瞬时冷却；失败自动切换下一个健康 Key，全部不可用才报错；
 * - 图片生成使用 OpenRouter 专用 Images API；文本能力继续使用 Chat Completions；
 * - 响应解析兼容 Images API 的 data[].b64_json，以及旧版 Chat Completions 图片格式。
 */

export type OpenRouterReference = { type: "image_url"; image_url: { url: string } } | { type: "text"; text: string };

type PooledKey = { key: string; unhealthyUntil: number; consecutiveFailures: number };

export class OpenRouterKeyPool {
  private readonly keys: PooledKey[];
  private cursor = 0;

  constructor(keys: string[]) {
    this.keys = keys.filter(Boolean).map((key) => ({ key, unhealthyUntil: 0, consecutiveFailures: 0 }));
  }

  get size() {
    return this.keys.length;
  }

  /** 下一个健康 Key（round-robin，跳过冷却中的 Key）；全部冷却返回 null */
  next(): string | null {
    if (!this.keys.length) return null;
    const now = Date.now();
    for (let attempt = 0; attempt < this.keys.length; attempt++) {
      this.cursor = (this.cursor + 1) % this.keys.length;
      const entry = this.keys[this.cursor];
      if (entry.unhealthyUntil <= now) return entry.key;
    }
    return null;
  }

  reportSuccess(key: string) {
    const entry = this.keys.find((item) => item.key === key);
    if (entry) {
      entry.consecutiveFailures = 0;
      entry.unhealthyUntil = 0;
    }
  }

  reportFailure(key: string, status: number | "network") {
    const entry = this.keys.find((item) => item.key === key);
    if (!entry) return;
    entry.consecutiveFailures += 1;
    const cooldownMs =
      status === 401 ? 60 * 60 * 1000
      : status === 429 ? 60 * 1000
      : status === "network" ? 10 * 1000
      : 30 * 1000;
    entry.unhealthyUntil = Date.now() + cooldownMs;
  }

  healthyCount() {
    const now = Date.now();
    return this.keys.filter((entry) => entry.unhealthyUntil <= now).length;
  }
}

export class OpenRouterError extends Error {
  status: number | "network";
  constructor(message: string, status: number | "network") {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
  }
}

export const isRetryableOpenRouterFailure = (error: unknown) => {
  if (!(error instanceof OpenRouterError)) return true;
  if (error.status === "network") return true;
  return error.status === 408 || error.status === 409 || error.status === 425 || error.status === 429 || error.status >= 500;
};

const pool = new OpenRouterKeyPool(config.openrouterApiKeys);

export const openRouterPool = () => pool;

const chatCompletionsUrl = () => config.openrouterBaseUrl.replace(/\/$/, "") + "/chat/completions";
const imagesUrl = () => config.openrouterBaseUrl.replace(/\/$/, "") + "/images";

type ChatRequestBody = {
  model: string;
  messages: { role: "user"; content: (OpenRouterReference | { type: "image_url"; image_url: { url: string } })[] }[];
  modalities?: string[];
  image?: { size?: string };
  stream?: boolean;
};

type ImageRequestBody = {
  model: string;
  prompt: string;
  n: number;
  resolution?: "512" | "1K" | "2K" | "4K";
  aspect_ratio?: string;
  input_references?: { type: "image_url"; image_url: { url: string } }[];
};

export const buildImageRequestBody = (input: { model: string; prompt: string; references: string[]; ratio: string; resolution: "512" | "1K" | "2K" | "4K" }): ImageRequestBody => ({
  model: input.model,
  prompt: input.prompt,
  n: 1,
  resolution: input.resolution,
  aspect_ratio: input.ratio,
  ...(input.references.length ? { input_references: input.references.map((url) => ({ type: "image_url" as const, image_url: { url } })) } : {}),
});

type OpenRouterTransportResult = { response: Response; data?: unknown; errorText?: string };

/** Keep the deadline active through response-body consumption, not only headers. */
export const fetchOpenRouterJsonWithinDeadline = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<OpenRouterTransportResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("OpenRouter 请求超时", "TimeoutError")), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (response.ok) return { response, data: await response.json() };
    return { response, errorText: (await response.text()).slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
};

const callWithRetry = async (body: ChatRequestBody | ImageRequestBody, url = chatCompletionsUrl()): Promise<{ data: unknown; key: string }> => {
  const lastError: OpenRouterError = new OpenRouterError("没有可用的 OpenRouter API Key", 503);
  for (let attempt = 0; attempt < Math.max(1, pool.size); attempt++) {
    const key = pool.next();
    if (!key) throw new OpenRouterError("OpenRouter 全部 API Key 暂时不可用（限流或密钥失效），请稍后重试", 503);
    try {
      const result = await fetchOpenRouterJsonWithinDeadline(url, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
            "HTTP-Referer": config.origin,
            "X-Title": "Firefly Studio",
          },
          body: JSON.stringify(body),
        }, config.openrouterRequestTimeoutMs);
      const response = result.response;
      if (response.ok) {
        pool.reportSuccess(key);
        return { data: result.data, key };
      }
      const text = result.errorText ?? "";
      pool.reportFailure(key, response.status);
      if (response.status === 401) {
        // 密钥失效：标记 1h 冷却并轮换下一个 Key
        lastError.message = "OpenRouter 密钥无效，已自动轮换";
        lastError.status = 401;
        continue;
      }
      if (response.status === 429) {
        lastError.message = "OpenRouter 请求过于频繁，已自动切换 Key 重试";
        lastError.status = 429;
        continue;
      }
      if (response.status >= 500) {
        lastError.message = "OpenRouter 服务暂时不可用（已切换 Key 重试）";
        lastError.status = 500;
        continue;
      }
      throw new OpenRouterError("OpenRouter 请求被拒绝: " + text.slice(0, 300), response.status);
    } catch (error) {
      if (error instanceof OpenRouterError && error.status !== "network" && error.status !== 429 && error.status !== 401 && error.status < 500) throw error;
      if (!(error instanceof OpenRouterError)) {
        pool.reportFailure(key, "network");
        lastError.message = error instanceof Error ? "OpenRouter 网络错误: " + error.message.slice(0, 200) : "OpenRouter 网络错误";
        lastError.status = "network";
        continue;
      }
      // 429/401/网络错误：已标记冷却，继续尝试下一个 Key
      continue;
    }
  }
  throw lastError;
};

/** 解析 OpenRouter 响应中的图片 URL（data: 或 https:） */
export const parseOpenRouterImages = (data: unknown): string[] => {
  const urls: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value && !urls.includes(value)) urls.push(value);
  };
  const record: Record<string, unknown> = (data ?? {}) as Record<string, unknown>;
  const error = record.error as Record<string, unknown> | undefined;
  if (error) throw new OpenRouterError(String(error.message ?? error.code ?? "OpenRouter 返回错误"), 400);
  const generated = record.data;
  if (Array.isArray(generated)) {
    for (const image of generated) {
      if (!image || typeof image !== "object") continue;
      const item = image as Record<string, unknown>;
      const encoded = item.b64_json;
      if (typeof encoded !== "string" || !encoded) continue;
      const mediaType = typeof item.media_type === "string" && item.media_type.startsWith("image/") ? item.media_type : "image/png";
      push(`data:${mediaType};base64,${encoded}`);
    }
  }
  const message = (record.choices as { message?: Record<string, unknown> }[] | undefined)?.[0]?.message;
  const content = message?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        if (p.type === "image_url") push((p.image_url as Record<string, unknown> | undefined)?.url);
        if (typeof p.text === "string") extractMarkdownImages(p.text).forEach(push);
      } else if (typeof part === "string") {
        extractMarkdownImages(part).forEach(push);
      }
    }
  } else if (typeof content === "string") {
    extractMarkdownImages(content).forEach(push);
  }
  const images = message?.images;
  if (Array.isArray(images)) {
    for (const image of images) {
      if (typeof image === "string") push(image);
      else if (image && typeof image === "object") push((image as Record<string, unknown>).url);
    }
  }
  return urls;
};

const extractMarkdownImages = (text: string) => {
  const urls: string[] = [];
  const pattern = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) urls.push(match[1]);
  return urls;
};

const parseOpenRouterText = (data: unknown) => {
  const record = (data ?? {}) as Record<string, unknown>;
  const error = record.error as Record<string, unknown> | undefined;
  if (error) throw new OpenRouterError(String(error.message ?? error.code ?? "OpenRouter 返回错误"), 400);
  const message = (record.choices as { message?: Record<string, unknown> }[] | undefined)?.[0]?.message;
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((part) => {
    if (typeof part === "string") return part;
    if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") return String((part as Record<string, unknown>).text);
    return "";
  }).join("").trim();
  return "";
};

export const parseOpenRouterTextDelta = (value: string) => {
  const chunk = JSON.parse(value) as { choices?: { delta?: { content?: unknown } }[]; error?: { message?: string } };
  if (chunk.error) throw new OpenRouterError(chunk.error.message ?? "OpenRouter 流式响应错误", 502);
  const content = chunk.choices?.[0]?.delta?.content;
  return typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => typeof part === "string" ? part : part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "").join("") : "";
};

export const generateCanvasText = async (input: { instruction: string; currentText: string; context: string }, onPartial?: (text: string) => void | Promise<void>) => {
  const prompt = [
    "你是 Firefly 画布内的创作助理。回答必须适合直接写入创作文本节点，使用简洁、自然的中文 Markdown，不要解释你的身份。",
    input.context ? `上游创作上下文：\n${input.context}` : "",
    input.currentText ? `当前节点内容：\n${input.currentText}` : "",
    `用户指令：\n${input.instruction}`,
  ].filter(Boolean).join("\n\n");
  if (onPartial) {
    let lastError = new OpenRouterError("没有可用的 OpenRouter API Key", 503);
    for (let attempt = 0; attempt < Math.max(1, pool.size); attempt += 1) {
      const key = pool.next();
      if (!key) throw new OpenRouterError("OpenRouter 全部 API Key 暂时不可用（限流或密钥失效），请稍后重试", 503);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.openrouterRequestTimeoutMs);
      try {
        const response = await fetch(chatCompletionsUrl(), {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": config.origin, "X-Title": "Firefly Studio" },
          body: JSON.stringify({ model: config.canvasTextModel, stream: true, messages: [{ role: "user", content: [{ type: "text", text: prompt }] }] }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const message = (await response.text()).slice(0, 300);
          pool.reportFailure(key, response.status);
          lastError = new OpenRouterError(`OpenRouter 流式请求失败: ${message}`, response.status);
          if (response.status === 401 || response.status === 429 || response.status >= 500) continue;
          throw lastError;
        }
        if (!response.body) throw new OpenRouterError("OpenRouter 未返回流式响应", 502);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        let result = "";
        const acceptLine = async (line: string) => {
          if (!line.startsWith("data:")) return;
          const value = line.slice(5).trim();
          if (!value || value === "[DONE]") return;
          const text = parseOpenRouterTextDelta(value);
          if (text) { result += text; await onPartial(result); }
        };
        while (true) {
          const { done, value } = await reader.read();
          pending += decoder.decode(value, { stream: !done });
          const lines = pending.split(/\r?\n/); pending = lines.pop() ?? "";
          for (const line of lines) await acceptLine(line);
          if (done) break;
        }
        if (pending) await acceptLine(pending);
        if (!result.trim()) throw new OpenRouterError("OpenRouter 未返回文本内容", 502);
        pool.reportSuccess(key);
        return result.trim();
      } catch (error) {
        if (error instanceof OpenRouterError && error.status !== 401 && error.status !== 429 && error.status !== "network" && error.status < 500) throw error;
        pool.reportFailure(key, error instanceof OpenRouterError && typeof error.status === "number" ? error.status : "network");
        lastError = error instanceof OpenRouterError ? error : new OpenRouterError(error instanceof Error ? `OpenRouter 网络错误: ${error.message.slice(0, 200)}` : "OpenRouter 网络错误", "network");
      } finally { clearTimeout(timer); }
    }
    throw lastError;
  }
  const { data } = await callWithRetry({
    model: config.canvasTextModel,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
  });
  const result = parseOpenRouterText(data);
  if (!result) throw new OpenRouterError("OpenRouter 未返回文本内容", 502);
  return result;
};

const isDataUrl = (url: string) => url.startsWith("data:");

/** 生成单张图片：返回图片 URL（data: 或 https:），由调用方落盘 */
export const generateSingleImage = async (input: { model: string; prompt: string; references: string[]; ratio: string; resolution: "512" | "1K" | "2K" | "4K" }): Promise<string> => {
  const base = buildImageRequestBody(input);
  const { data } = await callWithRetry(base, imagesUrl());
  const images = parseOpenRouterImages(data);
  if (!images.length) throw new OpenRouterError("OpenRouter 未返回图片内容（模型可能不支持当前参数）", 400);
  return images[0];
};

/** 下载图片字节（data: 解码 / https: 拉取，20MB 上限） */
export const downloadImageBuffer = async (url: string): Promise<Buffer> => {
  if (isDataUrl(url)) {
    const comma = url.indexOf(",");
    if (comma < 0) throw new OpenRouterError("OpenRouter 返回了无效的图片数据", 400);
    const meta = url.slice(0, comma);
    const payload = url.slice(comma + 1);
    const buffer = Buffer.from(payload, meta.includes(";base64") ? "base64" : "utf8");
    if (buffer.length > 20 * 1024 * 1024) throw new OpenRouterError("生成的图片超过 20MB 限制", 400);
    return buffer;
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) throw new OpenRouterError("OpenRouter 返回了无法下载的图片地址", 400);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new OpenRouterError("下载生成图片失败 (" + response.status + ")", 502);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 20 * 1024 * 1024) throw new OpenRouterError("生成的图片超过 20MB 限制", 400);
    return buffer;
  } finally {
    clearTimeout(timer);
  }
};
