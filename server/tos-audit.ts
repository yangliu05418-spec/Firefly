import { config } from "./config.js";
import { users } from "./store.js";
import { tos, tosConfigured, verifyProgressiveMp4 } from "./tos.js";
import { tosEndpointMatches } from "./tos-endpoint.js";

const summarizePrefix = async (prefix: string) => {
  let continuationToken: string | undefined; let count = 0; let bytes = 0; let sampleKey: string | undefined;
  do {
    const response = await tos.listObjectsType2({
      bucket: config.tosBucket,
      prefix,
      maxKeys: 1000,
      ...(continuationToken ? { continuationToken } : {})
    });
    const objects = response.data.Contents ?? [];
    sampleKey ??= objects.find((object) => object.Key)?.Key;
    count += objects.length;
    bytes += objects.reduce((total, object) => total + Number(object.Size ?? 0), 0);
    continuationToken = response.data.IsTruncated ? response.data.NextContinuationToken : undefined;
  } while (continuationToken);
  return { count, bytes, sampleKey };
};

const header = (headers: unknown, name: string) => {
  if (!headers || typeof headers !== "object") return "";
  const values = headers as Record<string, string | number | undefined>;
  return String(values[name] ?? values[name.toLowerCase()] ?? values[name.toUpperCase()] ?? "");
};

const cachePolicyValid = (value: string, minimumSeconds: number) => {
  const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(value)?.[1];
  return /(?:^|,)\s*private(?:,|$)/i.test(value)
    && /(?:^|,)\s*immutable(?:,|$)/i.test(value)
    && /(?:^|,)\s*no-transform(?:,|$)/i.test(value)
    && Number(maxAge ?? 0) >= minimumSeconds;
};

const verifyOutputSample = async (key?: string) => {
  if (!key) return { present: false, valid: true };
  const head = await tos.headObject({ bucket: config.tosBucket, key });
  const range = await tos.getObjectV2({ bucket: config.tosBucket, key, dataType: "buffer", range: "bytes=0-0" });
  const contentType = header(head.headers, "content-type").split(";", 1)[0].toLowerCase();
  const cacheControl = header(head.headers, "cache-control");
  const contentLength = Number(header(head.headers, "content-length"));
  const rangeLength = Number(/^bytes 0-0\/(\d+)$/i.exec(header(range.headers, "content-range"))?.[1] ?? 0);
  const valid = range.statusCode === 206
    && range.data.content.length === 1
    && contentLength > 0
    && rangeLength === contentLength
    && ["video/mp4", "video/quicktime"].includes(contentType)
    && cachePolicyValid(cacheControl, config.tosPreviewTtlSeconds);
  return { present: true, valid, range206: range.statusCode === 206, contentType, cacheControl, bytes: contentLength };
};

const verifyPosterSample = async (key?: string) => {
  if (!key) return { present: false, valid: true };
  const head = await tos.headObject({ bucket: config.tosBucket, key });
  const contentType = header(head.headers, "content-type").split(";", 1)[0].toLowerCase();
  const cacheControl = header(head.headers, "cache-control");
  const valid = contentType === "image/webp" && cachePolicyValid(cacheControl, 24 * 3600);
  return { present: true, valid, contentType, cacheControl, bytes: Number(header(head.headers, "content-length")) };
};

