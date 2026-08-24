import crypto from "node:crypto";
import path from "node:path";
import { TosClient } from "@volcengine/tos-sdk";
import { config } from "./config.js";
import { inspectMp4Prefix } from "./mp4-structure.js";

export const tosEnabled = () => config.mediaStorageBackend === "tos";
export const tosConfigured = () => Boolean(config.tosAccessKeyId && config.tosSecretAccessKey && config.tosBucket && config.tosEndpoint);

const requireTos = () => {
  if (!tosConfigured()) throw new Error("TOS 尚未完成服务端配置");
};

export const tos = new TosClient({
  accessKeyId: config.tosAccessKeyId || "not-configured",
  accessKeySecret: config.tosSecretAccessKey || "not-configured",
  region: config.tosRegion,
  endpoint: config.tosEndpoint,
  requestTimeout: config.tosRequestTimeoutMs,
  connectionTimeout: Math.min(config.tosRequestTimeoutMs, 10000),
  maxRetryCount: 2
});

const tosHealthClient = new TosClient({
  accessKeyId: config.tosAccessKeyId || "not-configured",
  accessKeySecret: config.tosSecretAccessKey || "not-configured",
  region: config.tosRegion,
  endpoint: config.tosEndpoint,
  requestTimeout: Math.min(config.tosRequestTimeoutMs, 5_000),
  connectionTimeout: Math.min(config.tosRequestTimeoutMs, 5_000),
  maxRetryCount: 0
});

const safeSegment = (value: string) => value.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(-120) || "media";
export const shard = (id: string) => crypto.createHash("sha256").update(id).digest("hex").slice(0, 2);

export const inputObjectKey = (ownerId: string, uploadId: string, fileName: string) => `inputs/${shard(uploadId)}/${ownerId}/${uploadId}/${safeSegment(fileName)}`;
export const assetObjectKey = (ownerId: string, uploadId: string, fileName: string) => `assets/${shard(uploadId)}/${ownerId}/${uploadId}/${safeSegment(fileName)}`;
export const taskReferenceObjectKey = (ownerId: string, sourceType: "video" | "image", sourceId: string, bindingId: string, fileName: string) => {
  const bindingHash = crypto.createHash("sha256").update(bindingId).digest("hex").slice(0, 16);
  const bindingSegment = `${safeSegment(bindingId).slice(-80)}-${bindingHash}`;
  return `task-inputs/${shard(sourceId)}/${ownerId}/${sourceType}/${sourceId}/${bindingSegment}/${safeSegment(fileName)}`;
};
export const outputObjectKey = (ownerId: string, taskId: string, extension: string) => `outputs/${shard(taskId)}/${ownerId}/${taskId}/result${extension.startsWith(".") ? extension : `.${extension}`}`;
export const previewObjectKey = (ownerId: string, taskId: string) => `previews/${shard(taskId)}/${ownerId}/${taskId}/preview.mp4`;
export const posterObjectKey = (ownerId: string, taskId: string) => `posters/${shard(taskId)}/${ownerId}/${taskId}/poster.webp`;
export const canvasExportObjectKey = (ownerId: string, canvasId: string, exportId: string) =>
  `canvas-exports/${shard(exportId)}/${ownerId}/${canvasId}/${exportId}/montage.mp4`;

