import { api, notifySignedOut } from "../../api";
import type { CanvasDocument, CanvasListResult, CanvasMediaRef, CanvasProjectDetail } from "./canvas-types";

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
