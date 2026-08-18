const PREVIEW_SIGNATURE_SAFETY_SECONDS = 300;
const MAX_PRIVATE_REDIRECT_CACHE_SECONDS = 24 * 3600;

export const previewRedirectCacheSeconds = (signatureTtlSeconds: number) => Math.max(
  0,
  Math.min(MAX_PRIVATE_REDIRECT_CACHE_SECONDS, Math.floor(signatureTtlSeconds) - PREVIEW_SIGNATURE_SAFETY_SECONDS)
);

export const previewRedirectCacheControl = (signatureTtlSeconds: number) =>
  `private, max-age=${previewRedirectCacheSeconds(signatureTtlSeconds)}, stale-if-error=300`;
