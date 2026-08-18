import crypto from "node:crypto";
import type { Redis } from "ioredis";
import { config } from "./config.js";

const authorizeEndpoint = "https://accounts.feishu.cn/open-apis/authen/v1/authorize";
const tokenEndpoint = "https://open.feishu.cn/open-apis/authen/v2/oauth/token";
const userInfoEndpoint = "https://open.feishu.cn/open-apis/authen/v1/user_info";
const stateKey = (state: string) => `auth:oauth-state:${state}`;
const safeReturnTo = (value?: string) => value?.startsWith("/") && !value.startsWith("//") ? value : "/studio";

export const createFeishuAuthorization = async (redis: Redis, returnTo?: string) => {
  if (!config.feishuAppId || !config.feishuAppSecret || !config.feishuTenantKey) throw new Error("飞书登录尚未完成服务端配置");
  const state = crypto.randomBytes(32).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  await redis.set(stateKey(state), JSON.stringify({ verifier, returnTo: safeReturnTo(returnTo) }), "EX", 600, "NX");
  const url = new URL(authorizeEndpoint);
  url.searchParams.set("client_id", config.feishuAppId);
  url.searchParams.set("redirect_uri", config.feishuRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "contact:user.employee:readonly");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
};

export const consumeFeishuAuthorization = async (redis: Redis, state: string) => {
  const key = stateKey(state);
  const raw = await redis.getdel(key);
  if (!raw) throw new Error("登录请求已过期，请重新发起");
  return JSON.parse(raw) as { verifier: string; returnTo: string };
};

const feishuError = (payload: unknown) => {
  const data = payload as { error_description?: string; msg?: string; code?: number };
  return data.error_description ?? data.msg ?? `飞书登录失败${data.code ? ` (${data.code})` : ""}`;
};

export const validateFeishuProfile = (profile: { open_id?: string; union_id?: string; tenant_key?: string; email?: string; enterprise_email?: string; name?: string; avatar_url?: string }) => {
  const email = profile.enterprise_email?.trim().toLowerCase() ?? "";
  if (!profile.open_id || !profile.union_id || !profile.tenant_key || !email) throw new Error("飞书未返回完整的企业身份信息，请检查应用的企业邮箱权限");
  if (profile.tenant_key !== config.feishuTenantKey) throw new Error("当前飞书账号不属于获准企业");
  const suffix = `@${config.allowedEmailDomain}`;
  if (!email.endsWith(suffix) || email.length <= suffix.length) throw new Error("仅支持企业邮箱账号登录");
  return { openId: profile.open_id, unionId: profile.union_id, tenantKey: profile.tenant_key, email, name: profile.name?.trim() || email.split("@")[0], avatarUrl: profile.avatar_url ?? "" };
};

export const exchangeFeishuCode = async (code: string, verifier: string) => {
  const tokenResponse = await fetch(tokenEndpoint, {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ grant_type: "authorization_code", client_id: config.feishuAppId, client_secret: config.feishuAppSecret, code, redirect_uri: config.feishuRedirectUri, code_verifier: verifier }),
    signal: AbortSignal.timeout(config.authRequestTimeoutMs)
  });
  const tokenPayload = await tokenResponse.json() as { code?: number; access_token?: string; error_description?: string; msg?: string };
  if (!tokenResponse.ok || tokenPayload.code || !tokenPayload.access_token) throw new Error(feishuError(tokenPayload));
  const profileResponse = await fetch(userInfoEndpoint, { headers: { Authorization: `Bearer ${tokenPayload.access_token}` }, signal: AbortSignal.timeout(config.authRequestTimeoutMs) });
  const profilePayload = await profileResponse.json() as { code?: number; msg?: string; data?: { open_id?: string; union_id?: string; tenant_key?: string; email?: string; enterprise_email?: string; name?: string; avatar_url?: string } };
  if (!profileResponse.ok || profilePayload.code || !profilePayload.data) throw new Error(feishuError(profilePayload));
  return validateFeishuProfile(profilePayload.data);
};
