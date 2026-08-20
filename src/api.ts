import { prepareImageForUpload } from "./image-normalize";

export const AUTH_EXPIRED_EVENT = "firefly:auth-expired";
const AUTH_CHANNEL = "firefly-auth";

export const notifySignedOut = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(AUTH_CHANNEL);
  channel.postMessage({ type: "signed-out" });
  channel.close();
};

export const listenForSignedOut = (callback: () => void) => {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(AUTH_EXPIRED_EVENT, callback);
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(AUTH_CHANNEL);
  if (channel) channel.onmessage = (event) => { if (event.data?.type === "signed-out") callback(); };
  return () => { window.removeEventListener(AUTH_EXPIRED_EVENT, callback); channel?.close(); };
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly requestId?: string) { super(message); this.name = "ApiError"; }
}

const request = async <T>(url: string, options?: RequestInit): Promise<T> => {
  let response: Response;
  try { response = await fetch(url, { credentials: "same-origin", ...options, headers: { ...(options?.body instanceof Blob ? {} : { "Content-Type": "application/json" }), ...options?.headers } }); }
  catch (error) { if (error instanceof DOMException && error.name === "AbortError") throw error; throw new ApiError(error instanceof Error ? error.message : "网络连接失败", 0); }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; requestId?: string; code?: string };
    if (response.status === 401) notifySignedOut();
    const requestId = body.requestId ?? response.headers.get("x-request-id") ?? undefined;
    throw new ApiError(`${body.error ?? `请求失败 (${response.status})`}${requestId ? ` · 请求编号 ${requestId.slice(0, 8)}` : ""}`, response.status, body.code, requestId);
  }
  return response.status === 204 ? undefined as T : response.json();
};
export const api = { get: <T>(url: string) => request<T>(url), post: <T>(url: string, body?: unknown) => request<T>(url, { method: "POST", body: body instanceof Blob ? body : JSON.stringify(body ?? {}) }), patch: <T>(url: string, body: unknown) => request<T>(url, { method: "PATCH", body: JSON.stringify(body) }), delete: <T>(url: string) => request<T>(url, { method: "DELETE" }) };

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new DOMException("已取消上传", "AbortError"));
  const timer = globalThis.setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { globalThis.clearTimeout(timer); reject(new DOMException("已取消上传", "AbortError")); }, { once: true });
});

const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number, signal?: AbortSignal) => {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timer = globalThis.setTimeout(() => controller.abort(new DOMException("请求超时", "TimeoutError")), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { globalThis.clearTimeout(timer); signal?.removeEventListener("abort", abort); }
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
    try {
      response = await fetchWithTimeout(`/api/uploads/${uploadId}/chunks`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/octet-stream", "X-Upload-Offset": String(offset) }, body: chunk }, 120_000, signal);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("素材上传失败");
      if (attempt === 3) throw lastError;
      continue;
    }
    if (response.ok) return offset + chunk.size;
    const body = await response.json().catch(() => ({})) as { error?: string; expectedOffset?: number };
    if (response.status === 409 && typeof body.expectedOffset === "number") {
      if (body.expectedOffset > offset) return body.expectedOffset;
      if (body.expectedOffset === offset && attempt < 3) { lastError = new Error(body.error ?? "上一分片仍在写入"); continue; }
    }
    lastError = new Error(body.error ?? "素材上传失败");
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

type UploadedFile = { id: string; uploadId?: string; name: string; type: UploadKind; size: number; url?: string; normalized?: boolean };

const finalizeUpload = async (uploadId: string, body: unknown, signal?: AbortSignal): Promise<UploadedFile> => {
  const deadline = Date.now() + 240_000;
  let lastError: unknown;
  for (let attempt = 0; attempt < 5 && Date.now() < deadline; attempt += 1) {
    if (attempt) await wait(Math.min(8000, 1000 * 2 ** (attempt - 1)), signal);
    const timeout = Math.max(1000, Math.min(205_000, deadline - Date.now()));
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    const timer = globalThis.setTimeout(() => controller.abort(new DOMException("素材校验超时", "TimeoutError")), timeout);
    try { return await request<UploadedFile>(`/api/uploads/${uploadId}/complete`, { method: "POST", body: JSON.stringify(body ?? {}), signal: controller.signal }); }
    catch (error) {
      lastError = error;
      if (error instanceof DOMException && error.name === "AbortError" && signal?.aborted) throw error;
      if (error instanceof ApiError && error.status > 0 && error.status < 500 && ![409, 425, 429].includes(error.status)) throw error;
    } finally { globalThis.clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }
  throw lastError instanceof Error ? lastError : new Error("素材完成校验失败，请稍后重试");
};

export async function uploadFile(file: File, type: UploadKind, onProgress: (value: number) => void, options: { signal?: AbortSignal } = {}) {
  const signal = options.signal;
  const prepared = type === "image" ? await prepareImageForUpload(file, signal) : { file, normalized: false };
  const upload = prepared.file;
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
        onProgress(Math.min(100, Math.round(completedBytes / upload.size * 100)));
      }
    };
    await Promise.all(Array.from({ length: Math.min(init.concurrency ?? 3, parts.length) }, worker));
    return { ...(await finalizeUpload(init.id, { parts: results.sort((a, b) => a.partNumber - b.partNumber) }, signal)), name: file.name, normalized: prepared.normalized };
  }
  let offset = 0;
  while (offset < upload.size) {
    offset = await uploadChunk(init.id, upload, offset, init.chunkSize, signal);
    onProgress(Math.round(offset / upload.size * 100));
  }
  return { ...(await finalizeUpload(init.id, {}, signal)), name: file.name, normalized: prepared.normalized };
  } catch (error) {
    // Cancellation is completion-lock-aware: it cannot delete an object that the server is finalizing
    // or has already committed to the durable media database.
    await api.delete(`/api/uploads/${init.id}`).catch(() => undefined);
    throw error;
  } finally { globalThis.clearInterval(heartbeat); }
}
