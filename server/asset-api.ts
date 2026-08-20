import crypto from "node:crypto";
import { config } from "./config.js";

const hmac = (key: Buffer | string, data: string) => crypto.createHmac("sha256", key).update(data).digest();
const hash = (data: string) => crypto.createHash("sha256").update(data).digest("hex");
const readAction = /^(Get|List)/;
const retryableProviderCode = /(Throttl|TooMany|LimitExceeded|Internal|ServiceUnavailable|Timeout)/i;
type AssetApiEnvelope = {
  Result?: unknown;
  message?: string;
  ResponseMetadata?: { Error?: { Code?: string; Message?: string } };
};

export class AssetApiError extends Error {
  readonly status?: number;
  readonly providerCode?: string;
  readonly retryable: boolean;
  readonly resultUnknown: boolean;

  constructor(message: string, details: { status?: number; providerCode?: string; retryable?: boolean; resultUnknown?: boolean; cause?: unknown } = {}) {
    super(message, { cause: details.cause });
    this.name = "AssetApiError";
    this.status = details.status;
    this.providerCode = details.providerCode;
    this.retryable = details.retryable ?? false;
    this.resultUnknown = details.resultUnknown ?? false;
  }
}

const signedRequest = (action: string, body: Record<string, unknown>) => {
  const url = new URL(config.openApiEndpoint);
  url.searchParams.set("Action", action);
  url.searchParams.set("Version", "2024-01-01");
  const payload = JSON.stringify({ ...body, ProjectName: body.ProjectName ?? config.project });
  const now = new Date();
  const xDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = xDate.slice(0, 8);
  const payloadHash = hash(payload);
  const canonicalQuery = Array.from(url.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  const canonicalHeaders = `content-type:application/json\nhost:${url.host}\nx-content-sha256:${payloadHash}\nx-date:${xDate}\n`;
  const signedHeaders = "content-type;host;x-content-sha256;x-date";
  const canonicalRequest = `POST\n/\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${date}/${config.region}/ark/request`;
  const stringToSign = `HMAC-SHA256\n${xDate}\n${scope}\n${hash(canonicalRequest)}`;
  const kDate = hmac(config.secretKey, date);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, "ark");
  const signature = crypto.createHmac("sha256", hmac(kService, "request")).update(stringToSign).digest("hex");
  return {
    url,
    payload,
    headers: {
      "Content-Type": "application/json",
      "X-Date": xDate,
      "X-Content-Sha256": payloadHash,
      Authorization: `HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    }
  };
};

const requestOnce = async <T>(action: string, body: Record<string, unknown>, mutation: boolean): Promise<T> => {
  const request = signedRequest(action, body);
  let response: Response;
  try {
    response = await fetch(request.url, { method: "POST", headers: request.headers, body: request.payload, signal: AbortSignal.timeout(30_000) });
  } catch (cause) {
    throw new AssetApiError(cause instanceof Error ? cause.message : "资源库网络请求失败", { retryable: true, resultUnknown: mutation, cause });
  }

  const text = await response.text();
  let json: AssetApiEnvelope;
  try { json = text ? JSON.parse(text) as AssetApiEnvelope : {}; }
  catch (cause) {
    throw new AssetApiError(`资源库返回了无法解析的响应 (${response.status})`, { status: response.status, retryable: response.status >= 500, resultUnknown: mutation, cause });
  }
  const providerError = json.ResponseMetadata?.Error;
  if (!response.ok || providerError) {
    const providerCode = providerError?.Code;
    const retryable = response.status === 429 || response.status >= 500 || retryableProviderCode.test(providerCode ?? "");
    throw new AssetApiError(providerError?.Message ?? json.message ?? `资源库请求失败 (${response.status})`, {
      status: response.status,
      providerCode,
      retryable,
      resultUnknown: mutation && retryable
    });
  }
  return (json.Result ?? json) as T;
};

export async function callAssetApi<T>(action: string, body: Record<string, unknown>): Promise<T> {
  if (!config.accessKey || !config.secretKey) throw new Error("服务器尚未配置资源库 AK/SK");
  const mutation = !readAction.test(action);
  const maximumAttempts = mutation ? 1 : 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try { return await requestOnce<T>(action, body, mutation); }
    catch (error) {
      lastError = error;
      if (!(error instanceof AssetApiError) || !error.retryable || attempt === maximumAttempts) throw error;
      const ceiling = Math.min(2_000, 400 * 2 ** (attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * ceiling)));
    }
  }
  throw lastError;
}
