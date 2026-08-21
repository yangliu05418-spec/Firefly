import { api, ApiError } from "./api";
import type { LibraryAsset, UploadAsset } from "./types";

type UploadState = { id: string; uploadId?: string; name: string; type: UploadAsset["type"]; size: number; state: "processing" | "ready" };

export type ComposerDraftRecoveryDeps = {
  getUpload(id: string): Promise<UploadState>;
  getAsset(id: string): Promise<LibraryAsset>;
  wait(ms: number, signal?: AbortSignal): Promise<void>;
  now(): number;
};

const defaultWait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new DOMException("已取消恢复", "AbortError"));
  const timer = globalThis.setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { globalThis.clearTimeout(timer); reject(new DOMException("已取消恢复", "AbortError")); }, { once: true });
});

const defaultDeps: ComposerDraftRecoveryDeps = {
  getUpload: (id) => api.get<UploadState>(`/api/uploads/${encodeURIComponent(id)}`),
  getAsset: (id) => api.get<LibraryAsset>(`/api/assets/${encodeURIComponent(id)}`),
  wait: defaultWait,
  now: () => Date.now(),
};

const terminalMissing = (error: unknown) => error instanceof ApiError && [404, 410, 422].includes(error.status);

/** Refreshes short-lived media state without ever persisting a signed URL. */
export const recoverComposerDraftAsset = async (
  cached: UploadAsset,
  signal?: AbortSignal,
  deps: ComposerDraftRecoveryDeps = defaultDeps,
): Promise<UploadAsset | null> => {
  const deadline = deps.now() + 240_000;
  let delay = 1_000;
  while (deps.now() < deadline) {
    if (signal?.aborted) throw new DOMException("已取消恢复", "AbortError");
    try {
      if (cached.assetId) {
        const asset = await deps.getAsset(cached.assetId);
        if (asset.Status === "Failed") return null;
        if (asset.Status === "Active") return {
          ...cached,
          id: asset.Id,
          assetId: asset.Id,
          uploadId: asset.UploadId ?? cached.uploadId,
          name: asset.Name || cached.name,
          type: asset.AssetType.toLowerCase() as UploadAsset["type"],
          progress: 100,
          phase: "ready",
          status: "Active",
          preview: asset.URL,
        };
      } else if (cached.uploadId) {
        const upload = await deps.getUpload(cached.uploadId);
        if (upload.state === "ready") return {
          ...cached,
          id: cached.id,
          uploadId: upload.uploadId ?? upload.id,
          name: upload.name || cached.name,
          type: upload.type,
          size: upload.size,
          progress: 100,
          phase: "ready",
        };
      } else return null;
      delay = 1_500;
    } catch (error) {
      if (terminalMissing(error)) return null;
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      delay = Math.min(8_000, delay * 2);
    }
    await deps.wait(Math.min(delay, Math.max(0, deadline - deps.now())), signal);
  }
  return null;
};
