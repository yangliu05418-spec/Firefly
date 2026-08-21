import { prepareImageForUpload } from "./image-normalize";

export const AUTH_EXPIRED_EVENT = "firefly:auth-expired";
const AUTH_CHANNEL = "firefly-auth";
export type SignedOutReason = "expired" | "explicit";

export const notifySignedOut = (reason: SignedOutReason = "expired") => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SignedOutReason>(AUTH_EXPIRED_EVENT, { detail: reason }));
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(AUTH_CHANNEL);
  channel.postMessage({ type: "signed-out", reason });
  channel.close();
};

export const listenForSignedOut = (callback: (reason: SignedOutReason) => void) => {
  if (typeof window === "undefined") return () => undefined;
  const onLocal = (event: Event) => callback(event instanceof CustomEvent && event.detail === "explicit" ? "explicit" : "expired");
  window.addEventListener(AUTH_EXPIRED_EVENT, onLocal);
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(AUTH_CHANNEL);
  if (channel) channel.onmessage = (event) => { if (event.data?.type === "signed-out") callback(event.data.reason === "explicit" ? "explicit" : "expired"); };
  return () => { window.removeEventListener(AUTH_EXPIRED_EVENT, onLocal); channel?.close(); };
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly requestId?: string) { super(message); this.name = "ApiError"; }
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
  const timer = globalThis.setTimeout(finish, ms);
  const abort = () => { globalThis.clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new DOMException("已取消上传", "AbortError")); };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
});

const fetchWithTimeout = async <T = Response>(url: string, options: RequestInit, timeoutMs: number, signal?: AbortSignal, consume?: (response: Response) => Promise<T>) => {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("请求超时", "TimeoutError"));
  }, timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return consume ? await consume(response) : response as T;
  }
  catch (error) { if (timedOut) throw new DOMException("请求超时", "TimeoutError"); throw error; }
  finally { globalThis.clearTimeout(timer); signal?.removeEventListener("abort", abort); }
};

type ApiRequestInit = RequestInit & { timeoutMs?: number };
export type ApiCallOptions = Omit<ApiRequestInit, "method" | "body">;
const readMethod = (method?: string) => !method || ["GET", "HEAD"].includes(method.toUpperCase());

const request = async <T>(url: string, options: ApiRequestInit = {}): Promise<T> => {
  const { timeoutMs = readMethod(options.method) ? 20_000 : 30_000, signal, ...fetchOptions } = options;
  try {
    return await fetchWithTimeout<T>(url, { credentials: "same-origin", ...fetchOptions, headers: { ...(options.body instanceof Blob ? {} : { "Content-Type": "application/json" }), ...options.headers } }, timeoutMs, signal ?? undefined, async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string; requestId?: string; code?: string };
        if (response.status === 401) notifySignedOut();
        const requestId = body.requestId ?? response.headers.get("x-request-id") ?? undefined;
        throw new ApiError(`${body.error ?? `请求失败 (${response.status})`}${requestId ? ` · 请求编号 ${requestId.slice(0, 8)}` : ""}`, response.status, body.code, requestId);
      }
      return response.status === 204 ? undefined as T : await response.json() as T;
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("请求已取消", "AbortError");
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiError(readMethod(options.method) ? "网络响应超时，请重试" : "响应超时，操作可能已完成，请刷新确认", 0, "CLIENT_TIMEOUT");
    }
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof SyntaxError) throw new ApiError("服务器响应格式异常，请稍后重试", 0, "INVALID_RESPONSE");
    throw new ApiError(error instanceof Error ? error.message : "网络连接失败", 0, "NETWORK_ERROR");
  }
};
export const api = {
  get: <T>(url: string, options?: ApiCallOptions) => request<T>(url, options),
  post: <T>(url: string, body?: unknown, options?: ApiCallOptions) => request<T>(url, { ...options, method: "POST", body: body instanceof Blob ? body : JSON.stringify(body ?? {}) }),
  patch: <T>(url: string, body: unknown, options?: ApiCallOptions) => request<T>(url, { ...options, method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(url: string, options?: ApiCallOptions) => request<T>(url, { ...options, method: "DELETE" }),
};

class UploadSemaphore {
  private active = 0;
  private readonly pending: (() => void)[] = [];
  constructor(private readonly limit: number) {}
  async use<T>(work: () => Promise<T>, signal?: AbortSignal) {
    if (this.active >= this.limit) await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException("已取消上传", "AbortError"));
      const enter = () => { signal?.removeEventListener("abort", cancel); resolve(); };
      const cancel = () => { const index = this.pending.indexOf(enter); if (index >= 0) this.pending.splice(index, 1); reject(new DOMException("已取消上传", "AbortError")); };
      this.pending.push(enter); signal?.addEventListener("abort", cancel, { once: true });
    });
    this.active += 1;
    try { return await work(); }
    finally { this.active -= 1; this.pending.shift()?.(); }
  }
}

