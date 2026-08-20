import dns from "node:dns/promises";
import { BlockList } from "node:net";
import { config } from "./config.js";

/**
 * OpenRouter 图片生成客户端。
 * - 多 Key 负载均衡：round-robin 轮询；
 * - 智能轮换：401（密钥失效）长冷却、429（限流）/5xx（服务错误）短冷却、
 *   网络错误瞬时冷却；失败自动切换下一个健康 Key，全部不可用才报错；
 * - 响应解析：兼容 content 数组（image_url 分段）、markdown 图片、message.images 数组与 data: URL。
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

const pool = new OpenRouterKeyPool(config.openrouterApiKeys);

export const openRouterPool = () => pool;

const chatCompletionsUrl = () => config.openrouterBaseUrl.replace(/\/$/, "") + "/chat/completions";

type ChatRequestBody = {
  model: string;
  messages: { role: "user"; content: (OpenRouterReference | { type: "image_url"; image_url: { url: string } })[] }[];
  modalities?: string[];
  image?: { size?: string };
};

const callWithRetry = async (body: ChatRequestBody): Promise<{ data: unknown; key: string }> => {
  const lastError: OpenRouterError = new OpenRouterError("没有可用的 OpenRouter API Key", 503);
  for (let attempt = 0; attempt < Math.max(1, pool.size); attempt++) {
    const key = pool.next();
    if (!key) throw new OpenRouterError("OpenRouter 全部 API Key 暂时不可用（限流或密钥失效），请稍后重试", 503);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.openrouterRequestTimeoutMs);
      let response: Response;
      try {
        response = await fetch(chatCompletionsUrl(), {
          method: "POST",
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
            "HTTP-Referer": config.origin,
            "X-Title": "Firefly Studio",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (response.ok) {
        pool.reportSuccess(key);
        return { data: await response.json(), key };
      }
      const text = (await response.text()).slice(0, 500);
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

const isDataUrl = (url: string) => url.startsWith("data:");
const maximumImageBytes = 20 * 1024 * 1024;
const blockedImageAddresses = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blockedImageAddresses.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32]] as const) blockedImageAddresses.addSubnet(address, prefix, "ipv6");

export const isBlockedImageAddress = (address: string, family: number) => blockedImageAddresses.check(address, family === 6 ? "ipv6" : "ipv4");

export const detectImageContentType = (buffer: Buffer) => {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  throw new OpenRouterError("OpenRouter 返回的内容不是受支持的图片", 400);
};

const validatePublicImageUrl = async (value: string) => {
  if (value.length > 4096) throw new OpenRouterError("OpenRouter 返回的图片地址过长", 400);
  let url: URL;
  try { url = new URL(value); } catch { throw new OpenRouterError("OpenRouter 返回了无效的图片地址", 400); }
  if (url.protocol !== "https:" || url.username || url.password) throw new OpenRouterError("OpenRouter 返回了不安全的图片地址", 400);
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length || addresses.some(({ address, family }) => isBlockedImageAddress(address, family))) throw new OpenRouterError("OpenRouter 图片地址不可访问", 400);
  return url;
};

const readLimitedImageBody = async (response: Response) => {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maximumImageBytes) throw new OpenRouterError("生成的图片超过 20MB 限制", 400);
  if (!response.body) throw new OpenRouterError("下载生成图片失败（响应为空）", 502);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumImageBytes) { await reader.cancel(); throw new OpenRouterError("生成的图片超过 20MB 限制", 400); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
};

/** 生成单张图片：返回图片 URL（data: 或 https:），由调用方落盘 */
export const generateSingleImage = async (input: { model: string; prompt: string; references: string[]; size: string }): Promise<string> => {
  const content: (OpenRouterReference | { type: "image_url"; image_url: { url: string } })[] = [{ type: "text", text: input.prompt }];
  input.references.forEach((url) => content.push({ type: "image_url", image_url: { url } }));
  const base: ChatRequestBody = {
    model: input.model,
    messages: [{ role: "user", content }],
    modalities: ["image", "text"],
  };
  let data: unknown;
  try {
    ({ data } = await callWithRetry({ ...base, image: { size: input.size } }));
  } catch (error) {
    // 部分模型不接受 image.size 参数（400）→ 去掉尺寸参数重试一次
    if (!(error instanceof OpenRouterError) || error.status !== 400) throw error;
    ({ data } = await callWithRetry(base));
  }
  const images = parseOpenRouterImages(data);
  if (!images.length) throw new OpenRouterError("OpenRouter 未返回图片内容（模型可能不支持当前参数）", 400);
  return images[0];
};

/** 下载图片字节（data: 解码 / public https: 拉取，20MB 上限及 SSRF 防护） */
export const downloadImageBuffer = async (url: string): Promise<{ buffer: Buffer; contentType: string }> => {
  if (isDataUrl(url)) {
    const comma = url.indexOf(",");
    if (comma < 0) throw new OpenRouterError("OpenRouter 返回了无效的图片数据", 400);
    const meta = url.slice(0, comma);
    const payload = url.slice(comma + 1);
    if (!meta.includes(";base64")) throw new OpenRouterError("OpenRouter 返回了不受支持的图片数据", 400);
    const buffer = Buffer.from(payload, "base64");
    if (buffer.length > maximumImageBytes) throw new OpenRouterError("生成的图片超过 20MB 限制", 400);
    return { buffer, contentType: detectImageContentType(buffer) };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    let current = await validatePublicImageUrl(url);
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const response = await fetch(current, { signal: controller.signal, redirect: "manual" });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirects === 3) throw new OpenRouterError("生成图片地址重定向过多", 502);
        current = await validatePublicImageUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) throw new OpenRouterError("下载生成图片失败 (" + response.status + ")", 502);
      const buffer = await readLimitedImageBody(response);
      return { buffer, contentType: detectImageContentType(buffer) };
    }
    throw new OpenRouterError("下载生成图片失败", 502);
  } finally {
    clearTimeout(timer);
  }
};
