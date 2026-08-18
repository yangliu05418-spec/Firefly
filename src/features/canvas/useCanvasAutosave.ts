/**
 * 画布自动保存（M5）：文档变更 800ms debounce 全量 PUT；
 * visibilitychange(hidden)/beforeunload/离开路由 强制 flush；保存状态指示；
 * 409 冲突 → 载入服务端最新版本并通知交互层重置历史。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getCanvas, saveCanvas, type CanvasSaveError } from "./canvas-api";
import { useCanvasStore } from "./canvas-store";
import type { CanvasDocument } from "./canvas-types";

export type CanvasSaveStatus = { status: "saved" | "saving" | "error" | "conflict"; message?: string };

const SAVE_DEBOUNCE_MS = 800;

export function useCanvasAutosave({ canvasId, revision, initialDocument, onConflictReload }: {
  canvasId: string;
  revision: number;
  initialDocument: CanvasDocument | null;
  onConflictReload: () => void;
}) {
  const [saveState, setSaveState] = useState<CanvasSaveStatus>({ status: "saved" });
  const revisionRef = useRef(revision);
  const lastSavedRef = useRef<string>("");
  const initializedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const dirtyRef = useRef(false);
  const canvasDocument = useCanvasStore((state) => state.document);

  // 载入后标记基线快照，避免打开即保存
  useEffect(() => {
    if (!initialDocument || initializedRef.current) return;
    initializedRef.current = true;
    revisionRef.current = revision;
    lastSavedRef.current = JSON.stringify(initialDocument);
    dirtyRef.current = false;
  }, [initialDocument, revision]);

  const flush = useCallback(
    async (reason: string) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (!initializedRef.current) return;
      const state = useCanvasStore.getState();
      const snapshot = JSON.stringify(state.document);
      if (snapshot === lastSavedRef.current) {
        dirtyRef.current = false;
        return;
      }
      if (savingRef.current) {
        pendingRef.current = true;
        return;
      }
      savingRef.current = true;
      dirtyRef.current = false;
      setSaveState({ status: "saving" });
      try {
        const result = await saveCanvas(canvasId, revisionRef.current, state.document);
        revisionRef.current = result.revision;
        lastSavedRef.current = snapshot;
        setSaveState({ status: "saved" });
        console.info(JSON.stringify({ type: "canvas_autosave", at: new Date().toISOString(), canvasId, reason, revision: result.revision }));
      } catch (error) {
        const saveError = error as CanvasSaveError;
        if (saveError.status === 409) {
          setSaveState({ status: "conflict", message: "画布已在其他窗口被修改，正在载入最新版本…" });
          try {
            const project = await getCanvas(canvasId);
            if (!project.document) throw new Error("画布文档无法解析");
            useCanvasStore.getState().hydrate(project.document);
            revisionRef.current = project.revision;
            lastSavedRef.current = JSON.stringify(project.document);
            dirtyRef.current = false;
            onConflictReload();
            setSaveState({ status: "saved", message: "已载入其他窗口的最新版本" });
          } catch {
            setSaveState({ status: "error", message: "载入最新版本失败，请刷新页面" });
          }
        } else {
          dirtyRef.current = true;
          setSaveState({ status: "error", message: error instanceof Error ? error.message : "保存失败" });
        }
      } finally {
        savingRef.current = false;
        if (pendingRef.current) {
          pendingRef.current = false;
          void flush(reason);
        }
      }
    },
    [canvasId, onConflictReload],
  );

  // 文档变更 → 防抖保存
  useEffect(() => {
    if (!initializedRef.current) return;
    dirtyRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush("debounce"), SAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [canvasDocument, flush]);

  // 页面隐藏 / 卸载 / 网络恢复 → 立即保存
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) void flush("visibility");
    };
    const handleUnload = () => void flush("unload");
    const handleOnline = () => {
      if (dirtyRef.current && navigator.onLine) void flush("online");
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("online", handleOnline);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("online", handleOnline);
      void flush("unmount");
    };
  }, [flush]);

  const retry = useCallback(() => void flush("retry"), [flush]);

  return { saveState, retry };
}