/** Global per-tab cap; batch upload cannot multiply per-file TOS concurrency without bound. */
const tosPartRequests = new UploadSemaphore(6);

export type UploadKind = "image" | "video" | "audio";
const extensionKinds: Record<string, UploadKind> = {
  jpg: "image", jpeg: "image", png: "image", webp: "image", bmp: "image", tiff: "image", gif: "image", heic: "image", heif: "image",
  mp4: "video", mov: "video", mp3: "audio", wav: "audio"
};
export const inferUploadType = (file: Pick<File, "name" | "type">): UploadKind | undefined => {
  if (/^(image|video|audio)\//.test(file.type)) return file.type.split("/", 1)[0] as UploadKind;
  return extensionKinds[file.name.split(".").pop()?.toLowerCase() ?? ""];
};

async function uploadChunk(uploadId: string, file: File, offset: number, chunkSize: number, signal?: AbortSignal) {
  const chunk = file.slice(offset, Math.min(file.size, offset + chunkSize));
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await wait([1000, 2000, 4000][attempt - 1], signal);
    let response: Response;
    let responseBody: { error?: string; expectedOffset?: number } = {};
    try {
      const received = await fetchWithTimeout(`/api/uploads/${uploadId}/chunks`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/octet-stream", "X-Upload-Offset": String(offset) }, body: chunk }, 120_000, signal, async (result) => ({
        response: result,
        body: result.ok ? {} : await result.json().catch(() => ({})) as { error?: string; expectedOffset?: number },
      }));
      response = received.response;
      responseBody = received.body;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("素材上传失败");
      if (attempt === 3) throw lastError;
      continue;
    }
    if (response.ok) return offset + chunk.size;
    if (response.status === 409 && typeof responseBody.expectedOffset === "number") {
      if (responseBody.expectedOffset > offset) return responseBody.expectedOffset;
      if (responseBody.expectedOffset === offset && attempt < 3) { lastError = new Error(responseBody.error ?? "上一分片仍在写入"); continue; }
    }
    lastError = new Error(responseBody.error ?? "素材上传失败");
    if (response.status < 500 && response.status !== 429) throw lastError;
    if (attempt === 3) throw lastError;
  }
  throw lastError ?? new Error("素材上传失败");
}

type SignedPart = { partNumber: number; url: string };

async function uploadTosPart(uploadId: string, initial: SignedPart, blob: Blob, signal?: AbortSignal) {
  let signed = initial;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await wait([1000, 2000, 4000][attempt - 1], signal);
    let response: Response;
    try { response = await tosPartRequests.use(() => fetchWithTimeout(signed.url, { method: "PUT", body: blob }, 180_000, signal), signal); }
    catch (error) { lastError = error instanceof Error ? error : new Error("TOS 分片上传失败"); if (attempt === 3) throw lastError; continue; }
    if (response.ok) {
      const eTag = (response.headers.get("etag") ?? "").replace(/^"|"$/g, "");
      if (!eTag) throw new Error("TOS 未返回 ETag，请检查 Bucket CORS 的 Expose Headers");
      return { partNumber: signed.partNumber, eTag };
    }
    lastError = new Error(`TOS 分片上传失败 (${response.status})`);
    if ([401, 403].includes(response.status) && attempt < 3) {
      const refreshed = await api.post<{ parts: SignedPart[] }>(`/api/uploads/${uploadId}/parts/sign`, { partNumbers: [signed.partNumber] });
      signed = refreshed.parts[0] ?? signed;
      continue;
    }
    if (response.status < 500 && response.status !== 429) throw lastError;
    if (attempt === 3) throw lastError;
  }
  throw lastError ?? new Error("TOS 分片上传失败");
}

export type UploadedFile = { id: string; uploadId?: string; name: string; type: UploadKind; size: number; url?: string; normalized?: boolean };
type UploadCompletionResponse = UploadedFile & { state?: "processing" | "ready" };
export type UploadProgressPhase = "preparing" | "uploading" | "verifying" | "ready";
export type UploadFileOptions = { signal?: AbortSignal; onTransportComplete?: (upload: UploadedFile) => void; onPreparedPreview?: (blob: Blob) => void; waitForReady?: boolean };

