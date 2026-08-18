import path from "node:path";

const required = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

const positiveInt = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid environment variable: ${name}`);
  return value;
};

export const config = {
  port: Number(process.env.PORT ?? 8090),
  origin: required("PUBLIC_ORIGIN", process.env.NODE_ENV === "production" ? undefined : "http://localhost:5173"),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? "./uploads"),
  sessionSecret: required("SESSION_SECRET", process.env.NODE_ENV === "production" ? undefined : "local-development-secret-change-me-now"),
  sessionTtlSeconds: positiveInt("SESSION_TTL_SECONDS", 30 * 24 * 3600),
  databasePath: path.resolve(process.env.DATABASE_PATH ?? "./data/firefly.db"),
  feishuAppId: process.env.FEISHU_APP_ID ?? "",
  feishuAppSecret: process.env.FEISHU_APP_SECRET ?? "",
  feishuTenantKey: process.env.FEISHU_TENANT_KEY ?? "",
  allowedEmailDomain: (process.env.ALLOWED_EMAIL_DOMAIN ?? "dokuai.tv").trim().toLowerCase(),
  feishuRedirectUri: `${process.env.PUBLIC_ORIGIN ?? "http://localhost:5173"}/api/auth/feishu/callback`,
  apiKey: process.env.ARK_API_KEY ?? "",
  accessKey: process.env.BYTEPLUS_ACCESS_KEY_ID ?? "",
  secretKey: process.env.BYTEPLUS_SECRET_ACCESS_KEY ?? "",
  region: process.env.BYTEPLUS_REGION ?? "ap-southeast-1",
  project: process.env.BYTEPLUS_PROJECT ?? "default",
  openApiEndpoint: process.env.BYTEPLUS_OPENAPI_ENDPOINT ?? "https://open.byteplusapi.com",
  providerPollIntervalMs: positiveInt("PROVIDER_POLL_INTERVAL_MS", 7000),
  providerRequestTimeoutMs: positiveInt("PROVIDER_REQUEST_TIMEOUT_MS", 30000),
  authRequestTimeoutMs: positiveInt("AUTH_REQUEST_TIMEOUT_MS", 15000),
  generationConcurrency: positiveInt("GENERATION_CONCURRENCY", 4),
  maxActiveGenerationsPerUser: positiveInt("MAX_ACTIVE_GENERATIONS_PER_USER", 4),
  assetRegistrationConcurrency: positiveInt("ASSET_REGISTRATION_CONCURRENCY", 4),
  mediaStorageBackend: process.env.MEDIA_STORAGE_BACKEND ?? "legacy",
  tosAccessKeyId: process.env.TOS_ACCESS_KEY_ID ?? "",
  tosSecretAccessKey: process.env.TOS_SECRET_ACCESS_KEY ?? "",
  tosRegion: process.env.TOS_REGION ?? "cn-beijing",
  tosEndpoint: process.env.TOS_ENDPOINT ?? "tos-cn-beijing.bytepluses.com.cn",
  tosBucket: process.env.TOS_BUCKET ?? "",
  tosPreviewTtlSeconds: positiveInt("TOS_PREVIEW_TTL_SECONDS", 7200),
  tosDownloadTtlSeconds: positiveInt("TOS_DOWNLOAD_TTL_SECONDS", 43200),
  tosInputRetentionDays: positiveInt("TOS_INPUT_RETENTION_DAYS", 7),
  tosUploadPartSize: positiveInt("TOS_UPLOAD_PART_SIZE", 16 * 1024 * 1024),
  tosUploadConcurrency: positiveInt("TOS_UPLOAD_CONCURRENCY", 3),
  tosRequestTimeoutMs: positiveInt("TOS_REQUEST_TIMEOUT_MS", 60000),
  tosUploadRequestTimeoutMs: positiveInt("TOS_UPLOAD_REQUEST_TIMEOUT_MS", 180000),
  tosTranscodeDeadlineMs: positiveInt("TOS_TRANSCODE_DEADLINE_MS", 10 * 60 * 1000),
  tosFetchDeadlineMs: positiveInt("TOS_FETCH_DEADLINE_MS", 120000),
  tosSourceStreamTimeoutMs: positiveInt("TOS_SOURCE_STREAM_TIMEOUT_MS", 15 * 60 * 1000),
  tosPreviewTranscodeEnabled: (process.env.TOS_PREVIEW_TRANSCODE_ENABLED ?? "false").toLowerCase() === "true",
  tosPreviewMaxBitrate: positiveInt("TOS_PREVIEW_MAX_BITRATE", 3_500_000),
  openrouterApiKeys: (process.env.OPENROUTER_API_KEYS ?? "").split(",").map((key) => key.trim()).filter(Boolean),
  openrouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  openrouterRequestTimeoutMs: positiveInt("OPENROUTER_REQUEST_TIMEOUT_MS", 180_000)
};