export const createMultipartUpload = async (key: string, contentType: string, fileName: string) => {
  requireTos();
  const response = await tos.createMultipartUpload({ bucket: config.tosBucket, key, contentType, contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`, forbidOverwrite: true });
  return response.data.UploadId;
};

export const signUploadPart = (key: string, uploadId: string, partNumber: number) => {
  requireTos();
  return tos.getPreSignedUrl({ bucket: config.tosBucket, key, method: "PUT", expires: 3600, query: { uploadId, partNumber: String(partNumber) } });
};

export const completeMultipartUpload = async (key: string, uploadId: string, parts: { partNumber: number; eTag: string }[]) => {
  requireTos();
  return tos.completeMultipartUpload({ bucket: config.tosBucket, key, uploadId, parts, forbidOverwrite: true });
};

export const abortMultipartUpload = async (key: string, uploadId: string) => {
  requireTos();
  return tos.abortMultipartUpload({ bucket: config.tosBucket, key, uploadId });
};

export const abortIncompleteUploadsForKey = async (key: string) => {
  requireTos();
  // The current TOS SDK signs `prefix` incorrectly for this FNS endpoint.
  // List the bounded page and filter locally; this avoids SignatureDoesNotMatch.
  const response = await tos.listMultipartUploads({ bucket: config.tosBucket, maxUploads: 1000 });
  const matches = (response.data.Uploads ?? []).filter((upload) => upload.Key === key);
  const results = await Promise.allSettled(matches.map((upload) => tos.abortMultipartUpload({ bucket: config.tosBucket, key, uploadId: upload.UploadId })));
  const unexpected = results.find((result) => result.status === "rejected" && !["NoSuchUpload", "UploadStatusNotUploading", "UploadStatusMismatch"].includes(String((result.reason as { code?: string }).code)));
  if (unexpected?.status === "rejected") throw unexpected.reason;
  return matches.length;
};

export const headObject = async (key: string) => {
  requireTos();
  return tos.headObject({ bucket: config.tosBucket, key });
};

export const inspectMediaObject = async (key: string, type: "image" | "video" | "audio") => {
  requireTos();
  if (type === "audio") return null;
  const response = await tos.getObjectV2({ bucket: config.tosBucket, key, dataType: "buffer", process: type === "video" ? "video/info" : "image/info" });
  const content = response.data.content.toString("utf8");
  try { return JSON.parse(content) as unknown; }
  catch { throw new Error(`TOS 无法读取${type === "video" ? "视频" : "图片"}元信息`); }
};

export const signedObjectUrl = (key: string, options: { download?: boolean; fileName?: string; expires?: number; process?: string } = {}) => {
  requireTos();
  const download = Boolean(options.download);
  return tos.getPreSignedUrl({
    bucket: config.tosBucket, key, method: "GET",
    expires: options.expires ?? (download ? config.tosDownloadTtlSeconds : config.tosPreviewTtlSeconds),
    query: options.process ? { "x-tos-process": options.process } : undefined,
    response: {
      contentDisposition: `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(options.fileName ?? path.basename(key))}`
    }
  });
};

export const providerObjectSigningInput = (bucket: string, key: string, expires = 2 * 3600) => ({
  bucket,
  key,
  method: "GET" as const,
  expires,
});

/**
 * Provider-facing media URL. Keep this URL free of response header overrides:
 * Gemini rejects otherwise valid TOS pre-signed URLs containing the encoded
 * Content-Disposition override as an unsupported image URL scheme.
 */
export const signedProviderObjectUrl = (key: string, expires = 2 * 3600) => {
  requireTos();
  return tos.getPreSignedUrl(providerObjectSigningInput(config.tosBucket, key, expires));
};

export const tosJobSucceeded = (state: string) => ["success", "succeed", "succeeded", "done", "complete", "completed"].includes(state.trim().toLowerCase());
const fetchFailed = (state: string) => state.toLowerCase().includes("fail") || state.toLowerCase().includes("cancel");
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const responseHeader = (headers: unknown, name: string) => {
  if (!headers || typeof headers !== "object") return "";
  const record = headers as Record<string, string | number | undefined>;
  return String(record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()] ?? "");
};

export const verifyStoredObject = async (key: string, expectedContentType?: string) => {
  const head = await headObject(key);
  const ranged = await tos.getObjectV2({ bucket: config.tosBucket, key, dataType: "buffer", range: "bytes=0-0" });
  if (ranged.statusCode !== 206 || ranged.data.content.length !== 1) throw new Error("TOS Range 校验失败");
  const headData = head.data as unknown as { contentLength?: number; contentType?: string };
  const size = Number(headData.contentLength ?? responseHeader(head.headers, "content-length"));
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error("TOS 对象大小校验失败");
  const contentRange = responseHeader(ranged.headers, "content-range");
  const rangeMatch = /^bytes 0-0\/(\d+)$/i.exec(contentRange);
  if (!rangeMatch || Number(rangeMatch[1]) !== size) throw new Error("TOS Range 总长度与对象不一致");
  const actualContentType = String(headData.contentType ?? responseHeader(head.headers, "content-type")).split(";", 1)[0].trim().toLowerCase();
  if (expectedContentType && actualContentType !== expectedContentType.toLowerCase()) throw new Error(`TOS 媒体类型校验失败 (${actualContentType || "unknown"})`);
  return head;
};

export const optimizePlaybackObject = async (key: string, options: { contentType: string; fileName: string; cacheSeconds: number }) => {
  requireTos();
  await tos.setObjectMeta({
    bucket: config.tosBucket,
    key,
    contentType: options.contentType,
    contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(options.fileName)}`,
    cacheControl: `private, max-age=${options.cacheSeconds}, immutable, no-transform`
  });
  return verifyStoredObject(key, options.contentType);
};

