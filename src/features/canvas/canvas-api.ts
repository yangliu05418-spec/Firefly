import { api, ApiError, notifySignedOut } from "../../api";
import type { LocalMediaDescriptor } from "../../types";
import type { CanvasDocument, CanvasListResult, CanvasMediaRef, CanvasProjectDetail } from "./canvas-types";
import type { AnyCanvasDocument, CanvasDocumentV2 } from "./canvas-v2-types";

const encode = (id: string) => encodeURIComponent(id);

export const listCanvases = (page = 1, pageSize = 50): Promise<CanvasListResult> =>
  api.get<CanvasListResult>("/api/canvases?page=" + page + "&pageSize=" + pageSize);

export const createCanvas = (title: string): Promise<{ id: string; title: string }> =>
  api.post<{ id: string; title: string }>("/api/canvases", { title });

export const getCanvas = (id: string): Promise<CanvasProjectDetail> =>
  api.get<CanvasProjectDetail>("/api/canvases/" + encode(id));

export const renameCanvas = (id: string, title: string): Promise<{ id: string; title: string }> =>
  api.patch<{ id: string; title: string }>("/api/canvases/" + encode(id), { title });

export const deleteCanvas = (id: string): Promise<void> =>
  api.delete<void>("/api/canvases/" + encode(id));

export type CanvasMediaImportResult = {
  mediaRef: CanvasMediaRef;
  title: string;
  fileName: string;
  width?: number;
  height?: number;
  durationMs?: number;
  status?: "copying" | "ready";
};

/** 导入媒体到画布（generation 引用或上传对象迁移到 canvas/ 前缀） */
export const importCanvasMedia = (canvasId: string, body: { kind: "generation"; taskId: string } | { kind: "upload"; uploadId: string } | { kind: "generated"; mediaId: string }): Promise<CanvasMediaImportResult> =>
  api.post<CanvasMediaImportResult>("/api/canvases/" + encode(canvasId) + "/media", body);

export type CanvasSaveError = Error & { status: number; currentRevision?: number };

/** 保存画布文档（revision 乐观锁）。409 冲突时抛出携带 currentRevision 的 CanvasSaveError。 */
export const saveCanvas = async (id: string, revision: number, document: CanvasDocument): Promise<CanvasProjectDetail> => {
  const response = await fetch("/api/canvases/" + encode(id), {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision, document }),
  });
  if (response.status === 409) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; currentRevision?: number };
    const error = new Error(body.error ?? "画布已在其他窗口被修改") as CanvasSaveError;
    error.status = 409;
    error.currentRevision = body.currentRevision;
    throw error;
  }
  if (response.status === 401) {
    notifySignedOut();
    throw new Error("登录已过期，请重新登录");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "保存失败 (" + response.status + ")");
  }
  return response.json();
};

export type CanvasV2ProjectDetail = Omit<CanvasProjectDetail, "document"> & { document: AnyCanvasDocument | null };
export type CanvasLease = { acquired: true; token: string; ttlMs: number } | { acquired: false; holder?: { clientId: string; acquiredAt: number }; ttlMs: number };
export type CanvasProjectAsset = {
  id: string; canvasId: string; kind: "image" | "video" | "audio"; title: string; contentType: string; size: number;
  width?: number; height?: number; durationMs?: number; status: "copying" | "ready" | "failed"; createdAt: number; updatedAt: number;
  mediaUrl: string; thumbnailUrl?: string; downloadUrl: string;
  localMedia?: { preview?: LocalMediaDescriptor; thumbnail?: LocalMediaDescriptor };
};
export type CanvasJob = {
  id: string; canvasId: string; nodeId: string; kind: "text" | "image" | "video" | "character_tool";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; resultAssetId?: string; providerTaskId?: string;
  partialText: string; error?: string; createdAt: number; updatedAt: number;
};

export const canvasV2Config = () => api.get<{ enabled: boolean }>("/api/canvas/config");
export const getCanvasV2 = (id: string) => api.get<CanvasV2ProjectDetail>(`/api/canvases/${encode(id)}`);
export const acquireCanvasLease = async (id: string, clientId: string, takeover = false): Promise<CanvasLease> => {
  const response = await fetch(`/api/canvases/${encode(id)}/lease`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, takeover }) });
  const body = await response.json().catch(() => ({})) as CanvasLease & { error?: string; code?: string; requestId?: string };
  if (response.status === 401) notifySignedOut();
  // A held lease is an expected read-only state, not an API failure. Returning
  // the 409 body lets a second window load the canvas without losing its draft.
  if (response.ok || (response.status === 409 && "acquired" in body)) return body;
  throw new ApiError(body.error ?? `编辑状态确认失败 (${response.status})`, response.status, body.code, body.requestId);
};
export const renewCanvasLease = async (id: string, clientId: string, token: string) => {
  const response = await fetch(`/api/canvases/${encode(id)}/lease`, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, token }) });
  if (response.status === 401) notifySignedOut();
  return response;
};
export const releaseCanvasLease = (id: string, clientId: string, token: string) => fetch(`/api/canvases/${encode(id)}/lease`, { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, token }), keepalive: true });

