import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ChevronRight, Home, LoaderCircle, LogOut, Menu, MessageSquare, PanelLeftClose, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { api } from "../../api";
import type { ImageGenerationTask, LibraryAsset, ModelCapability, SessionUser, Task } from "../../types";
import { FireflyGlyph } from "../../components/Branding";
import { CanvasProjectList } from "../canvas/CanvasProjectList";
import { CanvasWorkspace } from "../canvas/CanvasWorkspace";
import { CanvasInsertPicker } from "../canvas/CanvasInsertPicker";
import { Composer } from "./Composer";
import { TaskCard, taskStatusText } from "./TaskCard";
import { AssetArchive } from "./AssetArchive";
import { ImageResultsGallery } from "./ImageResultsGallery";

function GenerateNavGlyph() { return <svg className="rail-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2c1.35 4.78 4.02 7.45 8.8 8.8-4.78 1.35-7.45 4.02-8.8 8.8-1.35-4.78-4.02-7.45-8.8-8.8 4.78-1.35 7.45-4.02 8.8-8.8Z" /></svg>; }
function AssetsNavGlyph() { return <svg className="rail-glyph rail-glyph--stroke" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h6l1.8 2h9.2v8.7a2.3 2.3 0 0 1-2.3 2.3H5.8a2.3 2.3 0 0 1-2.3-2.3V7.5Z" /><path d="M3.5 7.5V6.2a2 2 0 0 1 2-2h3.2l1.8 2h7a2 2 0 0 1 2 2v1.3" /></svg>; }
function CanvasNavGlyph() { return <svg className="rail-glyph rail-glyph--canvas" viewBox="0 0 24 24" aria-hidden="true"><path className="canvas-frame" d="M6 2.5v19M2.5 6h12M2.5 18h11.5M17 2.5v7" /><path d="M17 3.2c.45 1.8 1.5 2.85 3.3 3.3-1.8.45-2.85 1.5-3.3 3.3-.45-1.8-1.5-2.85-3.3-3.3 1.8-.45 2.85-1.5 3.3-3.3ZM17.8 14.2c.55 2.1 1.8 3.35 3.9 3.9-2.1.55-3.35 1.8-3.9 3.9-.55-2.1-1.8-3.35-3.9-3.9 2.1-.55 3.35-1.8 3.9-3.9Z" /></svg>; }
function AtlasNavGlyph() { return <svg className="rail-glyph rail-glyph--atlas" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 0 100 100H70L50 49 42 64H22L50 0Z" /><path d="M10 80h58l12 20H0l10-20Z" /></svg>; }

function UserAvatar({ user }: { user: SessionUser }) {
  const initials = (user.name || user.email).trim().slice(0, 1).toUpperCase();
  return user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span>{initials}</span>;
}

function AccountMenu({ user, close, home, logout }: { user: SessionUser; close: () => void; home: () => void; logout: () => void }) {
  return <div className="account-menu" role="menu" aria-label="账号菜单" onClick={(event) => event.stopPropagation()}>
    <div className="account-menu__identity"><div className="account-menu__avatar"><UserAvatar user={user} /></div><span><b>{user.name}</b><small>{user.email}</small></span></div>
    <div className="account-menu__space"><span>企业创作空间</span><small>项目与成片仅你可见</small></div>
    <div className="account-menu__actions">
      <button role="menuitem" onClick={() => { close(); home(); }}><Home /><span>返回首页</span><ChevronRight /></button>
      <button role="menuitem" onClick={() => { close(); logout(); }}><LogOut /><span>退出登录</span></button>
    </div>
  </div>;
}

export function Studio({ user, route, navigate, logout }: { user: SessionUser; route: string; navigate: (path: string) => void; logout: () => void }) {
  const view = route.startsWith("/studio/canvas") ? "canvas" : route === "/studio/assets" ? "assets" : "create";
  const [models, setModels] = useState<ModelCapability[]>([]); const [tasks, setTasks] = useState<Task[]>([]); const [sidebar, setSidebar] = useState(() => window.innerWidth > 760); const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState(""); const [syncIssue, setSyncIssue] = useState(false); const [creatingNew, setCreatingNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null); const [deleting, setDeleting] = useState(false); const [deleteError, setDeleteError] = useState(""); const [profileOpen, setProfileOpen] = useState(false); const [featureNotice, setFeatureNotice] = useState<{ kind: "atlas"; nonce: number; leaving?: boolean } | null>(null); const [pendingCanvasCreate, setPendingCanvasCreate] = useState(false); const [canvasInsertTarget, setCanvasInsertTarget] = useState<{ kind: "video"; task: Task } | { kind: "image"; asset: LibraryAsset } | { kind: "generated"; mediaId: string; title: string } | null>(null); const [imageTasks, setImageTasks] = useState<ImageGenerationTask[]>([]); const profileRef = useRef<HTMLDivElement>(null); const atlasExitTimer = useRef<number | undefined>(undefined); const atlasAutoTimer = useRef<number | undefined>(undefined);
  const [now, setNow] = useState(Date.now());
  const activeTasks = useMemo(() => tasks.filter((task) => !["succeeded", "failed"].includes(task.status) || task.mediaStatus === "archiving"), [tasks]);
  const activeImageTasks = useMemo(() => imageTasks.filter((task) => task.status === "queued" || task.status === "running"), [imageTasks]);
  const activeWorkCount = activeTasks.length + activeImageTasks.length;
  const privateTasks = useMemo(() => tasks.filter((task) => task.visibility !== "shared"), [tasks]);
  const sharedTasks = useMemo(() => tasks.filter((task) => task.visibility === "shared"), [tasks]);
  const archivedCount = useMemo(() => privateTasks.filter((task) => task.status === "succeeded" && task.videoUrl).length, [privateTasks]);
  const latestVideoTaskId = useMemo(() => tasks.find((task) => task.status === "succeeded" && task.videoUrl && (!task.videoExpiresAt || task.videoExpiresAt > now))?.id, [tasks, now]);
  const refresh = async () => { try { const [videoTasks, images] = await Promise.all([api.get<Task[]>("/api/generations"), api.get<{ Items: ImageGenerationTask[] }>("/api/image-generations")]); setTasks(videoTasks); setImageTasks(images.Items ?? []); setLoadError(""); setSyncIssue(false); } catch { setSyncIssue(true); } finally { setLoading(false); } };
  const initialLoad = () => { setLoading(true); setLoadError(""); Promise.all([api.get<ModelCapability[]>("/api/models"), api.get<Task[]>("/api/generations"), api.get<{ Items: ImageGenerationTask[] }>("/api/image-generations")]).then(([m, t, images]) => { setModels(m); setTasks(t); setImageTasks(images.Items ?? []); setSyncIssue(false); }).catch((error) => setLoadError(error instanceof Error ? error.message : "创作台暂时无法载入")).finally(() => setLoading(false)); };
  useEffect(initialLoad, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(timer); }, []);
  useEffect(() => () => { if (atlasExitTimer.current) window.clearTimeout(atlasExitTimer.current); if (atlasAutoTimer.current) window.clearTimeout(atlasAutoTimer.current); }, []);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (profileRef.current && !profileRef.current.contains(event.target as Node)) setProfileOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setProfileOpen(false); if (!deleting) setDeleteTarget(null); } };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [deleting]);
  useEffect(() => {
    if (!activeWorkCount) return;
    let disposed = false; let timer: number | undefined;
    const schedule = () => { timer = window.setTimeout(tick, document.hidden ? 15000 : 2000); };
    const tick = async () => { await refresh(); if (!disposed) schedule(); };
    const resume = () => { if (timer) window.clearTimeout(timer); if (!document.hidden && navigator.onLine) void refresh(); schedule(); };
    schedule(); document.addEventListener("visibilitychange", resume); window.addEventListener("online", resume);
    return () => { disposed = true; if (timer) window.clearTimeout(timer); document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); };
  }, [activeWorkCount]);
  useEffect(() => {
    if (activeWorkCount) return;
    let timer: number | undefined;
    const schedule = () => { timer = window.setTimeout(tick, document.hidden ? 5 * 60_000 : 60_000); };
    const tick = async () => { await refresh(); schedule(); };
    const resume = () => { if (timer) window.clearTimeout(timer); if (!document.hidden && navigator.onLine) void refresh(); schedule(); };
    schedule(); document.addEventListener("visibilitychange", resume); window.addEventListener("online", resume);
    return () => { if (timer) window.clearTimeout(timer); document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); };
  }, [activeWorkCount]);
  const showCreate = (fresh = false) => { navigate("/studio"); setCreatingNew(fresh); setFeatureNotice(null); if (window.innerWidth <= 760) setSidebar(false); };
  const showAssets = () => { navigate("/studio/assets"); setProfileOpen(false); setFeatureNotice(null); if (window.innerWidth <= 760) setSidebar(false); };
  const showCanvas = () => { navigate("/studio/canvas"); setProfileOpen(false); setFeatureNotice(null); if (window.innerWidth <= 760) setSidebar(false); };
  const createCanvasFromSidebar = () => { setPendingCanvasCreate(true); showCanvas(); };
  const dismissAtlas = () => {
    if (!featureNotice || featureNotice.leaving) return;
    if (atlasAutoTimer.current) window.clearTimeout(atlasAutoTimer.current);
    setFeatureNotice({ ...featureNotice, leaving: true });
    atlasExitTimer.current = window.setTimeout(() => setFeatureNotice(null), 700);
  };
  const activateAtlas = () => {
    setProfileOpen(false);
    if (featureNotice && !featureNotice.leaving) { dismissAtlas(); return; }
    if (atlasExitTimer.current) window.clearTimeout(atlasExitTimer.current);
    if (atlasAutoTimer.current) window.clearTimeout(atlasAutoTimer.current);
    setFeatureNotice({ kind: "atlas", nonce: Date.now() });
    atlasAutoTimer.current = window.setTimeout(() => {
      setFeatureNotice((current) => current && !current.leaving ? { ...current, leaving: true } : current);
      atlasExitTimer.current = window.setTimeout(() => setFeatureNotice(null), 700);
    }, 6400);
  };
  const selectTask = (task: Task) => { showCreate(false); requestAnimationFrame(() => document.getElementById(`task-${task.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })); };
  const requestDelete = (task: Task) => { setDeleteError(""); setDeleteTarget(task); };
  const confirmDelete = async () => { if (!deleteTarget) return; setDeleting(true); setDeleteError(""); try { await api.delete(`/api/generations/${deleteTarget.id}`); setTasks((old) => old.filter((task) => task.id !== deleteTarget.id)); setDeleteTarget(null); } catch (error) { setDeleteError(error instanceof Error ? error.message : "删除失败，请稍后重试"); } finally { setDeleting(false); } };
  const historySection = (label: string, items: Task[]) => <>{!!items.length && <><div className="sidebar-label">{label}</div><div className="history-list">{items.map((task) => <button key={task.id} onClick={() => selectTask(task)}><MessageSquare /><span><b>{task.prompt || "参考素材生成"}</b><small>{taskStatusText(task)} · {new Date(task.createdAt).toLocaleDateString("zh-CN")}</small></span></button>)}</div></>}</>;
  return <main className={`studio ${sidebar ? "" : "studio--collapsed"}`}>
    <div className={`intelligence-aura ${featureNotice ? featureNotice.leaving ? "intelligence-aura--leaving" : "intelligence-aura--active" : ""}`} aria-hidden="true"><i className="aura-corner aura-corner--tl" /><i className="aura-corner aura-corner--tr" /><i className="aura-corner aura-corner--br" /><i className="aura-corner aura-corner--bl" /></div>
    <nav className="app-rail" aria-label="主要导航"><button className="rail-logo" aria-label="Firefly 创作台" onClick={() => showCreate(false)}><FireflyGlyph compact /></button><div className="rail-nav"><button className={view === "create" ? "active" : ""} aria-current={view === "create" ? "page" : undefined} onClick={() => showCreate(false)}><GenerateNavGlyph /><span>生成</span></button><button className={view === "assets" ? "active" : ""} aria-current={view === "assets" ? "page" : undefined} onClick={showAssets}><AssetsNavGlyph /><span>资产</span>{archivedCount > 0 && <i title={`${archivedCount} 个资产`}>{archivedCount > 99 ? "99+" : archivedCount}</i>}</button><button className={view === "canvas" ? "active" : ""} aria-current={view === "canvas" ? "page" : undefined} onClick={showCanvas}><CanvasNavGlyph /><span>画布</span></button><button className={featureNotice && !featureNotice.leaving ? "future active-preview" : "future"} aria-pressed={Boolean(featureNotice && !featureNotice.leaving)} onClick={activateAtlas}><AtlasNavGlyph /><span>Atlas</span></button></div><div className="rail-account" ref={profileRef}><button className="rail-avatar" aria-label="打开账号菜单" aria-expanded={profileOpen} onClick={() => setProfileOpen((open) => !open)}><UserAvatar user={user} /></button>{profileOpen && <AccountMenu user={user} close={() => setProfileOpen(false)} home={() => navigate("/")} logout={logout} />}</div></nav>
    <aside className="sidebar" aria-hidden={!sidebar} inert={!sidebar ? true : undefined}><div className="sidebar-head"><span>{view === "assets" ? "资产归档" : view === "canvas" ? "画布" : "开始创作"}</span><button aria-label="收起侧栏" onClick={() => setSidebar(false)}><PanelLeftClose /></button></div>{view === "create" ? <><button className="new-chat" onClick={() => showCreate(true)}><Plus /> 新创作</button>{historySection("我的创作", privateTasks)}{historySection("团队历史", sharedTasks)}{!tasks.length && <div className="history-list"><p>还没有创作记录</p></div>}</> : view === "assets" ? <><div className="asset-sidebar-summary"><span>已归档成片</span><strong>{archivedCount}</strong><p>完成生成的视频会自动进入资产页，并长期保留至你主动删除。</p></div><button className="new-chat new-chat--quiet" onClick={() => showCreate(true)}><Plus /> 创建新视频</button></> : <div className="canvas-sidebar-summary"><CanvasNavGlyph /><span>自由画布</span><p>把镜头、素材与灵感组织在同一张画布上，自由排版、连接创作。</p><button className="new-chat new-chat--quiet" onClick={createCanvasFromSidebar}><Plus /> 新建画布</button></div>}</aside>
    {sidebar && <button className="sidebar-scrim" aria-label="关闭侧栏" onClick={() => setSidebar(false)} />}
    <section className="workspace"><header className="workspace-head">{!sidebar && <button className="menu-button" aria-label="打开侧栏" onClick={() => setSidebar(true)}><Menu /></button>}<span>{view === "assets" ? "Firefly media archive" : view === "canvas" ? "Firefly canvas" : "Seedance video studio"}</span><div className={`system-live ${syncIssue ? "system-live--issue" : ""}`} title={syncIssue ? "与服务端的同步暂时中断，系统会自动重试" : undefined}><i /> {syncIssue ? "同步暂时中断" : activeWorkCount ? `${activeWorkCount} 项进行中` : "系统在线"}</div></header>
      {loading ? <div className="workspace-loading"><LoaderCircle className="spin" /> 正在唤醒 Firefly</div> : loadError ? <div className="workspace-error"><Archive /><h1>创作台暂时无法载入</h1><p>{loadError}</p><button onClick={initialLoad}><RefreshCw /> 重新载入</button></div> : view === "canvas" ? (route === "/studio/canvas" ? <CanvasProjectList navigate={navigate} autoCreate={pendingCanvasCreate} onAutoCreateHandled={() => setPendingCanvasCreate(false)} /> : <CanvasWorkspace canvasId={route.split("/")[3] ?? ""} navigate={navigate} />) : view === "assets" ? <AssetArchive tasks={tasks} models={models} onCreate={() => showCreate(true)} onDelete={requestDelete} onInsertCanvas={setCanvasInsertTarget} /> : creatingNew || (!tasks.length && !imageTasks.length) ? <div className="empty-workspace"><Composer models={models} compact={false} onCreated={(task) => { setTasks((old) => [task, ...old]); setCreatingNew(false); }} onImageQueued={(task) => { setImageTasks((old) => [task, ...old]); setCreatingNew(false); }} /><ImageResultsGallery tasks={imageTasks} onInsertCanvas={setCanvasInsertTarget} /><div className="creation-footnote">输入素材保留 7 天 · 成片将长期保存至主动删除</div></div> : <div className="conversation"><div className="conversation-inner"><ImageResultsGallery tasks={imageTasks} onInsertCanvas={setCanvasInsertTarget} /><div className="conversation-heading"><span>Current sequence</span><h1>创作正在发生</h1></div>{tasks.map((task) => <TaskCard key={task.id} task={task} models={models} eager={task.id === latestVideoTaskId} now={now} onDelete={requestDelete} canDelete={task.ownerId === user.id} />)}</div><div className="composer-dock"><Composer models={models} compact onCreated={(task) => setTasks((old) => [task, ...old])} onImageQueued={(task) => setImageTasks((old) => [task, ...old])} /></div></div>}
    </section>
    {canvasInsertTarget && <CanvasInsertPicker payload={canvasInsertTarget.kind === "video" ? { kind: "video", taskId: canvasInsertTarget.task.id, title: canvasInsertTarget.task.prompt || "参考素材生成" } : canvasInsertTarget.kind === "image" ? { kind: "image", uploadId: canvasInsertTarget.asset.UploadId ?? "", name: canvasInsertTarget.asset.Name || "图片" } : { kind: "generated", mediaId: canvasInsertTarget.mediaId, title: canvasInsertTarget.title }} onClose={() => setCanvasInsertTarget(null)} navigate={navigate} />}
    {deleteTarget && <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-title" onClick={() => !deleting && setDeleteTarget(null)}><div className="confirm-dialog" onClick={(event) => event.stopPropagation()}><span><Trash2 /></span><h2 id="delete-title">删除这次创作？</h2><p>项目与已归档成片将被删除，此操作无法撤销。</p>{deleteError && <small className="confirm-error" role="alert">{deleteError}</small>}<div><button autoFocus disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</button><button className="danger" disabled={deleting} onClick={confirmDelete}>{deleting ? <LoaderCircle className="spin" /> : <Trash2 />} 删除项目</button></div></div></div>}
    {featureNotice && <div key={`notice-${featureNotice.nonce}`} className={`feature-notice feature-notice--atlas ${featureNotice.leaving ? "feature-notice--leaving" : ""}`} role="status" aria-live="polite"><span className="feature-notice__icon"><AtlasNavGlyph /></span><span><b>Atlas</b><small>功能即将上线</small></span><button aria-label="关闭提示" onClick={dismissAtlas}><X /></button></div>}
  </main>;
}
