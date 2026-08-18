import crypto from "node:crypto";
import { config } from "./config.js";
import { previewRedirectCacheSeconds } from "./media-cache.js";
import { redis } from "./redis.js";
import { signedObjectUrl } from "./tos.js";

type Cache = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", seconds: number, condition: "NX"): Promise<unknown>;
};

type StablePreviewUrlOptions = {
  objectKey: string;
  fileName: string;
  cache?: Cache;
  signatureTtlSeconds?: number;
  sign?: (key: string, options: { fileName: string; expires: number }) => string;
};

const cacheKey = (objectKey: string, fileName: string) => {
  const digest = crypto.createHash("sha256").update(objectKey).update("\0").update(fileName).digest("hex");
  return `tos-preview-url:v1:${digest}`;
};

/**
 * Keep the same signed TOS URL stable across reloads and app instances so the
 * browser can reuse cached media ranges. The cache expires before the TOS
 * signature; a Redis outage degrades to a fresh valid signature, never a 5xx.
 */
export const stablePreviewUrl = async ({
  objectKey,
  fileName,
  cache = redis,
  signatureTtlSeconds = config.tosPreviewTtlSeconds,
  sign = signedObjectUrl
}: StablePreviewUrlOptions) => {
  const ttl = previewRedirectCacheSeconds(signatureTtlSeconds);
  if (ttl <= 0) return sign(objectKey, { fileName, expires: signatureTtlSeconds });

  const key = cacheKey(objectKey, fileName);
  try {
    const cached = await cache.get(key);
    if (cached) return cached;

    const generated = sign(objectKey, { fileName, expires: signatureTtlSeconds });
    const stored = await cache.set(key, generated, "EX", ttl, "NX");
    if (stored) return generated;
    return (await cache.get(key)) ?? generated;
  } catch (error) {
    console.warn(JSON.stringify({
      type: "tos_preview_url_cache_failed",
      at: new Date().toISOString(),
      error: error instanceof Error ? error.message : "unknown"
    }));
    return sign(objectKey, { fileName, expires: signatureTtlSeconds });
  }
};
