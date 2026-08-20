import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Check, CheckSquare2, Copy, Download, Film, ImageIcon, LayoutGrid, LoaderCircle, Pencil, Play, Plus, RefreshCw, Search, Square, Trash2, Upload, X } from "lucide-react";
import { api, uploadFile } from "../../api";
import type { LibraryAsset, LibraryGroup, ModelCapability, Task } from "../../types";
import { CaseIdButton, reportMediaEvent, type MediaState } from "./TaskCard";

type AssetCreateResponse = LibraryAsset | { Pending: true; UploadId: string; Status: "Processing"; Message: string };
const assetRegistrationPending = (result: AssetCreateResponse): result is Extract<AssetCreateResponse, { Pending: true }> => "Pending" in result && result.Pending;

function AssetPreview({ task, close, onDelete, initialTime, onPosition }: { task: Task; close: () => void; onDelete: (task: Task) => void; initialTime: number; onPosition: (time: number) => void }) {
  const [state, setState] = useState<MediaState>("loading"); const [retryCount, setRetryCount] = useState(0); const [downloadNotice, setDownloadNotice] = useState("");
  const startedAt = useRef(Date.now()); const readyOnce = useRef(false); const bufferingStartedAt = useRef<number | null>(null); const resumeTime = useRef(initialTime); const retryTimer = useRef<number | null>(null); const dialogRef = useRef<HTMLDivElement>(null); const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => () => { if (retryTimer.current !== null) window.clearTimeout(retryTimer.current); }, []);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("[data-modal-initial]")?.focus());
    return () => { document.body.style.overflow = previousOverflow; opener?.focus(); };
  }, []);
  useEffect(() => () => {
    const time = videoRef.current?.currentTime;
    if (typeof time === "number" && Number.isFinite(time)) onPosition(Math.max(0, time));
  }, []);
  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],video[controls],[tabindex]:not([tabindex="-1"])') ?? [])].filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const retry = () => { if (retryTimer.current !== null) window.clearTimeout(retryTimer.current); setState("loading"); setRetryCount((count) => count + 1); };
  useEffect(() => { const reconnect = () => { if (state === "error") retry(); }; window.addEventListener("online", reconnect); return () => window.removeEventListener("online", reconnect); }, [state]);
  const failed = (video: HTMLVideoElement) => {
    reportMediaEvent(task.id, "error", startedAt.current, video);
    if (readyOnce.current && Number.isFinite(video.currentTime)) resumeTime.current = Math.max(0, video.currentTime);
    if (!readyOnce.current && retryCount < 2 && navigator.onLine) {
      setState("loading"); retryTimer.current = window.setTimeout(() => setRetryCount((count) => count + 1), [2000, 6000][retryCount]); return;
    }
    setState("error");
  };
  return <div className="asset-preview-backdrop" role="dialog" aria-modal="true" aria-labelledby="asset-preview-title" onClick={close}>
    <div ref={dialogRef} className="asset-preview" onKeyDown={handleDialogKeyDown} onClick={(event) => event.stopPropagation()}>
      <header><div><span>视频预览</span><h2 id="asset-preview-title">{task.prompt || "参考素材生成"}</h2></div><button data-modal-initial aria-label="关闭预览" onClick={close}><X /></button></header>
      <div className="asset-preview__stage">
        <video ref={videoRef} key={`${task.id}-${task.mediaRevision ?? 0}-${retryCount}`} src={task.videoUrl} poster={task.posterUrl} controls playsInline preload="auto" onLoadedMetadata={(event) => { const video = event.currentTarget; if (resumeTime.current > 0 && Number.isFinite(video.duration) && resumeTime.current < video.duration - 1) video.currentTime = Math.min(resumeTime.current, Math.max(0, video.duration - 0.1)); reportMediaEvent(task.id, "metadata", startedAt.current, video); }} onTimeUpdate={(event) => { const time = event.currentTarget.currentTime; if (Number.isFinite(time)) onPosition(Math.max(0, time)); }} onEnded={() => onPosition(0)} onCanPlay={(event) => { const firstCanPlay = !readyOnce.current; readyOnce.current = true; setState("ready"); if (firstCanPlay) reportMediaEvent(task.id, "canplay", startedAt.current, event.currentTarget); }} onPlaying={(event) => { const bufferingMs = bufferingStartedAt.current === null ? undefined : Math.min(3600 * 1000, Date.now() - bufferingStartedAt.current); bufferingStartedAt.current = null; setState("ready"); reportMediaEvent(task.id, "playing", startedAt.current, event.currentTarget, bufferingMs); }} onWaiting={(event) => { const video = event.currentTarget; if (!readyOnce.current || (video.paused && !video.seeking) || bufferingStartedAt.current !== null) return; bufferingStartedAt.current = Date.now(); setState("buffering"); reportMediaEvent(task.id, "waiting", startedAt.current, video); }} onStalled={(event) => { const video = event.currentTarget; if (!readyOnce.current || (video.paused && !video.seeking) || bufferingStartedAt.current !== null) return; bufferingStartedAt.current = Date.now(); setState("buffering"); reportMediaEvent(task.id, "stalled", startedAt.current, video); }} onError={(event) => failed(event.currentTarget)} />
        {state !== "ready" && <div className={`asset-preview__status asset-preview__status--${state}`} aria-live="polite"><div className="film-window"><Film /><span /><i /></div><b>{state === "error" ? navigator.onLine ? "预览连接失败" : "网络连接已断开" : state === "buffering" ? "正在继续缓冲" : "正在载入成片"}</b><small>{state === "error" ? navigator.onLine ? "播放位置已保留，可重新加载" : "网络恢复后将自动重新连接" : "正在从北京媒体存储准备画面"}</small>{state === "error" && navigator.onLine && <button onClick={retry}><RefreshCw /> 重新加载</button>}</div>}
      </div>
      <footer><span>{downloadNotice || `${new Date(task.createdAt).toLocaleString("zh-CN")} · ${task.resolution} · ${task.ratio}`}</span><div><CaseIdButton task={task} /><button onClick={() => { close(); onDelete(task); }}><Trash2 /> 删除</button><a href={task.downloadUrl ?? task.videoUrl} target="_blank" rel="noreferrer" onClick={() => { setDownloadNotice("已交给浏览器下载器，可在下载列表中继续"); reportMediaEvent(task.id, "download_click", startedAt.current); }}><Download /> 下载视频</a></div></footer>
    </div>
  </div>;
}

