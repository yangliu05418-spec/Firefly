import { useEffect, useRef, useState } from "react";
import { Archive, LayoutGrid, LoaderCircle, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { createCanvas, deleteCanvas, listCanvases, renameCanvas } from "./canvas-api";
import type { CanvasProjectSummary } from "./canvas-types";
import { relativeTime } from "./format";

const PAGE_SIZE = 50;

type CanvasProjectListProps = {
  navigate: (path: string) => void;
  /** 侧栏"新建画布"触发一次创建（列表挂载后执行一次） */
  autoCreate?: boolean;
  onAutoCreateHandled?: () => void;
};

export function CanvasProjectList({ navigate, autoCreate = false, onAutoCreateHandled }: CanvasProjectListProps) {
  const [projects, setProjects] = useState<CanvasProjectSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CanvasProjectSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [now, setNow] = useState(Date.now());
  const renameInputRef = useRef<HTMLInputElement>(null);
  const cancelRenameRef = useRef(false);
  const autoCreateHandled = useRef(false);

  const load = async (targetPage: number, reset: boolean) => {
    if (!reset) setLoadingMore(true);
    try {
      const result = await listCanvases(targetPage, PAGE_SIZE);
      setProjects((old) => (reset ? result.Items : [...(old ?? []), ...result.Items]));
      setPage(targetPage);
      setHasMore(result.HasMore);
      setLoadError("");
    } catch (error) {
      if (reset) {
        setProjects(null);
        setLoadError(error instanceof Error ? error.message : "画布列表暂时无法载入");
      } else {
        setActionError("加载更多失败：" + (error instanceof Error ? error.message : "请稍后重试"));
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void load(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const startRename = (id: string, title: string) => {
    cancelRenameRef.current = false;
    setRenamingId(id);
    setRenamingValue(title);
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  };

  const commitRename = async () => {
    const id = renamingId;
    if (!id) return;
    const title = renamingValue.trim();
    setRenamingId(null);
    if (!title) return;
    const previous = projects?.find((p) => p.id === id);
    setProjects((old) => old?.map((p) => (p.id === id ? { ...p, title } : p)) ?? null);
    try {
      await renameCanvas(id, title);
      setActionError("");
    } catch (error) {
      setActionError("重命名失败：" + (error instanceof Error ? error.message : "请稍后重试"));
      if (previous) setProjects((old) => old?.map((p) => (p.id === id ? previous : p)) ?? null);
    }
  };

  const cancelRename = () => {
    cancelRenameRef.current = true;
    setRenamingId(null);
  };

  const createCanvasFlow = async () => {
    if (creating) return;
    setCreating(true);
    setActionError("");
    try {
      const created = await createCanvas("未命名画布");
      setProjects((old) => [{ id: created.id, title: created.title, nodeCount: 0, updatedAt: Date.now() }, ...(old ?? [])]);
      setHasMore(false);
      startRename(created.id, created.title);
    } catch (error) {
      setActionError("新建画布失败：" + (error instanceof Error ? error.message : "请稍后重试"));
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (autoCreate && !autoCreateHandled.current) {
      autoCreateHandled.current = true;
      onAutoCreateHandled?.();
      void createCanvasFlow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCreate]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteCanvas(deleteTarget.id);
      setProjects((old) => old?.filter((p) => p.id !== deleteTarget.id) ?? null);
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除失败，请稍后重试");
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (deleteTarget && !deleting) setDeleteTarget(null);
      else if (renamingId) cancelRename();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteTarget, deleting, renamingId]);

  const openProject = (project: CanvasProjectSummary) => navigate("/studio/canvas/" + encodeURIComponent(project.id));

  return (
    <div className="canvas-page">
      <header className="canvas-page-head">
        <div>
          <span>Workspace</span>
          <h1>画布</h1>
          <p>把镜头、素材与创作思路组织在同一张画布上——节点自由摆放，想法彼此相连。</p>
        </div>
        <button className="primary-button canvas-page-head__create" onClick={() => void createCanvasFlow()} disabled={creating || loading}>
          {creating ? <LoaderCircle className="spin" /> : <Plus />} 新建画布
        </button>
      </header>

      {actionError && (
        <div className="canvas-banner canvas-banner--error" role="alert">
          <span>{actionError}</span>
          <button aria-label="关闭提示" onClick={() => setActionError("")}><X /></button>
        </div>
      )}

      {loading ? (
        <div className="canvas-grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="canvas-card canvas-card--skeleton" key={index}><span /><div /></div>
          ))}
        </div>
      ) : loadError ? (
        <div className="workspace-error">
          <Archive />
          <h1>画布列表暂时无法载入</h1>
          <p>{loadError}</p>
          <button onClick={() => { setLoading(true); void load(1, true); }}><RefreshCw /> 重新载入</button>
        </div>
      ) : !projects?.length ? (
        <div className="canvas-empty">
          <div><LayoutGrid /></div>
          <h2>还没有画布</h2>
          <p>创建一张画布，把镜头、素材与灵感组织在一起。之后可以从资产归档把成片与图片拖进画布。</p>
          <button onClick={() => void createCanvasFlow()} disabled={creating}>{creating ? <LoaderCircle className="spin" /> : <Plus />} 新建画布</button>
        </div>
      ) : (
        <>
          <div className="canvas-grid">
            {projects.map((project) => (
              <article className="canvas-card" key={project.id}>
                <button className="canvas-card__open" onClick={() => openProject(project)} aria-label={"打开画布 " + project.title}>
                  <span className="canvas-card__preview" aria-hidden="true" />
                  <span className="canvas-card__count"><LayoutGrid />{project.nodeCount === 0 ? "空白画布" : project.nodeCount + " 个节点"}</span>
                </button>
                <div className="canvas-card__body">
                  {renamingId === project.id ? (
                    <input
                      ref={renameInputRef}
                      value={renamingValue}
                      onChange={(event) => setRenamingValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void commitRename();
                        else if (event.key === "Escape") cancelRename();
                      }}
                      onBlur={() => {
                        if (cancelRenameRef.current) { cancelRenameRef.current = false; return; }
                        void commitRename();
                      }}
                      aria-label="画布名称"
                      maxLength={80}
                    />
                  ) : (
                    <h3 onDoubleClick={() => startRename(project.id, project.title)} title="双击重命名">{project.title}</h3>
                  )}
                  <div className="canvas-card__meta">
                    <span>{relativeTime(project.updatedAt, now)}</span>
                    <div className="canvas-card__actions">
                      <button onClick={() => startRename(project.id, project.title)} aria-label="重命名画布"><Pencil /></button>
                      <button className="danger" onClick={() => { setDeleteError(""); setDeleteTarget(project); }} aria-label="删除画布"><Trash2 /></button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {hasMore && (
            <button className="canvas-more" onClick={() => void load(page + 1, false)} disabled={loadingMore}>
              {loadingMore ? <LoaderCircle className="spin" /> : <Plus />} 加载更多
            </button>
          )}
        </>
      )}

      {deleteTarget && (
        <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="canvas-delete-title" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
            <span><Trash2 /></span>
            <h2 id="canvas-delete-title">删除画布「{deleteTarget.title}」？</h2>
            <p>画布中的节点与连线将一并删除，此操作无法撤销。</p>
            {deleteError && <small className="confirm-error" role="alert">{deleteError}</small>}
            <div>
              <button autoFocus disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="danger" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? <LoaderCircle className="spin" /> : <Trash2 />} 删除画布</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