// The current SDK mutates request-signing state under concurrent ListObjectsV2 calls.
// Audits favor deterministic control-plane reads over negligible parallel speedup.
const audit = async () => {
  if (!tosConfigured()) throw new Error("TOS 配置不完整，无法执行审计");

  const requiredMethods = new Set(["GET", "HEAD", "PUT"]);
  const locationResponse = await tos.getBucketLocation({ bucket: config.tosBucket });
  const corsResponse = await tos.getBucketCORS({ bucket: config.tosBucket });
  const lifecycleResponse = await tos.getBucketLifecycle({ bucket: config.tosBucket });
  const multipartResponse = await tos.listMultipartUploads({ bucket: config.tosBucket, maxUploads: 1000 });
  const corsRules = corsResponse.data.CORSRules ?? [];
  const advertisedEndpoint = locationResponse.data.ExtranetEndpoint ?? "";
  const endpointValid = locationResponse.data.Region === config.tosRegion && tosEndpointMatches(config.tosEndpoint, advertisedEndpoint);
  const lifecycleRules = lifecycleResponse.data.Rules ?? [];
  const matchingCors = corsRules.find((rule) => rule.AllowedOrigins?.includes(config.origin));
  const methods = new Set((matchingCors?.AllowedMethods ?? []).map(String));
  const corsValid = Boolean(matchingCors && [...requiredMethods].every((method) => methods.has(method)) && matchingCors.ResponseVary);
  const inputRetention = lifecycleRules.find((rule) => rule.ID === "firefly-input-retention");
  const multipartCleanup = lifecycleRules.find((rule) => rule.ID === "firefly-abort-incomplete-multipart");
  const lifecycleValid = inputRetention?.Status === "Enabled"
    && inputRetention.Prefix === "inputs/"
    && inputRetention.Expiration?.Days === config.tosInputRetentionDays
    && multipartCleanup?.Status === "Enabled"
    && multipartCleanup.Prefix === ""
    && multipartCleanup.AbortIncompleteMultipartUpload?.DaysAfterInitiation === 1
    && !lifecycleRules.some((rule) => rule.Status === "Enabled" && ["outputs/", "previews/", "posters/"].some((prefix) => rule.Prefix?.startsWith(prefix)) && rule.Expiration);

  const inputs = await summarizePrefix("inputs/");
  const outputs = await summarizePrefix("outputs/");
  const previews = await summarizePrefix("previews/");
  const posters = await summarizePrefix("posters/");
  const outputSample = await verifyOutputSample(outputs.sampleKey);
  const previewSample = await verifyOutputSample(previews.sampleKey);
  const previewStructure = previews.sampleKey ? await verifyProgressiveMp4(previews.sampleKey) : null;
  const posterSample = await verifyPosterSample(posters.sampleKey);
  const mediaObjectsValid = outputSample.valid && previewSample.valid && (previewStructure?.progressive ?? true) && posterSample.valid;
  const now = Date.now();
  const recoverableArchives = users.recoverableMediaTasks(now + 5 * 60 * 1000, now - 30 * 60 * 1000, 100).length;
  const recoverablePosters = users.recoverablePosterTasks(100).length;
  const recoverablePreviews = config.tosPreviewTranscodeEnabled ? users.recoverablePreviewTasks(100).length : 0;
  const databaseConsistencyValid = recoverableArchives === 0 && recoverablePosters === 0 && recoverablePreviews === 0;
  const result = {
    ok: endpointValid && corsValid && lifecycleValid && mediaObjectsValid && databaseConsistencyValid,
    bucket: config.tosBucket,
    region: config.tosRegion,
    endpoint: config.tosEndpoint,
    advertisedEndpoint,
    endpointValid,
    corsValid,
    lifecycleValid,
    mediaObjectsValid,
    databaseConsistencyValid,
    recoveryPending: { archives: recoverableArchives, previews: recoverablePreviews, posters: recoverablePosters },
    incompleteMultipart: (multipartResponse.data.Uploads ?? []).length,
    incompleteMultipartTruncated: Boolean(multipartResponse.data.IsTruncated),
    objects: {
      inputs: { count: inputs.count, bytes: inputs.bytes },
      outputs: { count: outputs.count, bytes: outputs.bytes },
      previews: { count: previews.count, bytes: previews.bytes },
      posters: { count: posters.count, bytes: posters.bytes }
    },
    samples: { output: outputSample, preview: { ...previewSample, atoms: previewStructure?.atoms }, poster: posterSample }
  };

  console.info(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
};

try {
  await audit();
} catch (error) {
  const details = error as { code?: string; statusCode?: number; message?: string; requestId?: string };
  console.error(JSON.stringify({
    ok: false,
    error: {
      code: details.code ?? "TOS_AUDIT_FAILED",
      statusCode: details.statusCode,
      message: details.message ?? String(error),
      requestId: details.requestId
    }
  }));
  process.exitCode = 1;
} finally {
  users.close();
}