function ImageAssetManager({ onInsertCanvas }: { onInsertCanvas: (asset: LibraryAsset) => void }) {
  const [assets, setAssets] = useState<LibraryAsset[]>([]); const [group, setGroup] = useState<LibraryGroup | null>(null); const [query, setQuery] = useState(""); const [page, setPage] = useState(1); const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true); const [loadingMore, setLoadingMore] = useState(false); const [uploading, setUploading] = useState(false); const [progress, setProgress] = useState<{ done: number; total: number } | null>(null); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [pendingRegistrations, setPendingRegistrations] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set()); const [editingId, setEditingId] = useState<string | null>(null); const [draftName, setDraftName] = useState(""); const [confirmDelete, setConfirmDelete] = useState(false); const [deleting, setDeleting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null); const requestSequence = useRef(0); const renaming = useRef(new Set<string>()); const cancelRename = useRef(false);
  const loadPage = async (requestedPage: number, replace: boolean, search = query) => {
    const sequence = ++requestSequence.current; replace ? setLoading(true) : setLoadingMore(true); setError("");
    try {
      const result = await api.get<{ Items?: LibraryAsset[]; HasMore?: boolean }>(`/api/assets?type=Image&page=${requestedPage}&pageSize=60&q=${encodeURIComponent(search.trim())}`);
      if (sequence !== requestSequence.current) return;
      setAssets((current) => replace ? (result.Items ?? []) : [...current, ...(result.Items ?? []).filter((asset) => !current.some((item) => item.Id === asset.Id))]);
      setPage(requestedPage); setHasMore(Boolean(result.HasMore));
      if (replace) setSelected(new Set());
    } catch (loadError) { if (sequence === requestSequence.current) setError(loadError instanceof Error ? loadError.message : "图片资产载入失败"); }
    finally { if (sequence === requestSequence.current) { setLoading(false); setLoadingMore(false); } }
  };
  useEffect(() => { void api.get<{ Items?: LibraryGroup[] }>("/api/assets/groups").then((result) => setGroup(result.Items?.[0] ?? null)).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "素材空间暂时不可用")); }, []);
  useEffect(() => { const timer = window.setTimeout(() => void loadPage(1, true, query), query ? 260 : 0); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => {
    if (!pendingRegistrations) return;
    const timers = [5_000, 15_000, 30_000].map((delay) => window.setTimeout(() => void loadPage(1, true, query), delay));
    return () => timers.forEach(window.clearTimeout);
  }, [pendingRegistrations]);
  useEffect(() => {
    const processing = assets.filter((asset) => asset.Status === "Processing");
    if (!processing.length) return;
    const refresh = () => void Promise.all(processing.map((asset) => api.get<LibraryAsset>(`/api/assets/${asset.Id}`).catch(() => asset))).then((updates) => setAssets((current) => current.map((asset) => updates.find((update) => update.Id === asset.Id) ?? asset)));
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [assets.map((asset) => `${asset.Id}:${asset.Status}`).join("|")]);
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const allSelected = assets.length > 0 && assets.every((asset) => selected.has(asset.Id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(assets.map((asset) => asset.Id)));
  const uploadImages = async (files?: FileList | null) => {
    const images = Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
    if (!images.length || !group) return;
    if (images.length > 50) { setError("单次最多上传 50 张图片"); if (fileInput.current) fileInput.current.value = ""; return; }
    setUploading(true); setProgress({ done: 0, total: images.length }); setError(""); setNotice(""); const created: LibraryAsset[] = []; const failures: string[] = []; let cursor = 0;
    let pending = 0;
    const next = async () => { while (cursor < images.length) { const file = images[cursor++]; if (!file) continue; try { const uploaded = await uploadFile(file, "image", () => undefined); const asset = await api.post<AssetCreateResponse>("/api/assets", { groupId: group.Id, uploadId: uploaded.uploadId ?? uploaded.id, type: "Image", name: file.name }); if (assetRegistrationPending(asset)) pending += 1; else created.push(asset); } catch (uploadError) { failures.push(`${file.name}（${uploadError instanceof Error ? uploadError.message.split(" · ")[0].slice(0, 60) : "上传失败"}）`); } finally { setProgress((current) => current ? { ...current, done: current.done + 1 } : current); } } };
    try {
      await Promise.all(Array.from({ length: Math.min(3, images.length) }, next));
      if (created.length) setAssets((current) => [...created.reverse(), ...current.filter((asset) => !created.some((item) => item.Id === asset.Id))]);
      if (pending) setPendingRegistrations((count) => count + pending);
      if (created.length || pending) setNotice(`${created.length + pending} 张图片已进入素材处理与核对队列`);
      if (failures.length) setError(`${failures.length} 张上传失败：${failures.slice(0, 3).join("、")}${failures.length > 3 ? " 等" : ""}`);
    } finally { setUploading(false); setProgress(null); if (fileInput.current) fileInput.current.value = ""; }
  };
  const startRename = (asset: LibraryAsset) => { cancelRename.current = false; setEditingId(asset.Id); setDraftName(asset.Name || "未命名图片"); setError(""); };
  const saveRename = async (asset: LibraryAsset) => {
    if (cancelRename.current) { cancelRename.current = false; return; }
    if (renaming.current.has(asset.Id)) return;
    const name = draftName.trim(); if (!name || name === asset.Name) { setEditingId(null); return; }
    renaming.current.add(asset.Id);
    try { const updated = await api.patch<LibraryAsset>(`/api/assets/${asset.Id}`, { name }); setAssets((current) => current.map((item) => item.Id === asset.Id ? updated : item)); setEditingId(null); setNotice("名称已更新"); }
    catch (renameError) { setError(renameError instanceof Error ? renameError.message : "重命名失败"); }
    finally { renaming.current.delete(asset.Id); }
  };
  const deleteSelection = async () => {
    const ids = [...selected]; if (!ids.length) return; setDeleting(true); setError("");
    try { const result = await api.post<{ deleted: string[]; failed: string[] }>("/api/assets/bulk-delete", { ids }); setAssets((current) => current.filter((asset) => !result.deleted.includes(asset.Id))); setSelected(new Set(result.failed)); setConfirmDelete(false); setNotice(`${result.deleted.length} 个素材已删除`); if (result.failed.length) setError(`${result.failed.length} 个素材删除失败，可再次重试`); }
    catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "删除失败，请稍后重试"); }
    finally { setDeleting(false); }
  };
  return <section className="image-assets" aria-label="图片资产管理">
    <div className="image-assets__toolbar"><label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索图片名称" aria-label="搜索图片资产" /></label><div>{assets.length > 0 && <button className="quiet" onClick={toggleAll}>{allSelected ? <CheckSquare2 /> : <Square />}{allSelected ? "取消全选" : "全选当前页"}</button>}{selected.size > 0 && <button className="quiet danger" onClick={() => setConfirmDelete(true)}><Trash2 /> 删除 {selected.size} 项</button>}<button className="asset-upload" disabled={!group || uploading} onClick={() => fileInput.current?.click()}>{uploading ? <LoaderCircle className="spin" /> : <Upload />}{progress ? `上传 ${progress.done}/${progress.total}` : "上传图片"}</button><input ref={fileInput} hidden multiple type="file" accept="image/*" onChange={(event) => void uploadImages(event.target.files)} /></div></div>
    {(notice || error) && <div className={`image-assets__feedback ${error ? "is-error" : ""}`} role="status">{error || notice}</div>}
    {loading ? <div className="image-assets__state"><LoaderCircle className="spin" /> 正在整理你的图片资产</div> : !assets.length ? <div className="image-assets__empty"><ImageIcon /><h2>{query ? "没有匹配的图片" : "把常用参考图放在这里"}</h2><p>{query ? "换一个关键词，或清除搜索。" : "支持一次选择多张图片；上传完成后只会出现在你的素材空间。"}</p>{query ? <button onClick={() => setQuery("")}>清除搜索</button> : <button disabled={!group} onClick={() => fileInput.current?.click()}><Upload /> 上传第一批图片</button>}</div> : <><div className="image-assets__grid">{assets.map((asset) => <article key={asset.Id} className={`image-asset-card ${selected.has(asset.Id) ? "is-selected" : ""}`}>
      <button className="image-asset-card__media" aria-pressed={selected.has(asset.Id)} aria-label={`${selected.has(asset.Id) ? "取消选择" : "选择"} ${asset.Name}`} onClick={() => toggle(asset.Id)}>{asset.URL ? <img src={asset.URL} alt="" loading="lazy" decoding="async" /> : <span><ImageIcon /></span>}<i>{selected.has(asset.Id) ? <Check /> : null}</i>{asset.Status !== "Active" && <small className={`status-${asset.Status.toLowerCase()}`}>{asset.Status === "Processing" ? "处理中" : "处理失败"}</small>}</button>
      <div className="image-asset-card__body">{editingId === asset.Id ? <input autoFocus value={draftName} maxLength={80} onChange={(event) => setDraftName(event.target.value)} onBlur={() => void saveRename(asset)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { cancelRename.current = true; setEditingId(null); event.currentTarget.blur(); } }} aria-label="图片名称" /> : <><h3 title={asset.Name}>{asset.Name || "未命名图片"}</h3><span className="image-asset-card__actions"><button aria-label={`插入画布 ${asset.Name}`} disabled={!asset.UploadId || asset.Status !== "Active"} title={!asset.UploadId ? "外部链接素材暂不支持插入画布" : asset.Status !== "Active" ? "素材仍在处理中" : "插入画布"} onClick={() => onInsertCanvas(asset)}><LayoutGrid /></button><button aria-label={`重命名 ${asset.Name}`} onClick={() => startRename(asset)}><Pencil /></button></span></>}</div>
    </article>)}</div>{hasMore && <button className="image-assets__more" disabled={loadingMore} onClick={() => void loadPage(page + 1, false)}>{loadingMore ? <LoaderCircle className="spin" /> : <Plus />} 加载更多</button>}</>}
    {confirmDelete && <div className="image-delete-backdrop" role="dialog" aria-modal="true" aria-labelledby="image-delete-title" onClick={() => !deleting && setConfirmDelete(false)}><div onClick={(event) => event.stopPropagation()}><Trash2 /><h2 id="image-delete-title">删除 {selected.size} 个图片素材？</h2><p>这些素材将从你的资产库移除，已提交的历史生成不会受到影响。</p><footer><button disabled={deleting} onClick={() => setConfirmDelete(false)}>取消</button><button className="danger" disabled={deleting} onClick={() => void deleteSelection()}>{deleting ? <LoaderCircle className="spin" /> : <Trash2 />} 确认删除</button></footer></div></div>}
  </section>;
}

export function AssetArchive({ tasks, models, onCreate, onDelete, onInsertCanvas }: { tasks: Task[]; models: ModelCapability[]; onCreate: () => void; onDelete: (task: Task) => void; onInsertCanvas: (target: { kind: "video"; task: Task } | { kind: "image"; asset: LibraryAsset }) => void }) {
  const [assetView, setAssetView] = useState<"videos" | "images">("videos"); const [query, setQuery] = useState(""); const [preview, setPreview] = useState<Task | null>(null); const [downloadNotice, setDownloadNotice] = useState<{ task: Task; message: string } | null>(null); const noticeTimer = useRef<number | null>(null); const playbackPositions = useRef(new Map<string, number>());
  const archived = useMemo(() => tasks.filter((task) => task.visibility !== "shared" && task.status === "succeeded" && task.mediaStatus === "ready" && task.videoUrl), [tasks]);
  const filtered = useMemo(() => archived.filter((task) => (task.prompt || "参考素材生成").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [archived, query]);
  useEffect(() => () => { if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current); }, []);
  const announceDownload = (task: Task) => {
    reportMediaEvent(task.id, "download_click", Date.now());
    setDownloadNotice({ task, message: "已交给浏览器下载器" });
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setDownloadNotice(null), 5200);
  };
  const copyDownloadEntry = async () => {
    if (!downloadNotice) return;
    const url = downloadNotice.task.downloadUrl ?? downloadNotice.task.videoUrl;
    try {
      if (!url) throw new Error("missing download url");
      await navigator.clipboard.writeText(new URL(url, window.location.origin).href);
      setDownloadNotice({ ...downloadNotice, message: "下载入口已复制" });
    } catch { setDownloadNotice({ ...downloadNotice, message: "复制失败，请再次点击下载" }); }
  };
  return <div className="archive-page">
    <header className="archive-heading"><div><span>Firefly archive</span><h1>我的资产</h1><p>{assetView === "videos" ? "已完成并归档的视频会自动收录在这里。" : "管理只属于你的参考图片素材。"}</p></div>{assetView === "videos" && archived.length > 0 && <label className="archive-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索视频" aria-label="搜索视频资产" /></label>}</header>
    <nav className="asset-tabs" aria-label="资产类型"><button className={assetView === "videos" ? "active" : ""} aria-current={assetView === "videos" ? "page" : undefined} onClick={() => setAssetView("videos")}><Film /> 视频资产</button><button className={assetView === "images" ? "active" : ""} aria-current={assetView === "images" ? "page" : undefined} onClick={() => { setAssetView("images"); setPreview(null); }}><ImageIcon /> 图片资产</button></nav>
    {assetView === "images" ? <ImageAssetManager onInsertCanvas={(asset) => onInsertCanvas({ kind: "image", asset })} /> : <>{!archived.length ? <div className="archive-empty"><div><Archive /></div><h2>第一支成片会出现在这里</h2><p>完成一次视频生成后，Firefly 会自动整理预览、下载与创作参数。</p><button onClick={onCreate}><Plus /> 开始创作</button></div>
      : !filtered.length ? <div className="archive-empty archive-empty--search"><Search /><h2>没有找到相关视频</h2><p>换一个关键词，或清除当前搜索。</p><button onClick={() => setQuery("")}>清除搜索</button></div>
      : <div className="archive-grid">{filtered.map((task) => { const model = models.find((item) => item.id === task.model); return <article className="archive-card" key={task.id}>
        <button className="archive-card__media" onClick={() => setPreview(task)} aria-label={`预览 ${task.prompt || "生成视频"}`}>
          <div className="archive-card__fallback"><Film /><span>{task.ratio}</span></div>{task.posterUrl && <img key={`${task.id}-${task.mediaRevision ?? 0}`} src={task.posterUrl} alt="" loading="lazy" decoding="async" onLoad={(event) => { event.currentTarget.style.display = "block"; event.currentTarget.style.opacity = "1"; }} onError={(event) => { event.currentTarget.style.display = "none"; }} />}<span className="archive-card__play"><Play /></span><small>{task.duration}s</small>
        </button>
        <div className="archive-card__body"><h2 title={task.prompt || "参考素材生成"}>{task.prompt || "参考素材生成"}</h2><p>{model?.name ?? task.model} · {task.resolution} · {task.ratio}</p><footer><time>{new Date(task.createdAt).toLocaleDateString("zh-CN")}</time><div><CaseIdButton task={task} compact /><a href={task.downloadUrl ?? task.videoUrl} target="_blank" rel="noreferrer" title="下载视频" onClick={() => announceDownload(task)}><Download /></a><button title="插入画布" onClick={() => onInsertCanvas({ kind: "video", task })}><LayoutGrid /></button><button title="删除项目" onClick={() => onDelete(task)}><Trash2 /></button></div></footer></div>
      </article>; })}</div>}
    {preview && <AssetPreview task={preview} close={() => setPreview(null)} onDelete={onDelete} initialTime={playbackPositions.current.get(preview.id) ?? 0} onPosition={(time) => playbackPositions.current.set(preview.id, time)} />}
    {downloadNotice && <div className="archive-download-notice" role="status" aria-live="polite"><span className="archive-download-notice__icon"><Download /></span><span><b>{downloadNotice.message}</b><small>网络中断后可从浏览器下载列表继续</small></span><button onClick={copyDownloadEntry}><Copy /> 复制入口</button></div>}</>}
  </div>;
}