export const saveCanvasV2 = async (id: string, revision: number, document: CanvasDocumentV2, leaseToken: string): Promise<CanvasV2ProjectDetail> => {
  const response = await fetch(`/api/canvases/${encode(id)}`, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Canvas-Lease": leaseToken }, body: JSON.stringify({ revision, document }) });
  if (response.status === 401) { notifySignedOut(); throw new Error("登录已过期，请重新登录"); }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; currentRevision?: number; code?: string };
    const error = new Error(body.error ?? `保存失败 (${response.status})`) as CanvasSaveError & { code?: string };
    error.status = response.status; error.currentRevision = body.currentRevision; error.code = body.code;
    throw error;
  }
  return response.json();
};

export const listCanvasAssets = async (canvasId: string) => {
  const Items: CanvasProjectAsset[] = [];
  const seen = new Set<string>();
  let before: number | undefined;
  let beforeId: string | undefined;
  let HasMore = true;
  // Bound the browser work while allowing substantially larger projects than one API page.
  for (let pageNumber = 0; HasMore && pageNumber < 50; pageNumber += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (before !== undefined) query.set("before", String(before));
    if (beforeId) query.set("beforeId", beforeId);
    const page = await api.get<{ Items: CanvasProjectAsset[]; HasMore: boolean; NextBefore?: number; NextBeforeId?: string }>(`/api/canvases/${encode(canvasId)}/assets?${query}`);
    for (const asset of page.Items) if (!seen.has(asset.id)) { seen.add(asset.id); Items.push(asset); }
    HasMore = page.HasMore;
    if (!HasMore) break;
    if (page.NextBefore === undefined || !page.NextBeforeId) break;
    before = page.NextBefore; beforeId = page.NextBeforeId;
  }
  return { Items, HasMore };
};
export const importCanvasProjectAsset = (canvasId: string, body: { kind: "generation"; taskId: string } | { kind: "upload"; uploadId: string } | { kind: "generated"; mediaId: string } | { kind: "user_asset"; assetId: string }) => api.post<CanvasMediaImportResult & { projectAsset: CanvasProjectAsset }>(`/api/canvases/${encode(canvasId)}/media`, body);
export const listCanvasJobs = (canvasId: string, updatedAfter = 0) => api.get<{ Items: CanvasJob[] }>(`/api/canvases/${encode(canvasId)}/jobs?updatedAfter=${updatedAfter}`);
export const createCanvasJob = (canvasId: string, body: unknown) => api.post<CanvasJob>(`/api/canvases/${encode(canvasId)}/jobs`, body);
export const cancelCanvasJob = (canvasId: string, jobId: string) => api.post<CanvasJob>(`/api/canvases/${encode(canvasId)}/jobs/${encode(jobId)}/cancel`, {});

export type MontageClip = { id: string; projectAssetId: string; startMs: number; durationMs: number; trimStartMs: number; trimEndMs: number; muted?: boolean };
export type MontageTimeline = { video: MontageClip[]; audio: Omit<MontageClip, "muted">[]; settings: { width: number; height: number; fps: number } };
export type CanvasMontage = { id: string; canvasId: string; revision: number; timeline: MontageTimeline; createdAt: number; updatedAt: number };
export const createCanvasMontage = (canvasId: string, timeline: MontageTimeline) => api.post<CanvasMontage>(`/api/canvases/${encode(canvasId)}/montages`, { timeline });
export const updateCanvasMontage = (canvasId: string, montageId: string, revision: number, timeline: MontageTimeline) => fetch(`/api/canvases/${encode(canvasId)}/montages/${encode(montageId)}`, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision, timeline }) }).then(async (response) => { if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error ?? "Montage 保存失败"); return response.json() as Promise<CanvasMontage>; });
export const createCanvasExport = (canvasId: string, montageId: string, fileSize = 1) => api.post<{ id: string; partSize: number; parts: { partNumber: number; url: string }[] }>(`/api/canvases/${encode(canvasId)}/montages/${encode(montageId)}/exports`, { fileSize });
export const signCanvasExportParts = (canvasId: string, exportId: string, partNumbers: number[]) => api.post<{ parts: { partNumber: number; url: string }[] }>(`/api/canvases/${encode(canvasId)}/exports/${encode(exportId)}/parts/sign`, { partNumbers });
export const completeCanvasExport = (canvasId: string, exportId: string, parts: { partNumber: number; etag: string }[]) => api.post<{ id: string; status: string; projectAsset: CanvasProjectAsset }>(`/api/canvases/${encode(canvasId)}/exports/${encode(exportId)}/complete`, { parts });
export const cancelCanvasExport = (canvasId: string, exportId: string) => api.delete<void>(`/api/canvases/${encode(canvasId)}/exports/${encode(exportId)}`);