export const verifyProgressiveMp4 = async (key: string) => {
  requireTos();
  const response = await tos.getObjectV2({ bucket: config.tosBucket, key, dataType: "buffer", range: "bytes=0-1048575" });
  if (response.statusCode !== 206) throw new Error("TOS 快启预览 Range 校验失败");
  const structure = inspectMp4Prefix(response.data.content);
  if (!structure.progressive) throw new Error(`预览文件不是渐进式 MP4 (${structure.atoms.join(",") || "unknown"})`);
  return structure;
};

export type VideoTranscodeObserver = {
  jobCreated?: (jobId: string, requestId?: string) => void;
  stateChanged?: (jobId: string, state: string, code: number, message?: string, requestId?: string) => void;
};

export const transcodeVideoOnTos = async (sourceKey: string, targetKey: string, observer: VideoTranscodeObserver = {}) => {
  requireTos();
  const created = await tos.createVideoConvertJob({
    bucket: config.tosBucket,
    input: { Object: sourceKey },
    transcodeConfig: {
      Transcode: {
        Container: { Format: "mp4" as never },
        Video: { Codec: "h264", Width: 1280, BitRate: config.tosPreviewMaxBitrate, PixFmt: "yuv420p" },
        Audio: { Codec: "aac", BitRate: 128000 }
      }
    },
    output: { Region: config.tosRegion, Bucket: config.tosBucket, Object: targetKey }
  });
  const jobId = created.data.JobId;
  observer.jobCreated?.(jobId, created.requestId);
  const deadline = Date.now() + config.tosTranscodeDeadlineMs;
  while (Date.now() < deadline) {
    const response = await tos.getVideoConvertJob({ bucket: config.tosBucket, jobId });
    const state = response.data.State ?? "unknown";
    const code = Number(response.data.Code ?? 0);
    observer.stateChanged?.(jobId, state, code, response.data.Message, response.requestId);
    if (tosJobSucceeded(state)) return verifyStoredObject(targetKey, "video/mp4");
    if (fetchFailed(state) || code !== 0) throw new Error(response.data.Message || `TOS 视频转码失败 (${state}, ${code})`);
    await delay(Math.min(7000, Math.max(1000, deadline - Date.now())));
  }
  throw new Error(`TOS 视频转码超过 ${Math.round(config.tosTranscodeDeadlineMs / 1000)} 秒`);
};

export type FetchObjectObserver = {
  taskCreated?: (taskId: string) => void;
  stateChanged?: (taskId: string, state: string, error: string) => void;
};

export class TosFetchPendingError extends Error {
  readonly code = "TOS_FETCH_PENDING";
  constructor(readonly taskId: string) {
    super("TOS URL 抓取仍在进行中");
    this.name = "TosFetchPendingError";
  }
}

