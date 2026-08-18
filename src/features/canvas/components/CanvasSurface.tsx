/**
 * 画布表面：视口容器 + 网格背景 + 滚轮缩放 + 空格/Ctrl 临时平移 + 中键平移。
 * 移植自 infinite-canvas（MIT）components/canvas/infinite-canvas.tsx（去 antd 排除、主题走 CSS 变量）。
 */
import { useEffect, useRef, useState } from "react";
import type { CanvasBackground, CanvasViewportTransform } from "../canvas-types";
import { clampScale } from "../core/viewport";

type CanvasSurfaceProps = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  viewport: CanvasViewportTransform;
  tool: "select" | "pan";
  backgroundMode?: CanvasBackground;
  onViewportChange: (viewport: CanvasViewportTransform) => void;
  onCanvasMouseDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onCanvasDeselect?: () => void;
  onCanvasDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
};

/** 命中交互元素（媒体播放器等）时不响应画布手势 */
const isInteractiveTarget = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("[data-canvas-no-zoom]"));
};

export function CanvasSurface({ containerRef, viewport, tool, backgroundMode = "lines", onViewportChange, onCanvasMouseDown, onCanvasDeselect, onCanvasDoubleClick, onContextMenu, onDrop, children }: CanvasSurfaceProps) {
  const panState = useRef({ isPanning: false, startX: 0, startY: 0, initialX: 0, initialY: 0, hasMoved: false, startedOnBackground: false });
  const scaleRef = useRef(viewport.k);
  const frameRef = useRef<number | null>(null);
  const nextViewportRef = useRef<CanvasViewportTransform | null>(null);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isControlPressed, setIsControlPressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  useEffect(() => {
    scaleRef.current = viewport.k;
  }, [viewport.k]);

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Control") setIsControlPressed(true);
      if (event.code !== "Space") return;
      if (isInteractiveTarget(event.target)) return;
      event.preventDefault();
      setIsSpacePressed(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        if (!isInteractiveTarget(event.target)) event.preventDefault();
        setIsSpacePressed(false);
      }
      if (event.key === "Control") setIsControlPressed(false);
    };
    const handleBlur = () => {
      setIsSpacePressed(false);
      setIsControlPressed(false);
      panState.current.isPanning = false;
      setIsPanning(false);
      document.body.style.cursor = "";
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target)) return;
    const delta = -event.deltaY;
    const factor = Math.pow(1.1, delta / 100);
    const newScale = clampScale(viewport.k * factor);
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const worldX = (mouseX - viewport.x) / viewport.k;
    const worldY = (mouseY - viewport.y) / viewport.k;
    onViewportChange({ x: mouseX - worldX * newScale, y: mouseY - worldY * newScale, k: newScale });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target)) return;
    const target = event.target instanceof Element ? event.target : null;
    const isBackgroundClick = !target?.closest("[data-node-id],[data-connection-id]");
    const temporaryTool = event.ctrlKey || isSpacePressed;
    const activeTool = temporaryTool ? (tool === "select" ? "pan" : "select") : tool;
    const shouldPan = event.button === 1 || (event.button === 0 && activeTool === "pan");

    if (shouldPan) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panState.current = { isPanning: true, startX: event.clientX, startY: event.clientY, initialX: viewport.x, initialY: viewport.y, hasMoved: false, startedOnBackground: isBackgroundClick };
      setIsPanning(true);
      document.body.style.cursor = "grabbing";
      return;
    }

    if (event.button === 0 && isBackgroundClick) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      onCanvasMouseDown?.(event);
    }
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-node-id],[data-connection-id]")) return;
    onCanvasDoubleClick?.(event);
  };

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!panState.current.isPanning) return;
      const dx = event.clientX - panState.current.startX;
      const dy = event.clientY - panState.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panState.current.hasMoved = true;
      nextViewportRef.current = { x: panState.current.initialX + dx, y: panState.current.initialY + dy, k: scaleRef.current };
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        if (nextViewportRef.current) onViewportChange(nextViewportRef.current);
      });
    };
    const handlePointerUp = () => {
      if (!panState.current.isPanning) return;
      if (!panState.current.hasMoved && panState.current.startedOnBackground) onCanvasDeselect?.();
      panState.current.isPanning = false;
      setIsPanning(false);
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      document.body.style.cursor = "";
    };
  }, [onCanvasDeselect, onViewportChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const preventWheelScroll = (event: WheelEvent) => {
      if (isInteractiveTarget(event.target)) return;
      event.preventDefault();
    };
    container.addEventListener("wheel", preventWheelScroll, { passive: false });
    return () => container.removeEventListener("wheel", preventWheelScroll);
  }, [containerRef]);

  const temporaryTool = isControlPressed || isSpacePressed;
  const activeTool = temporaryTool ? (tool === "select" ? "pan" : "select") : tool;
  const cursor = isPanning ? "grabbing" : activeTool === "pan" ? "grab" : undefined;

  return (
    <div
      ref={containerRef}
      className="canvas-surface"
      style={{ cursor }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onWheel={handleWheel}
      onContextMenu={onContextMenu}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <CanvasGrid viewport={viewport} mode={backgroundMode} />
      <div
        className="canvas-surface__world"
        style={{
          transform: "translate(" + viewport.x + "px, " + viewport.y + "px) scale(" + viewport.k + ")",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function CanvasGrid({ viewport, mode }: { viewport: CanvasViewportTransform; mode: CanvasBackground }) {
  if (mode === "blank") return null;
  const gridSize = 48 * viewport.k;
  const x = viewport.x % gridSize;
  const y = viewport.y % gridSize;
  const dotSize = viewport.k < 0.12 ? 0.8 : 1.15;
  const backgroundImage =
    mode === "dots"
      ? "radial-gradient(circle, var(--canvas-dot) " + dotSize + "px, transparent " + (dotSize + 0.2) + "px)"
      : "linear-gradient(var(--canvas-line) 1px, transparent 1px), linear-gradient(90deg, var(--canvas-line) 1px, transparent 1px)";
  return <div className="canvas-surface__grid" style={{ backgroundImage, backgroundSize: gridSize + "px " + gridSize + "px", backgroundPosition: x + "px " + y + "px" }} />;
}
