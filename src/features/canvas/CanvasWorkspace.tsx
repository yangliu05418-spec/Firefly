/**
 * 画布工作台：接管 /studio/canvas/:id 路由。
 * M2：载入文档 → 渲染视口/网格/节点/连线/小地图/工具栏；交互（选中/重命名/文本编辑/缩放节点）已接线，
 * 拖拽/框选/连线/剪贴板/撤销重做在 M3 接入。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowLeft, LoaderCircle, RefreshCw } from "lucide-react";
import { getCanvas } from "./canvas-api";
import { useCanvasStore } from "./canvas-store";
import { CanvasSurface } from "./components/CanvasSurface";
import { ActiveConnectionPath, ConnectionPath } from "./components/CanvasConnections";
import { CanvasMinimap } from "./components/CanvasMinimap";
import { CanvasNode } from "./components/CanvasNode";
import { CanvasToolbar } from "./components/CanvasToolbar";
import { getRelatedNodeIds } from "./core/connections";
import { resetViewport, setZoomScale } from "./core/viewport";
import { relativeTime } from "./format";

export function CanvasWorkspace({ canvasId, navigate }: { canvasId: string; navigate: (path: string) => void }) {
  const [loadState, setLoadState] = useState<"loading" | "error" | "ready">("loading");
  const [loadError, setLoadError] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
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

  const load = useCallback(async () => {
    setLoadState("loading");
    setLoadError("");
    try {
      const project = await getCanvas(canvasId);
      if (!project.document) throw new Error("画布文档无法解析");
      useCanvasStore.getState().hydrate(project.document);
      setProjectTitle(project.title);
      setProjectUpdatedAt(project.updatedAt);
      setLoadState("ready");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "画布暂时无法载入");
      setLoadState("error");
    }
  }, [canvasId]);

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

  const relatedIds = useMemo(() => (hoveredNodeId ? getRelatedNodeIds(hoveredNodeId, connections) : new Set<string>()), [hoveredNodeId, connections]);
  const selectedSet = useMemo(() => new Set(selection), [selection]);

  const store = useCanvasStore.getState;

  const handleNodeMouseDown = useCallback((event: React.MouseEvent, nodeId: string) => {
    event.stopPropagation();
    // M3：拖拽。M2 仅确保选中态稳定。
  }, []);

  const handleNodeSelectCapture = useCallback(
    (event: React.MouseEvent, nodeId: string) => {
      if (event.button !== 0) return;
      store().setHoveredNodeId(null);
      store().toggleNodeSelection(nodeId, event.shiftKey || event.metaKey || event.ctrlKey);
    },
    [store],
  );

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
        <div className="canvas-workspace__save" data-status="loaded">已载入 · 自动保存即将接入</div>
      </header>
      <div className="canvas-workspace__body" ref={surfaceRef}>
        <CanvasSurface
          containerRef={surfaceRef}
          viewport={viewport}
          tool={tool}
          backgroundMode={background}
          onViewportChange={(next) => store().setViewport(next)}
          onCanvasMouseDown={() => store().clearSelection()}
          onCanvasDeselect={() => store().clearSelection()}
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
                />
              );
            })}
          </svg>
          {nodes.map((node) => (
            <CanvasNode
              key={node.id}
              node={node}
              scale={viewport.k}
              isSelected={selectedSet.has(node.id)}
              isRelated={relatedIds.has(node.id)}
              isConnectionTarget={false}
              isConnecting={false}
              groupChildCount={node.type === "group" ? nodes.filter((child) => child.metadata.groupId === node.id).length : 0}
              onMouseDown={handleNodeMouseDown}
              onSelectCapture={handleNodeSelectCapture}
              onHoverStart={(nodeId) => store().setHoveredNodeId(nodeId)}
              onHoverEnd={() => store().setHoveredNodeId(null)}
              onResizeStart={() => {}}
              onResize={(nodeId, width, height, position) => store().updateNode(nodeId, { width, height, ...(position ? { position } : {}) })}
              onResizeEnd={() => {}}
              onContentChange={(nodeId, content) => store().updateNode(nodeId, { metadata: { ...nodes.find((n) => n.id === nodeId)?.metadata ?? {}, content } })}
              onTitleChange={(nodeId, title) => store().updateNode(nodeId, { title })}
              onContextMenu={(event) => event.preventDefault()}
            />
          ))}
        </CanvasSurface>
        {minimapOpen && <CanvasMinimap nodes={nodes} viewport={viewport} viewportSize={viewportSize} onViewportChange={(next) => store().setViewport(next)} />}
        <CanvasToolbar
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
    </div>
  );
}
