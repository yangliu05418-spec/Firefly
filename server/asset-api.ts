import crypto from "node:crypto";
import { config } from "./config.js";

const hmac = (key: Buffer | string, data: string) => crypto.createHmac("sha256", key).update(data).digest();
const hash = (data: string) => crypto.createHash("sha256").update(data).digest("hex");

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
  // 对网络错误/5xx 自动重试一次（素材服务偶发抖动时避免用户上传直接失败）
  const attempt = async () => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Date": xDate, "X-Content-Sha256": payloadHash, Authorization: authorization }, body: payload, signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok || json.ResponseMetadata?.Error) {
      const message = json.ResponseMetadata?.Error?.Message ?? json.message ?? `资源库请求失败 (${response.status})`;
      const error = new Error(message);
      (error as { retryable?: boolean }).retryable = response.status >= 500 || response.status === 429;
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