export const fetchObjectFromUrl = async (key: string, url: string, observer: FetchObjectObserver = {}, existingTaskId?: string, pollingDeadlineMs = config.tosFetchDeadlineMs) => {
  requireTos();
  try {
    return await verifyStoredObject(key);
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 404) throw error;
  }
  const createFetchTask = async () => {
    const created = await tos.putFetchTask({ bucket: config.tosBucket, key, url, ignoreSameKey: true });
    observer.taskCreated?.(created.data.TaskId);
    return created.data.TaskId;
  };
  let resumedTask = Boolean(existingTaskId);
  let taskId = existingTaskId ?? await createFetchTask();
  const deadline = Date.now() + pollingDeadlineMs;
  while (Date.now() < deadline) {
    let result;
    try { result = await tos.getFetchTask({ bucket: config.tosBucket, taskId }); }
    catch (error) {
      if (resumedTask && (error as { statusCode?: number }).statusCode === 404) {
        resumedTask = false;
        taskId = await createFetchTask();
        continue;
      }
      throw error;
    }
    const state = result.data.State ?? "unknown";
    observer.stateChanged?.(taskId, state, result.data.Err ?? "");
    if (tosJobSucceeded(state)) return verifyStoredObject(key);
    if (fetchFailed(state)) {
      try { return await verifyStoredObject(key); }
      catch { throw new Error(result.data.Err || `TOS 抓取失败 (${state})`); }
    }
    await delay(Math.min(config.tosFetchPollIntervalMs, Math.max(1000, deadline - Date.now())));
  }
  // The remote fetch can commit on the deadline boundary after the last state
  // poll. Reconcile the deterministic key before scheduling another attempt.
  try { return await verifyStoredObject(key); }
  catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 404) throw error;
    throw new TosFetchPendingError(taskId);
  }
};

