/**
 * 画布内"插入素材"：从已归档成片（generation 引用）或图片资产（迁移到 canvas/ 前缀）添加节点。
 * 点击即插入到画布视口中心，选中新节点。
 */
import { useEffect, useMemo, useState } from "react";
import { Film, ImageIcon, LoaderCircle, RefreshCw, Search, X } from "lucide-react";
import { api } from "../../../api";
import { useAssetCacheUserId } from "../../../asset-cache-context";
import { assetMetadataCache, filterCachedAssets, loadAssetsCacheFirst } from "../../../asset-metadata-cache";
import type { LibraryAsset, Task } from "../../../types";
import { importCanvasMedia } from "../canvas-api";
import { createMediaNode } from "../canvas-media";
import { useCanvasStore } from "../canvas-store";
import type { CanvasNode } from "../canvas-types";
import { canvasCenter } from "../core/viewport";

type CanvasMediaInsertModalProps = {
  open: boolean;
  canvasId: string;
  onClose: () => void;
  onInserted: (node: CanvasNode) => void;
};

export function CanvasMediaInsertModal({ open, canvasId, onClose, onInserted }: CanvasMediaInsertModalProps) {
  const userId = useAssetCacheUserId();
  const [tab, setTab] = useState<"videos" | "images">("videos");
  const [videos, setVideos] = useState<Task[] | null>(null);
  const [images, setImages] = useState<LibraryAsset[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [importing, setImporting] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setError("");
    setImporting(null);
    setQuery("");
    setTab("videos");
    setVideos(null);
    setImages(null);
    void api
      .get<Task[]>("/api/generations")
      .then((tasks) => setVideos(tasks.filter((task) => task.status === "succeeded" && task.mediaStatus === "ready" && task.videoUrl)))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "视频资产载入失败"));
    void loadAssetsCacheFirst({
      userId,
      loadFresh: () => api.get<{ Items?: LibraryAsset[] }>("/api/assets?type=Image&page=1&pageSize=60").then((result) => result.Items ?? []),
      selectCached: (assets) => filterCachedAssets(assets, { type: "Image" }).slice(0, 60),
      onCached: (assets) => { if (active) setImages(assets); },
    })
      .then((result) => { if (active) setImages(result.assets); })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "图片资产载入失败"); });
    return () => { active = false; };
  }, [open, userId]);

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !importing) onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open, importing, onClose]);

  const filteredVideos = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (videos ?? []).filter((task) => !needle || (task.prompt || "").toLocaleLowerCase().includes(needle));
  }, [videos, query]);

  const filteredImages = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (images ?? []).filter((asset) => !needle || (asset.Name || "").toLocaleLowerCase().includes(needle));
  }, [images, query]);

  const insert = async (kind: "video" | "image", payload: { taskId: string; title: string } | { uploadId: string; name: string }) => {
    const key = "taskId" in payload ? payload.taskId : payload.uploadId;
    setImporting(key);
    setError("");
    try {
      const state = useCanvasStore.getState();
      const center = canvasCenter(state.document.viewport, state.viewportSize);
      const imported = await importCanvasMedia(canvasId, "taskId" in payload ? { kind: "generation", taskId: payload.taskId } : { kind: "upload", uploadId: payload.uploadId });
      const node = createMediaNode(kind, center, imported.mediaRef, { title: imported.title, width: imported.width, height: imported.height, durationMs: imported.durationMs });
      onInserted(node);
      onClose();
    } catch (insertError) {
      setError(insertError instanceof Error ? insertError.message : "插入失败，请稍后重试");
    } finally {
      setImporting(null);
    }
  };

  if (!open) return null;

  return (
    <div className="canvas-insert-backdrop" onClick={() => !importing && onClose()}>
      <div className="canvas-insert" role="dialog" aria-modal="true" aria-labelledby="canvas-insert-title" onClick={(event) => event.stopPropagation()}>
        <header className="canvas-insert__head">
          <h2 id="canvas-insert-title">插入素材</h2>
          <button type="button" aria-label="关闭" disabled={Boolean(importing)} onClick={onClose}><X /></button>
        </header>
        <nav className="canvas-insert__tabs" aria-label="素材类型">
          <button type="button" className={tab === "videos" ? "active" : ""} onClick={() => setTab("videos")}><Film /> 视频成片</button>
          <button type="button" className={tab === "images" ? "active" : ""} onClick={() => setTab("images")}><ImageIcon /> 图片资产</button>
        </nav>
        <label className="canvas-insert__search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={"搜索" + (tab === "videos" ? "视频" : "图片")} aria-label="搜索素材" /></label>
        {error && <div className="canvas-insert__error" role="alert">{error}</div>}
        <div className="canvas-insert__body">
          {tab === "videos" ? (
            videos === null ? (
              <div className="canvas-insert__state"><LoaderCircle className="spin" /> 正在载入视频资产</div>
            ) : !filteredVideos.length ? (
              <div className="canvas-insert__empty"><Film /><b>{query ? "没有匹配的视频" : "还没有归档成片"}</b><small>{query ? "换一个关键词试试" : "先完成一次视频生成，成片会出现在这里"}</small></div>
            ) : (
              <ul className="canvas-insert__list">
                {filteredVideos.map((task) => (
                  <li key={task.id}>
                    <button type="button" className="canvas-insert__item" disabled={importing !== null} onClick={() => void insert("video", { taskId: task.id, title: task.prompt || "参考素材生成" })}>
                      {task.posterUrl ? <img src={task.posterUrl} alt="" loading="lazy" decoding="async" /> : <span className="canvas-insert__thumb"><Film /></span>}
                      <span className="canvas-insert__meta"><b>{task.prompt || "参考素材生成"}</b><small>{task.ratio} · {task.duration}s</small></span>
                      {importing === task.id ? <LoaderCircle className="spin canvas-insert__spinner" /> : <i title="插入画布">插入</i>}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : images === null ? (
            <div className="canvas-insert__state"><LoaderCircle className="spin" /> 正在载入图片资产</div>
          ) : !filteredImages.length ? (
            <div className="canvas-insert__empty"><ImageIcon /><b>{query ? "没有匹配的图片" : "还没有图片资产"}</b><small>{query ? "换一个关键词试试" : "上传的图片会长期保存在画布中"}</small></div>
          ) : (
            <ul className="canvas-insert__list canvas-insert__list--grid">
              {filteredImages.map((asset) => (
                <li key={asset.Id}>
                  <button type="button" className="canvas-insert__item" disabled={importing !== null || !asset.UploadId || asset.Status !== "Active"} title={!asset.UploadId ? "外部链接素材暂不支持插入画布" : asset.Status !== "Active" ? "素材仍在处理中" : "插入画布"} onClick={() => void insert("image", { uploadId: asset.UploadId!, name: asset.Name || "图片" })}>
                    {asset.URL ? <img src={asset.URL} alt="" loading="lazy" decoding="async" /> : <span className="canvas-insert__thumb"><ImageIcon /></span>}
                    <span className="canvas-insert__meta"><b>{asset.Name || "未命名图片"}</b><small>{asset.Status !== "Active" ? (asset.Status === "Processing" ? "处理中" : "处理失败") : "长期保存"}</small></span>
                    {importing === asset.UploadId ? <LoaderCircle className="spin canvas-insert__spinner" /> : <i title="插入画布">插入</i>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="canvas-insert__foot"><span>图片插入时会复制到长期存储，素材删除不影响画布</span><button type="button" className="canvas-insert__refresh" onClick={() => { setVideos(null); setImages(null); void api.get<Task[]>("/api/generations").then((tasks) => setVideos(tasks.filter((t) => t.status === "succeeded" && t.mediaStatus === "ready" && t.videoUrl))).catch(() => undefined); void api.get<{ Items?: LibraryAsset[] }>("/api/assets?type=Image&page=1&pageSize=60").then((result) => { const assets = result.Items ?? []; setImages(assets); void assetMetadataCache.merge(userId, assets); }).catch(() => undefined); }}><RefreshCw /> 刷新</button></footer>
      </div>
    </div>
  );
}
