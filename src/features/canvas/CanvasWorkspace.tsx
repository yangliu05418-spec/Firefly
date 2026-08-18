/**
 * 画布工作台：接管 /studio/canvas/:id 路由。
 * M3：拖拽（分组跟随/吸附）、框选（shift 加选）、连线创建、剪贴板、撤销/重做、快捷键全部接线。
 * 自动保存（800ms debounce PUT）与 409 冲突处理在 M5。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowLeft, LayoutGrid, LoaderCircle, RefreshCw, X } from "lucide-react";
import { getCanvas } from "./canvas-api";
import { useCanvasStore } from "./canvas-store";
import { CanvasSurface } from "./components/CanvasSurface";
import { ActiveConnectionPath, ConnectionPath } from "./components/CanvasConnections";
import { CanvasMinimap } from "./components/CanvasMinimap";
import { CanvasNode } from "./components/CanvasNode";
import { CanvasToolbar } from "./components/CanvasToolbar";
import { CanvasMediaInsertModal } from "./components/CanvasMediaInsertModal";
import { boxRectFromPoints } from "./core/selection";
import { resetViewport, setZoomScale } from "./core/viewport";
import { relativeTime } from "./format";
import { useCanvasInteractions } from "./useCanvasInteractions";
import { useCanvasAutosave } from "./useCanvasAutosave";

export function CanvasWorkspace({ canvasId, navigate }: { canvasId: string; navigate: (path: string) => void }) {
  const [loadState, setLoadState] = useState<"loading" | "error" | "ready">("loading");
  const [loadError, setLoadError] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [project, setProject] = useState<Awaited<ReturnType<typeof getCanvas>> | null>(null);
  const [conflictNotice, setConflictNotice] = useState(false);
  const [mediaModalOpen, setMediaModalOpen] = useState(false);
  const conflictNoticeTimer = useRef<number | null>(null);
  const [projectUpdatedAt, setProjectUpdatedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const surfaceRef = useRef<HTMLDivElement>(null);

  const document = useCanvasStore((state) => state.document);
  const viewport = useCanvasStore((state) => state.document.viewport);
  const background = useCanvasStore((state) => state.document.background);
  const nodes = useCanvasStore((state) => state.document.nodes);
  const connections = useCanvasStore((state) => state.document.connections);
  const tool = useCanvasStore((state) => state.tool);
  const selection = useCanvasStore((state) => state.selection);
  const selectedConnectionId = useCanvasStore((state) => state.selectedConnectionId);
  const viewportSize = useCanvasStore((state) => state.viewportSize);
  const minimapOpen = useCanvasStore((state) => state.minimapOpen);
  const hoveredNodeId = useCanvasStore((state) => state.hoveredNodeId);
  const connecting = useCanvasStore((state) => state.connecting);
  const mouseWorld = useCanvasStore((state) => state.mouseWorld);
  const connectionTargetNodeId = useCanvasStore((state) => state.connectionTargetNodeId);
  const editRequest = useCanvasStore((state) => state.editRequest);

  const { handlers, selectionBox, dropTargetGroupId, resetHistory, getRelatedIds } = useCanvasInteractions({ surfaceRef });

  const load = useCallback(async () => {
    setLoadState("loading");
    setLoadError("");
    try {
      const project = await getCanvas(canvasId);
      if (!project.document) throw new Error("画布文档无法解析");
      useCanvasStore.getState().hydrate(project.document);
      resetHistory();
      setProject(project);
      setProjectTitle(project.title);
      setProjectUpdatedAt(project.updatedAt);
      setLoadState("ready");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "画布暂时无法载入");
      setLoadState("error");
    }
  }, [canvasId, resetHistory]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // 视口尺寸（小地图/居中换算依赖）
  useEffect(() => {
    if (loadState !== "ready") return;
    const element = surfaceRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      useCanvasStore.getState().setViewportSize({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [loadState]);

  const { saveState, retry: retrySave } = useCanvasAutosave({
    canvasId,
    revision: project?.revision ?? 0,
    initialDocument: project?.document ?? null,
    onConflictReload: () => {
      resetHistory();
      setConflictNotice(true);
      if (conflictNoticeTimer.current) window.clearTimeout(conflictNoticeTimer.current);
      conflictNoticeTimer.current = window.setTimeout(() => setConflictNotice(false), 6000);
    },
  });

  useEffect(() => () => { if (conflictNoticeTimer.current) window.clearTimeout(conflictNoticeTimer.current); }, []);

  const relatedIds = useMemo(() => (hoveredNodeId ? getRelatedIds(hoveredNodeId) : new Set<string>()), [hoveredNodeId, getRelatedIds]);
  const selectedSet = useMemo(() => new Set(selection), [selection]);
  const store = useCanvasStore.getState;

  const connectingNode = connecting ? nodes.find((node) => node.id === connecting.nodeId) : undefined;
  const connectingTarget = connectionTargetNodeId ? nodes.find((node) => node.id === connectionTargetNodeId) : undefined;

  if (loadState === "loading") {
    return (
      <div className="canvas-workspace">
        <header className="canvas-workspace__head">
          <button className="canvas-workspace__back" onClick={() => navigate("/studio/canvas")}><ArrowLeft /> 画布列表</button>
        </header>
        <div className="canvas-workspace__stage"><div className="canvas-workspace__state"><LoaderCircle className="spin" /> 正在载入画布</div></div>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="canvas-workspace">
        <header className="canvas-workspace__head">
          <button className="canvas-workspace__back" onClick={() => navigate("/studio/canvas")}><ArrowLeft /> 画布列表</button>
        </header>
        <div className="canvas-workspace__stage">
          <div className="workspace-error">
            <Archive />
            <h1>画布暂时无法载入</h1>
            <p>{loadError}</p>
            <button onClick={() => void load()}><RefreshCw /> 重新载入</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-workspace">
      <header className="canvas-workspace__head">
        <button className="canvas-workspace__back" onClick={() => navigate("/studio/canvas")}><ArrowLeft /> 画布列表</button>
        <div className="canvas-workspace__title">
          <h1>{projectTitle}</h1>
          <span>{nodes.length} 个节点 · {connections.length} 条连线 · 更新于 {relativeTime(projectUpdatedAt, now)}</span>
        </div>
        <div className={"canvas-workspace__save canvas-workspace__save--" + saveState.status} role="status" aria-live="polite">
          {saveState.status === "saving" ? <><LoaderCircle className="spin" /> 保存中…</> : saveState.status === "error" ? <button type="button" onClick={retrySave} title={saveState.message}>保存失败，点击重试</button> : saveState.status === "conflict" ? saveState.message : "已自动保存"}
        </div>
      </header>
      <div className="canvas-workspace__body" ref={surfaceRef}>
        <CanvasSurface
          containerRef={surfaceRef}
          viewport={viewport}
          tool={tool}
          backgroundMode={background}
          onViewportChange={(next) => store().setViewport(next)}
          onCanvasMouseDown={handlers.onCanvasMouseDown}
          onCanvasDeselect={handlers.onCanvasDeselect}
          onCanvasDoubleClick={handlers.onCanvasDoubleClick}
          onContextMenu={(event) => event.preventDefault()}
        >
          <svg className="canvas-connections-layer" width="10000" height="10000" style={{ pointerEvents: "none" }}>
            {connections.map((connection) => {
              const from = nodes.find((node) => node.id === connection.fromNodeId);
              const to = nodes.find((node) => node.id === connection.toNodeId);
              if (!from || !to) return null;
              return (
                <ConnectionPath
                  key={connection.id}
                  connection={connection}
                  from={from}
                  to={to}
                  active={selectedConnectionId === connection.id}
                  onSelect={() => {
                    store().setSelectedConnectionId(connection.id);
                    store().setSelection([]);
                  }}
                  onContextMenu={(event) => event.preventDefault()}
                />
              );
            })}
            {connecting && mouseWorld && <ActiveConnectionPath node={connectingNode} handle={connecting} mouseWorld={mouseWorld} target={connectingTarget} />}
          </svg>
          {selectionBox && (
            <div
              className="canvas-selection-box"
              style={{
                left: boxRectFromPoints(selectionBox.startWorldX, selectionBox.startWorldY, selectionBox.currentWorldX, selectionBox.currentWorldY).x,
                top: boxRectFromPoints(selectionBox.startWorldX, selectionBox.startWorldY, selectionBox.currentWorldX, selectionBox.currentWorldY).y,
                width: boxRectFromPoints(selectionBox.startWorldX, selectionBox.startWorldY, selectionBox.currentWorldX, selectionBox.currentWorldY).width,
                height: boxRectFromPoints(selectionBox.startWorldX, selectionBox.startWorldY, selectionBox.currentWorldX, selectionBox.currentWorldY).height,
              }}
            />
          )}
          {nodes.map((node) => (
            <CanvasNode
              key={node.id}
              node={node}
              scale={viewport.k}
              isSelected={selectedSet.has(node.id)}
              isRelated={relatedIds.has(node.id)}
              isConnectionTarget={connectionTargetNodeId === node.id}
              isConnecting={connecting !== null}
              interactive
              editRequested={editRequest?.nodeId === node.id}
              editRequestNonce={editRequest?.nonce ?? 0}
              isGroupDropTarget={dropTargetGroupId === node.id}
              groupChildCount={node.type === "group" ? nodes.filter((child) => child.metadata.groupId === node.id).length : 0}
              onMouseDown={handlers.onNodeMouseDown}
              onSelectCapture={handlers.onNodeSelectCapture}
              onHoverStart={handlers.onNodeHoverStart}
              onHoverEnd={handlers.onNodeHoverEnd}
              onConnectStart={handlers.onNodeConnectStart}
              onResizeStart={handlers.onNodeResizeStart}
              onResize={handlers.onNodeResize}
              onResizeEnd={handlers.onNodeResizeEnd}
              onContentChange={handlers.onNodeContentChange}
              onTitleChange={handlers.onNodeTitleChange}
              onContextMenu={(event) => event.preventDefault()}
            />
          ))}
        </CanvasSurface>
        {!nodes.length && (
          <div className="canvas-empty-hint" aria-hidden="true">
            <span className="canvas-empty-hint__icon"><LayoutGrid /></span>
            <b>双击空白处添加文本节点</b>
            <p>或点击左下角「插入素材」，把成片与图片放上画布。</p>
          </div>
        )}
        {minimapOpen && <CanvasMinimap nodes={nodes} viewport={viewport} viewportSize={viewportSize} onViewportChange={(next) => store().setViewport(next)} />}
        <CanvasToolbar
          onInsertMedia={() => setMediaModalOpen(true)}
          tool={tool}
          onToolChange={(nextTool) => store().setTool(nextTool)}
          scale={viewport.k}
          onScaleChange={(nextScale) => store().setViewport(setZoomScale(viewport, nextScale, viewportSize))}
          onReset={() => store().setViewport(resetViewport(viewportSize))}
          isMiniMapOpen={minimapOpen}
          onToggleMiniMap={() => store().setMinimapOpen(!minimapOpen)}
          background={background}
          onBackgroundChange={(nextBackground) => store().setBackground(nextBackground)}
        />
      </div>
      {conflictNotice && (
        <div className="canvas-conflict-notice" role="alert">
          <span>画布已在其他窗口被修改，已载入最新版本；此前的本地改动被覆盖。</span>
          <button type="button" aria-label="关闭提示" onClick={() => setConflictNotice(false)}><X /></button>
        </div>
      )}
      <CanvasMediaInsertModal
        open={mediaModalOpen}
        canvasId={canvasId}
        onClose={() => setMediaModalOpen(false)}
        onInserted={(node) => {
          store().addNode(node);
          store().setSelection([node.id]);
        }}
      />
    </div>
  );
}