export const streamObjectToTos = async (
  key: string,
  source: AsyncIterable<Uint8Array>,
  fileName: string,
  contentType: string,
  onPart?: (partNumber: number, bytes: number, requestId?: string) => void,
  partSize = config.tosUploadPartSize
) => {
  requireTos();
  if (!Number.isSafeInteger(partSize) || partSize < 5 * 1024 * 1024) throw new Error("TOS Multipart 分片不得小于 5 MiB");
  try { return await verifyStoredObject(key); }
  catch (error) { if ((error as { statusCode?: number }).statusCode !== 404) throw error; }

  let uploadId = "";
  try {
    const created = await tos.createMultipartUpload({ bucket: config.tosBucket, key, contentType, contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`, forbidOverwrite: true });
    uploadId = created.data.UploadId;
    const parts: { partNumber: number; eTag: string }[] = [];
    let pending = Buffer.alloc(0); let transferred = 0;
    const requestDeadlineMs = config.tosUploadRequestTimeoutMs;
    const upload = async (body: Buffer) => {
      const partNumber = parts.length + 1;
      let eTag = "";
      let requestId = "";
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), requestDeadlineMs);
        try {
          const url = signUploadPart(key, uploadId, partNumber);
          const response = await fetch(url, {
            method: "PUT",
            body: new Uint8Array(body),
            headers: { "content-length": String(body.length) },
            signal: controller.signal
          });
          requestId = response.headers.get("x-tos-request-id") ?? "";
          if (!response.ok) throw new Error(`TOS 分片上传失败 (${response.status})${requestId ? ` requestId=${requestId}` : ""}`);
          eTag = (response.headers.get("etag") ?? "").replace(/^"|"$/g, "");
          if (!eTag) throw new Error(`TOS 分片上传缺少 ETag${requestId ? ` requestId=${requestId}` : ""}`);
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await delay(1000 * (2 ** attempt));
        } finally { clearTimeout(timer); }
      }
      if (!eTag) {
        if ((lastError as Error | undefined)?.name === "AbortError") throw new Error(`TOS 分片上传超过 ${Math.round(requestDeadlineMs / 1000)} 秒`);
        throw lastError ?? new Error("TOS 分片上传失败");
      }
      parts.push({ partNumber, eTag });
      transferred += body.length;
      onPart?.(partNumber, transferred, requestId || undefined);
    };
    for await (const value of source) {
      pending = Buffer.concat([pending, Buffer.from(value)]);
      while (pending.length >= partSize) {
        await upload(pending.subarray(0, partSize));
        pending = pending.subarray(partSize);
      }
    }
    if (pending.length) await upload(pending);
    if (!parts.length) throw new Error("媒体处理没有产生可上传的数据");
    try {
      await tos.completeMultipartUpload({ bucket: config.tosBucket, key, uploadId, parts, forbidOverwrite: true });
    } catch (error) {
      // CompleteMultipartUpload is not safe to blindly repeat: its response can
      // be lost after TOS commits. The deterministic key is the idempotency key.
      try {
        const reconciled = await verifyStoredObject(key);
        uploadId = "";
        return reconciled;
      } catch { throw error; }
    }
    uploadId = "";
    return await verifyStoredObject(key);
  } finally {
    if (uploadId) await tos.abortMultipartUpload({ bucket: config.tosBucket, key, uploadId }).catch(() => undefined);
  }
};

export const streamObjectFromUrl = async (
  key: string,
  url: string,
  fileName: string,
  contentTypeHint: string,
  onPart?: (partNumber: number, bytes: number) => void,
  partSize = config.tosUploadPartSize,
) => {
  const controller = new AbortController();
  const sourceTimer = setTimeout(() => controller.abort(), config.tosSourceStreamTimeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`上游成片读取失败 (${response.status})`);
    return await streamObjectToTos(key, response.body as AsyncIterable<Uint8Array>, fileName, response.headers.get("content-type") || contentTypeHint, onPart, partSize);
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error(`上游流式归档超过 ${Math.round(config.tosSourceStreamTimeoutMs / 1000)} 秒`);
    throw error;
  } finally { clearTimeout(sourceTimer); }
};

export const sourceSizeFromContentRange = (value: string | null) => {
  const match = value?.match(/^bytes\s+0-0\/(\d+)$/i);
  const size = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(size) && size > 0 ? size : 0;
};

export const rangedSourceParts = (totalSize: number, partSize: number) => {
  if (!Number.isSafeInteger(totalSize) || totalSize <= 0) throw new Error("媒体总大小无效");
  if (!Number.isSafeInteger(partSize) || partSize <= 0) throw new Error("媒体分片大小无效");
  return Array.from({ length: Math.ceil(totalSize / partSize) }, (_, index) => {
    const start = index * partSize;
    const end = Math.min(totalSize - 1, start + partSize - 1);
    return { partNumber: index + 1, start, end, size: end - start + 1 };
  });
};

export type RangedArchiveCheckpoint = {
  uploadId?: string;
  sourceSize?: number;
  contentType?: string;
  parts?: { partNumber: number; eTag: string }[];
};

export type RangedArchiveObserver = {
  checkpoint?: (state: Required<Pick<RangedArchiveCheckpoint, "sourceSize" | "contentType" | "parts">> & { uploadId: string }) => void;
  resumed?: (uploadId: string, skippedParts: number) => void;
};

const listAllUploadedParts = async (key: string, uploadId: string) => {
  const parts: { partNumber: number; eTag: string }[] = [];
  let marker: number | undefined;
  do {
    const response = await tos.listParts({ bucket: config.tosBucket, key, uploadId, maxParts: 1000, partNumberMarker: marker });
    parts.push(...(response.data.Parts ?? []).map((part) => ({ partNumber: part.PartNumber, eTag: part.ETag.replace(/^"|"$/g, "") })));
    marker = response.data.IsTruncated ? response.data.NextPartNumberMarker : undefined;
  } while (marker !== undefined);
  return parts;
};

export const rangedObjectFromUrl = async (
  key: string,
  url: string,
  fileName: string,
  contentTypeHint: string,
  onPart?: (partNumber: number, bytes: number) => void,
  partSize = 5 * 1024 * 1024,
  concurrency = config.tosUploadConcurrency,
  checkpoint: RangedArchiveCheckpoint = {},
  observer: RangedArchiveObserver = {},
) => {
  requireTos();
  if (!Number.isSafeInteger(partSize) || partSize < 5 * 1024 * 1024) throw new Error("TOS Multipart 分片不得小于 5 MiB");
  try { return await verifyStoredObject(key); }
  catch (error) { if ((error as { statusCode?: number }).statusCode !== 404) throw error; }

  const probeController = new AbortController();
  const probeTimer = setTimeout(() => probeController.abort(), config.tosUploadRequestTimeoutMs);
  let probe: Response;
  try {
    probe = await fetch(url, { headers: { range: "bytes=0-0" }, signal: probeController.signal });
    if (probe.status !== 206) throw new Error(`上游成片不支持 Range 归档 (${probe.status})`);
    await probe.arrayBuffer();
  } finally { clearTimeout(probeTimer); }
  const totalSize = sourceSizeFromContentRange(probe.headers.get("content-range"));
  if (!totalSize) throw new Error("上游成片 Range 响应缺少有效总大小");
  const contentType = probe.headers.get("content-type") || contentTypeHint;
  const ranges = rangedSourceParts(totalSize, partSize);
  const partCount = ranges.length;
  const workerCount = Math.min(Math.max(1, concurrency), partCount);
  const partDeadlineMs = config.tosUploadRequestTimeoutMs;
  let uploadId = checkpoint.uploadId ?? "";
  let knownParts: { partNumber: number; eTag: string }[] = [];
  if (uploadId) {
    try {
      knownParts = await listAllUploadedParts(key, uploadId);
      observer.resumed?.(uploadId, knownParts.length);
    } catch (error) {
      if ((error as { code?: string }).code !== "NoSuchUpload") throw error;
      uploadId = "";
      knownParts = [];
    }
  }
  if (!uploadId) {
    const created = await tos.createMultipartUpload({ bucket: config.tosBucket, key, contentType, contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`, forbidOverwrite: true });
    uploadId = created.data.UploadId;
  }
  const completed = new Map(knownParts.map((part) => [part.partNumber, part]));
  observer.checkpoint?.({ uploadId, sourceSize: totalSize, contentType, parts: [...completed.values()] });
  try {
    let cursor = 0;
    let transferred = ranges.filter((range) => completed.has(range.partNumber)).reduce((total, range) => total + range.size, 0);
    const transferNext = async (): Promise<void> => {
      const index = cursor++;
      if (index >= partCount) return;
      const { partNumber, start, end, size: expectedBytes } = ranges[index]!;
      if (completed.has(partNumber)) return transferNext();
      let body: Uint8Array | undefined;
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), partDeadlineMs);
        try {
          const source = await fetch(url, { headers: { range: `bytes=${start}-${end}` }, signal: controller.signal });
          if (source.status !== 206) throw new Error(`上游 Range 分片读取失败 (${source.status})`);
          body = new Uint8Array(await source.arrayBuffer());
          if (body.byteLength !== expectedBytes) throw new Error(`上游 Range 分片大小不一致 (${body.byteLength}/${expectedBytes})`);
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await delay(1000 * (2 ** attempt));
        } finally { clearTimeout(timer); }
      }
      if (lastError) {
        if ((lastError as Error).name === "AbortError") throw new Error(`上游 Range 分片读取超过 ${Math.round(partDeadlineMs / 1000)} 秒`);
        throw lastError;
      }
      if (!body) throw new Error("上游 Range 分片读取为空");
      const uploadBody = Uint8Array.from(body);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), partDeadlineMs);
        try {
          const target = await fetch(signUploadPart(key, uploadId, partNumber), {
            method: "PUT", body: uploadBody, headers: { "content-length": String(uploadBody.byteLength) }, signal: controller.signal,
          });
          if (!target.ok) throw new Error(`TOS 分片上传失败 (${target.status})`);
          const eTag = (target.headers.get("etag") ?? "").replace(/^"|"$/g, "");
          if (!eTag) throw new Error("TOS 分片上传缺少 ETag");
          completed.set(partNumber, { partNumber, eTag });
          transferred += body.byteLength;
          onPart?.(partNumber, transferred);
          observer.checkpoint?.({ uploadId, sourceSize: totalSize, contentType, parts: [...completed.values()].sort((a, b) => a.partNumber - b.partNumber) });
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await delay(1000 * (2 ** attempt));
        } finally { clearTimeout(timer); }
      }
      if (lastError) {
        if ((lastError as Error).name === "AbortError") throw new Error(`TOS Range 分片上传超过 ${Math.round(partDeadlineMs / 1000)} 秒`);
        throw lastError;
      }
      await transferNext();
    };
    const transfers = await Promise.allSettled(Array.from({ length: workerCount }, () => transferNext()));
    const failed = transfers.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
    try {
      const parts = [...completed.values()].sort((a, b) => a.partNumber - b.partNumber);
      if (parts.length !== partCount) throw new Error(`TOS Multipart 分片不完整 (${parts.length}/${partCount})`);
      await tos.completeMultipartUpload({ bucket: config.tosBucket, key, uploadId, parts, forbidOverwrite: true });
    } catch (error) {
      try {
        const reconciled = await verifyStoredObject(key);
        uploadId = "";
        return reconciled;
      } catch { throw error; }
    }
    uploadId = "";
    return await verifyStoredObject(key);
  } catch (error) {
    // Keep the multipart session alive. The durable checkpoint plus ListParts
    // allows the next BullMQ attempt or a replacement worker to resume it.
    throw error;
  }
};

