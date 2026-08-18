/**
 * 资产页"插入画布"流程：选择/新建画布 → 导入媒体（图片迁移到 canvas/ 前缀）→
 * 合并节点到画布文档（revision 乐观锁；409 冲突提示重试）。
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, LayoutGrid, LoaderCircle, Plus, RefreshCw, X } from "lucide-react";
import { createCanvas, getCanvas, importCanvasMedia, listCanvases, saveCanvas } from "./canvas-api";
import type { CanvasMediaRef, CanvasProjectSummary } from "./canvas-types";
import { createMediaNode, documentCenter } from "./canvas-media";
import { relativeTime } from "./format";

type CanvasInsertPayload =
  | { kind: "video"; taskId: string; title: string }
  | { kind: "image"; uploadId: string; name: string }
  | { kind: "generated"; mediaId: string; title: string };

export function CanvasInsertPicker({ payload, onClose, navigate }: { payload: CanvasInsertPayload; onClose: () => void; navigate: (path: string) => void }) {
  const [canvases, setCanvases] = useState<CanvasProjectSummary[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ canvasId: string; canvasTitle: string } | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setNow(Date.now());
    void listCanvases(1, 100)
      .then((result) => setCanvases(result.Items))
      .catch((loadError) => setLoadError(loadError instanceof Error ? loadError.message : "画布列表载入失败"));
  }, []);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyId && !creating) onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [busyId, creating, onClose]);

  const createNew = async () => {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const created = await createCanvas("未命名画布");
      setCanvases((current) => [{ id: created.id, title: created.title, nodeCount: 0, updatedAt: Date.now() }, ...(current ?? [])]);
      await insertInto(created.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "新建画布失败");
    } finally {
      setCreating(false);
    }
  };

  const insertInto = useCallback(
    async (canvasId: string) => {
      setBusyId(canvasId);
      setError("");
      try {
        const mediaBody = payload.kind === "video" ? { kind: "generation" as const, taskId: payload.taskId } : payload.kind === "image" ? { kind: "upload" as const, uploadId: payload.uploadId } : { kind: "generated" as const, mediaId: payload.mediaId };
        const imported = await importCanvasMedia(canvasId, mediaBody);
        const project = await getCanvas(canvasId);
        if (!project.document) throw new Error("画布文档无法解析");
        const center = documentCenter(project.document);
        const node = createMediaNode(payload.kind === "video" ? "video" : "image", center, imported.mediaRef as CanvasMediaRef, {
          title: imported.title,
          width: imported.width,
          height: imported.height,
          durationMs: imported.durationMs,
        });
        const document = { ...project.document, nodes: [...project.document.nodes, node] };
        try {
          await saveCanvas(canvasId, project.revision, document);
        } catch (saveError) {
          const conflict = saveError as { status?: number };
          if (conflict.status === 409) {
            // 画布在其他窗口被修改：重载最新文档再试一次
            const latest = await getCanvas(canvasId);
            if (!latest.document) throw new Error("画布文档无法解析");
            await saveCanvas(canvasId, latest.revision, { ...latest.document, nodes: [...latest.document.nodes, node] });
          } else {
            throw saveError;
          }
        }
        setCanvases((current) => (current ?? []).map((canvas) => (canvas.id === canvasId ? { ...canvas, nodeCount: canvas.nodeCount + 1, updatedAt: Date.now() } : canvas)));
        const title = canvases?.find((canvas) => canvas.id === canvasId)?.title ?? "画布";
        setDone({ canvasId, canvasTitle: title });
      } catch (insertError) {
        setError(insertError instanceof Error ? insertError.message : "插入失败，请稍后重试");
        setDone(null);
      } finally {
        setBusyId(null);
      }
    },
    [canvases, payload],
  );

  return (
    <div className="canvas-insert-backdrop" onClick={() => !busyId && !creating && !done && onClose()}>
      <div className="canvas-insert canvas-insert--picker" role="dialog" aria-modal="true" aria-labelledby="canvas-picker-title" onClick={(event) => event.stopPropagation()}>
        {done ? (
          <div className="canvas-insert__done">
            <span className="canvas-insert__done-mark"><LayoutGrid /></span>
            <b>已插入「{done.canvasTitle}」</b>
            <p>媒体节点已添加到画布中心，可继续创作。</p>
            <div className="canvas-insert__done-actions">
              <button type="button" className="quiet" onClick={() => { setDone(null); setBusyId(null); }}>继续选择画布</button>
              <button type="button" className="primary" onClick={() => { onClose(); navigate("/studio/canvas/" + encodeURIComponent(done.canvasId)); }}>打开画布 <ArrowRight /></button>
            </div>
          </div>
        ) : (
          <>
            <header className="canvas-insert__head">
              <h2 id="canvas-picker-title">插入到哪张画布？</h2>
              <button type="button" aria-label="关闭" disabled={Boolean(busyId || creating)} onClick={onClose}><X /></button>
            </header>
            <p className="canvas-insert__hint">{payload.kind === "video" ? "「" + payload.title + "」将以视频节点插入" : payload.kind === "image" ? "「" + payload.name + "」将复制到长期存储后插入" : "「" + payload.title + "」将以图片节点插入"}</p>
            {error && <div className="canvas-insert__error" role="alert">{error}</div>}
            <div className="canvas-insert__body">
              {canvases === null ? (
                <div className="canvas-insert__state"><LoaderCircle className="spin" /> 正在载入画布列表</div>
              ) : loadError ? (
                <div className="canvas-insert__state"><b>画布列表载入失败</b><small>{loadError}</small></div>
              ) : !canvases.length ? (
                <div className="canvas-insert__empty"><LayoutGrid /><b>还没有画布</b><small>创建第一张画布来组织你的创作</small></div>
              ) : (
                <ul className="canvas-insert__list">
                  {canvases.map((canvas) => (
                    <li key={canvas.id}>
                      <button type="button" className="canvas-insert__item" disabled={busyId !== null} onClick={() => void insertInto(canvas.id)}>
                        <span className="canvas-insert__thumb"><LayoutGrid /></span>
                        <span className="canvas-insert__meta"><b>{canvas.title}</b><small>{canvas.nodeCount === 0 ? "空白画布" : canvas.nodeCount + " 个节点"} · 更新于 {relativeTime(canvas.updatedAt, now)}</small></span>
                        {busyId === canvas.id ? <LoaderCircle className="spin canvas-insert__spinner" /> : <i title="插入到这张画布">选择</i>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <footer className="canvas-insert__foot">
              <span>{payload.kind === "image" || payload.kind === "generated" ? "图片会复制到长期存储，原素材删除不影响画布" : "视频以成片引用插入，不占用额外存储"}</span>
              <button type="button" className="canvas-insert__refresh" disabled={creating || busyId !== null} onClick={() => void createNew()}>{creating ? <LoaderCircle className="spin" /> : <Plus />} 新建画布</button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
