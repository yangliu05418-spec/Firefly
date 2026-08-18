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

const request = async <T>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, { credentials: "same-origin", ...options, headers: { ...(options?.body instanceof Blob ? {} : { "Content-Type": "application/json" }), ...options?.headers } });
  if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string; requestId?: string }; if (response.status === 401) notifySignedOut(); const requestId = body.requestId ?? response.headers.get("x-request-id"); throw new Error(`${body.error ?? `请求失败 (${response.status})`}${requestId ? ` · 请求编号 ${requestId.slice(0, 8)}` : ""}`); }
  return response.status === 204 ? undefined as T : response.json();
};
export const api = { get: <T>(url: string) => request<T>(url), post: <T>(url: string, body?: unknown) => request<T>(url, { method: "POST", body: body instanceof Blob ? body : JSON.stringify(body ?? {}) }), patch: <T>(url: string, body: unknown) => request<T>(url, { method: "PATCH", body: JSON.stringify(body) }), delete: <T>(url: string) => request<T>(url, { method: "DELETE" }) };

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

async function uploadChunk(uploadId: string, file: File, offset: number, chunkSize: number) {
  const chunk = file.slice(offset, Math.min(file.size, offset + chunkSize));
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await wait([1000, 2000, 4000][attempt - 1]);
    let response: Response;
    try {
      response = await fetch(`/api/uploads/${uploadId}/chunks`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/octet-stream", "X-Upload-Offset": String(offset) }, body: chunk });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("素材上传失败");
      if (attempt === 3) throw lastError;
      continue;
    }
    if (response.ok) return offset + chunk.size;
    const body = await response.json().catch(() => ({})) as { error?: string; expectedOffset?: number };
    if (response.status === 409 && typeof body.expectedOffset === "number" && body.expectedOffset > offset) return body.expectedOffset;
    lastError = new Error(body.error ?? "素材上传失败");
    if (response.status < 500 && response.status !== 429) throw lastError;
    if (attempt === 3) throw lastError;
  }
  throw lastError ?? new Error("素材上传失败");
}

type SignedPart = { partNumber: number; url: string };

async function uploadTosPart(uploadId: string, initial: SignedPart, blob: Blob) {
  let signed = initial;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await wait([1000, 2000, 4000][attempt - 1]);
    let response: Response;
    try { response = await fetch(signed.url, { method: "PUT", body: blob }); }
    catch (error) { lastError = error instanceof Error ? error : new Error("TOS 分片上传失败"); if (attempt === 3) throw lastError; continue; }
    if (response.ok) {
      const eTag = response.headers.get("etag");
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

export async function uploadFile(file: File, type: "image" | "video" | "audio", onProgress: (value: number) => void) {
  const init = await api.post<{ id: string; chunkSize: number; direct?: boolean; concurrency?: number; parts?: SignedPart[] }>("/api/uploads", { name: file.name, size: file.size, type, mime: file.type });
  if (init.direct) {
    const parts = init.parts ?? [];
    const results: { partNumber: number; eTag: string }[] = [];
    let cursor = 0; let completedBytes = 0;
    const worker = async () => {
      while (cursor < parts.length) {
        const part = parts[cursor++];
        const start = (part.partNumber - 1) * init.chunkSize;
        const blob = file.slice(start, Math.min(file.size, start + init.chunkSize));
        results.push(await uploadTosPart(init.id, part, blob));
        completedBytes += blob.size;
        onProgress(Math.min(100, Math.round(completedBytes / file.size * 100)));
      }
    };
    await Promise.all(Array.from({ length: Math.min(init.concurrency ?? 3, parts.length) }, worker));
    return api.post<{ id: string; uploadId: string; name: string; type: "image" | "video" | "audio"; size: number }>(`/api/uploads/${init.id}/complete`, { parts: results.sort((a, b) => a.partNumber - b.partNumber) });
  }
  let offset = 0;
  while (offset < file.size) {
    offset = await uploadChunk(init.id, file, offset, init.chunkSize);
    onProgress(Math.round(offset / file.size * 100));
  }
  return api.post<{ id: string; uploadId?: string; name: string; type: "image" | "video" | "audio"; size: number; url?: string }>(`/api/uploads/${init.id}/complete`);
}