export const createPoster = async (sourceKey: string, targetKey: string) => {
  requireTos();
  const stagingKey = `${targetKey}.source.jpg`;
  const encodedBucket = Buffer.from(config.tosBucket).toString("base64url");
  try {
    await tos.getObjectV2({
      bucket: config.tosBucket, key: sourceKey, dataType: "buffer", process: "video/snapshot,t_1000,f_jpg",
      saveBucket: encodedBucket, saveObject: Buffer.from(stagingKey).toString("base64url")
    });
    await tos.getObjectV2({
      bucket: config.tosBucket, key: stagingKey, dataType: "buffer", process: "image/resize,w_960/format,webp",
      saveBucket: encodedBucket, saveObject: Buffer.from(targetKey).toString("base64url")
    });
    return await headObject(targetKey);
  } finally {
    await tos.deleteObject({ bucket: config.tosBucket, key: stagingKey }).catch(() => undefined);
  }
};

export const putObjectBuffer = async (key: string, body: Buffer, contentType: string, fileName = path.basename(key)) => {
  requireTos();
  const response = await tos.putObject({
    bucket: config.tosBucket,
    key,
    body,
    contentType,
    contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    cacheControl: "private, max-age=604800, immutable, no-transform",
    forbidOverwrite: true
  });
  const size = Number((response.data as unknown as { contentLength?: number })?.contentLength ?? body.length) || body.length;
  return { size, etag: String((response.data as unknown as { etag?: string })?.etag ?? "").replace(/^"|"$/g, "") };
};

export const deleteObject = async (key: string) => {
  requireTos();
  await tos.deleteObject({ bucket: config.tosBucket, key });
};

export const tosHealth = async () => {
  if (!tosConfigured()) return { configured: false, reachable: false };
  try { await tosHealthClient.headBucket(config.tosBucket); return { configured: true, reachable: true }; }
  catch { return { configured: true, reachable: false }; }
};
