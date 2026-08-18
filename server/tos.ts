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

const safeSegment = (value: string) => value.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(-120) || "media";
export const shard = (id: string) => crypto.createHash("sha256").update(id).digest("hex").slice(0, 2);

export const inputObjectKey = (ownerId: string, uploadId: string, fileName: string) => `inputs/${shard(uploadId)}/${ownerId}/${uploadId}/${safeSegment(fileName)}`;
export const outputObjectKey = (ownerId: string, taskId: string, extension: string) => `outputs/${shard(taskId)}/${ownerId}/${taskId}/result${extension.startsWith(".") ? extension : `.${extension}`}`;
export const previewObjectKey = (ownerId: string, taskId: string) => `previews/${shard(taskId)}/${ownerId}/${taskId}/preview.mp4`;
export const posterObjectKey = (ownerId: string, taskId: string) => `posters/${shard(taskId)}/${ownerId}/${taskId}/poster.webp`;

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

export const signedObjectUrl = (key: string, options: { download?: boolean; fileName?: string; expires?: number } = {}) => {
  requireTos();
  const download = Boolean(options.download);
  return tos.getPreSignedUrl({
    bucket: config.tosBucket, key, method: "GET",
    expires: options.expires ?? (download ? config.tosDownloadTtlSeconds : config.tosPreviewTtlSeconds),
    response: {
      contentDisposition: `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(options.fileName ?? path.basename(key))}`
    }
  });
};

const fetchSucceeded = (state: string) => ["success", "succeeded", "done", "complete", "completed"].includes(state.toLowerCase());
const fetchFailed = (state: string) => state.toLowerCase().includes("fail") || state.toLowerCase().includes("cancel");
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const responseHeader = (headers: unknown, name: string) => {
  if (!headers || typeof headers !== "object") return "";
  const record = headers as Record<string, string | number | undefined>;
  return String(record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()] ?? "");
};

const verifyStoredObject = async (key: string, expectedContentType?: string) => {
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
    if (fetchSucceeded(state)) return verifyStoredObject(targetKey, "video/mp4");
    if (fetchFailed(state) || code !== 0) throw new Error(response.data.Message || `TOS 视频转码失败 (${state}, ${code})`);
    await delay(Math.min(7000, Math.max(1000, deadline - Date.now())));
  }
  throw new Error(`TOS 视频转码超过 ${Math.round(config.tosTranscodeDeadlineMs / 1000)} 秒`);
};

export type FetchObjectObserver = {
  taskCreated?: (taskId: string) => void;
  stateChanged?: (taskId: string, state: string, error: string) => void;
};

export const fetchObjectFromUrl = async (key: string, url: string, observer: FetchObjectObserver = {}) => {
  requireTos();
  try {
    return await verifyStoredObject(key);
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 404) throw error;
  }
  const created = await tos.putFetchTask({ bucket: config.tosBucket, key, url, ignoreSameKey: true });
  const taskId = created.data.TaskId;
  observer.taskCreated?.(taskId);
  const deadline = Date.now() + config.tosFetchDeadlineMs;
  while (Date.now() < deadline) {
    const result = await tos.getFetchTask({ bucket: config.tosBucket, taskId });
    const state = result.data.State ?? "unknown";
    observer.stateChanged?.(taskId, state, result.data.Err ?? "");
    if (fetchSucceeded(state)) return verifyStoredObject(key);
    if (fetchFailed(state)) {
      try { return await verifyStoredObject(key); }
      catch { throw new Error(result.data.Err || `TOS 抓取失败 (${state})`); }
    }
    await delay(Math.min(10000, Math.max(1000, deadline - Date.now())));
  }
  throw new Error(`TOS URL 抓取超过 ${Math.round(config.tosFetchDeadlineMs / 1000)} 秒`);
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
    const upload = async (body: Buffer) => {
      const partNumber = parts.length + 1;
      let eTag = "";
      let requestId = "";
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.tosUploadRequestTimeoutMs);
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
        if ((lastError as Error | undefined)?.name === "AbortError") throw new Error(`TOS 分片上传超过 ${Math.round(config.tosUploadRequestTimeoutMs / 1000)} 秒`);
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
    await tos.completeMultipartUpload({ bucket: config.tosBucket, key, uploadId, parts, forbidOverwrite: true });
    uploadId = "";
    return await verifyStoredObject(key);
  } finally {
    if (uploadId) await tos.abortMultipartUpload({ bucket: config.tosBucket, key, uploadId }).catch(() => undefined);
  }
};

export const streamObjectFromUrl = async (key: string, url: string, fileName: string, contentTypeHint: string, onPart?: (partNumber: number, bytes: number) => void) => {
  const controller = new AbortController();
  const sourceTimer = setTimeout(() => controller.abort(), config.tosSourceStreamTimeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`上游成片读取失败 (${response.status})`);
    return await streamObjectToTos(key, response.body as AsyncIterable<Uint8Array>, fileName, response.headers.get("content-type") || contentTypeHint, onPart);
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error(`上游流式归档超过 ${Math.round(config.tosSourceStreamTimeoutMs / 1000)} 秒`);
    throw error;
  } finally { clearTimeout(sourceTimer); }
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

export const putObjectBuffer = async (key: string, body: Buffer, contentType: string) => {
  requireTos();
  const response = await tos.putObject({ bucket: config.tosBucket, key, body, contentType, forbidOverwrite: true });
  const size = Number((response.data as unknown as { contentLength?: number })?.contentLength ?? body.length) || body.length;
  return { size, etag: String((response.data as unknown as { etag?: string })?.etag ?? "").replace(/^"|"$/g, "") };
};

export const deleteObject = async (key: string) => {
  requireTos();
  await tos.deleteObject({ bucket: config.tosBucket, key });
};

export const tosHealth = async () => {
  if (!tosConfigured()) return { configured: false, reachable: false };
  try { await tos.headBucket(config.tosBucket); return { configured: true, reachable: true }; }
  catch { return { configured: true, reachable: false }; }
};