const finalizeUpload = async (uploadId: string, body: unknown, signal?: AbortSignal, onTransportComplete?: (upload: UploadedFile) => void, waitForReady = true): Promise<UploadCompletionResponse> => {
  const deadline = Date.now() + 240_000;
  let lastError: unknown;
  let accepted = false;
  let transportReported = false;
  let attempt = 0;
  while (Date.now() < deadline) {
    if (attempt) await wait(accepted ? 1500 : Math.min(8000, 1000 * 2 ** Math.min(attempt - 1, 3)), signal);
    const timeout = Math.max(1000, Math.min(accepted ? 20_000 : 205_000, deadline - Date.now()));
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    const timer = globalThis.setTimeout(() => controller.abort(new DOMException("素材校验超时", "TimeoutError")), timeout);
    try {
      const result = accepted
        ? await request<UploadCompletionResponse>(`/api/uploads/${uploadId}`, { signal: controller.signal, timeoutMs: timeout })
        : await request<UploadCompletionResponse>(`/api/uploads/${uploadId}/complete`, { method: "POST", body: JSON.stringify(body ?? {}), signal: controller.signal, timeoutMs: timeout });
      if (result.state !== "processing") return result;
      accepted = true;
      if (!transportReported) { transportReported = true; onTransportComplete?.(result); }
      if (!waitForReady) return result;
      lastError = new Error("素材已上传，正在准备生成引用");
    }
    catch (error) {
      lastError = error;
      if (error instanceof DOMException && error.name === "AbortError" && signal?.aborted) throw error;
      if (error instanceof ApiError && error.status > 0 && error.status < 500 && ![409, 425, 429].includes(error.status)) throw error;
    } finally { globalThis.clearTimeout(timer); signal?.removeEventListener("abort", abort); }
    attempt += 1;
  }
  throw lastError instanceof Error ? lastError : new Error("素材完成校验失败，请稍后重试");
};

export async function uploadFile(file: File, type: UploadKind, onProgress: (value: number, phase: UploadProgressPhase) => void, options: UploadFileOptions = {}) {
  const signal = options.signal;
  onProgress(0, type === "image" ? "preparing" : "uploading");
  const prepared = type === "image" ? await prepareImageForUpload(file, signal, Boolean(options.onPreparedPreview)) : { file, normalized: false, previewBlob: undefined };
  if (prepared.previewBlob) options.onPreparedPreview?.(prepared.previewBlob);
  const upload = prepared.file;
  let transportReported = false;
  const reportTransportComplete = options.onTransportComplete
    ? (accepted: UploadedFile) => {
      if (transportReported) return;
      transportReported = true;
      options.onTransportComplete?.({ ...accepted, name: file.name, normalized: prepared.normalized });
    }
    : undefined;
  onProgress(0, "uploading");
  const init = await api.post<{ id: string; chunkSize: number; direct?: boolean; concurrency?: number; parts?: SignedPart[] }>("/api/uploads", { name: upload.name, size: upload.size, type, mime: upload.type });
  const heartbeat = globalThis.setInterval(() => { void api.post(`/api/uploads/${init.id}/heartbeat`).catch(() => undefined); }, 60_000);
  try {
  if (init.direct) {
    const parts = init.parts ?? [];
    const results: { partNumber: number; eTag: string }[] = [];
    let cursor = 0; let completedBytes = 0;
    const worker = async () => {
      while (cursor < parts.length) {
        const part = parts[cursor++];
        const start = (part.partNumber - 1) * init.chunkSize;
        const blob = upload.slice(start, Math.min(upload.size, start + init.chunkSize));
        results.push(await uploadTosPart(init.id, part, blob, signal));
        completedBytes += blob.size;
        onProgress(Math.min(100, Math.round(completedBytes / upload.size * 100)), "uploading");
      }
    };
    await Promise.all(Array.from({ length: Math.min(init.concurrency ?? 3, parts.length) }, worker));
    onProgress(100, "verifying");
    const completed = { ...(await finalizeUpload(init.id, { parts: results.sort((a, b) => a.partNumber - b.partNumber) }, signal, reportTransportComplete, options.waitForReady !== false)), name: file.name, normalized: prepared.normalized };
    reportTransportComplete?.(completed);
    if (completed.state !== "processing") onProgress(100, "ready");
    return completed;
  }
  let offset = 0;
  while (offset < upload.size) {
    offset = await uploadChunk(init.id, upload, offset, init.chunkSize, signal);
    onProgress(Math.round(offset / upload.size * 100), "uploading");
  }
  onProgress(100, "verifying");
  const completed = { ...(await finalizeUpload(init.id, {}, signal, reportTransportComplete, options.waitForReady !== false)), name: file.name, normalized: prepared.normalized };
  reportTransportComplete?.(completed);
  if (completed.state !== "processing") onProgress(100, "ready");
  return completed;
  } catch (error) {
    // Cancellation is completion-lock-aware: it cannot delete an object that the server is finalizing
    // or has already committed to the durable media database.
    await api.delete(`/api/uploads/${init.id}`, { timeoutMs: 5_000 }).catch(() => undefined);
    throw error;
  } finally { globalThis.clearInterval(heartbeat); }
}
