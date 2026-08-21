import crypto from "node:crypto";
import { config } from "./config.js";

const hmac = (key: Buffer | string, data: string) => crypto.createHmac("sha256", key).update(data).digest();
const hash = (data: string) => crypto.createHash("sha256").update(data).digest("hex");
const retryableActions = new Set(["GetAsset", "ListAssets", "ListAssetGroups"]);
export const canRetryAssetAction = (action: string) => retryableActions.has(action);

export class AssetApiError extends Error {
  constructor(message: string, readonly status: number, readonly providerCode?: string, readonly action?: string) {
    super(message);
    this.name = "AssetApiError";
  }
}

export const isMissingProviderAssetError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  const providerCode = error instanceof AssetApiError ? error.providerCode ?? "" : "";
  const status = error instanceof AssetApiError ? error.status : 0;
  return status === 404
    || /(?:not.?found|does.?not.?exist|asset.?not.?exist|invalid.?asset)/i.test(providerCode)
    || /(?:asset|素材).{0,40}(?:not found|does not exist|不存在)/i.test(error.message);
};

export async function callAssetApi<T>(action: string, body: Record<string, unknown>): Promise<T> {
  if (!config.accessKey || !config.secretKey) throw new Error("服务器尚未配置资源库 AK/SK");
  const url = new URL(config.openApiEndpoint);
  url.searchParams.set("Action", action);
  url.searchParams.set("Version", "2024-01-01");
  const payload = JSON.stringify({ ...body, ProjectName: body.ProjectName ?? config.project });
  const now = new Date();
  const xDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = xDate.slice(0, 8);
  const payloadHash = hash(payload);
  const canonicalQuery = Array.from(url.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const canonicalHeaders = `content-type:application/json\nhost:${url.host}\nx-content-sha256:${payloadHash}\nx-date:${xDate}\n`;
  const signedHeaders = "content-type;host;x-content-sha256;x-date";
  const canonicalRequest = `POST\n/\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${date}/${config.region}/ark/request`;
  const stringToSign = `HMAC-SHA256\n${xDate}\n${scope}\n${hash(canonicalRequest)}`;
  const kDate = hmac(config.secretKey, date);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, "ark");
  const signature = crypto.createHmac("sha256", hmac(kService, "request")).update(stringToSign).digest("hex");
  const authorization = `HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  // Only reads are retried. Create/Delete operations have no documented idempotency token;
  // replaying them after an ambiguous 5xx can create duplicate provider assets.
  const attempt = async () => {
    let response: Response;
    try { response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Date": xDate, "X-Content-Sha256": payloadHash, Authorization: authorization }, body: payload, signal: AbortSignal.timeout(30_000) }); }
    catch (error) { (error as { retryable?: boolean }).retryable = canRetryAssetAction(action); throw error; }
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok || json.ResponseMetadata?.Error) {
      const providerCode = json.ResponseMetadata?.Error?.Code ?? json.code;
      const message = json.ResponseMetadata?.Error?.Message ?? json.message ?? `资源库请求失败 (${response.status})`;
      const error = new AssetApiError(message, response.status, providerCode, action);
      (error as { retryable?: boolean }).retryable = canRetryAssetAction(action) && (response.status >= 500 || response.status === 429);
      throw error;
    }
    return json.Result ?? json;
  };
  try {
    return await attempt();
  } catch (error) {
    if (!(error as { retryable?: boolean }).retryable) throw error;
    await new Promise((resolve) => setTimeout(resolve, 800));
    return attempt();
  }
}
