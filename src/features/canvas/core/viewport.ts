/**
 * 视口坐标转换（纯函数）。
 * 移植自 infinite-canvas（MIT）project.tsx / infinite-canvas.tsx 的坐标算法。
 */
import type { CanvasNode, CanvasPosition, CanvasViewportTransform } from "../canvas-types";

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 5;

export const clampScale = (scale: number) => Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);

/** 客户端坐标 → 画布世界坐标 */
export const screenToCanvas = (clientX: number, clientY: number, viewport: CanvasViewportTransform, rect?: DOMRect | { left: number; top: number } | null): CanvasPosition => {
  const localX = clientX - (rect?.left ?? 0);
  const localY = clientY - (rect?.top ?? 0);
  return { x: (localX - viewport.x) / viewport.k, y: (localY - viewport.y) / viewport.k };
};

/** 视口中心对应的世界坐标 */
export const canvasCenter = (viewport: CanvasViewportTransform, viewportSize: { width: number; height: number }): CanvasPosition => ({
  x: (viewportSize.width / 2 - viewport.x) / viewport.k,
  y: (viewportSize.height / 2 - viewport.y) / viewport.k,
});

/** 绕鼠标所在世界点缩放（滚轮缩放）：缩放后该点仍停留在光标下 */
export const zoomAt = (viewport: CanvasViewportTransform, mouseX: number, mouseY: number, nextScale: number): CanvasViewportTransform => {
  const scale = clampScale(nextScale);
  const worldX = (mouseX - viewport.x) / viewport.k;
  const worldY = (mouseY - viewport.y) / viewport.k;
  return { x: mouseX - worldX * scale, y: mouseY - worldY * scale, k: scale };
};

/** 绕视口中心缩放（滑杆/按钮缩放） */
export const setZoomScale = (viewport: CanvasViewportTransform, scale: number, viewportSize: { width: number; height: number }): CanvasViewportTransform => {
  const nextScale = clampScale(scale);
  return {
    x: viewportSize.width / 2 - ((viewportSize.width / 2 - viewport.x) / viewport.k) * nextScale,
    y: viewportSize.height / 2 - ((viewportSize.height / 2 - viewport.y) / viewport.k) * nextScale,
    k: nextScale,
  };
};

/** 重置视口：画布原点居中，100% 缩放 */
export const resetViewport = (viewportSize: { width: number; height: number }): CanvasViewportTransform => ({ x: viewportSize.width / 2, y: viewportSize.height / 2, k: 1 });

/** 聚焦节点的目标视口（k 自适应节点尺寸，上限 1） */
export const focusNodeTarget = (node: CanvasNode, viewportSize: { width: number; height: number }): CanvasViewportTransform => {
  const worldX = node.position.x + node.width / 2;
  const worldY = node.position.y + node.height / 2;
  const k = clampScale(Math.min(Math.min((viewportSize.width * 0.6) / node.width, (viewportSize.height * 0.6) / node.height), 1));
  return { x: viewportSize.width / 2 - worldX * k, y: viewportSize.height / 2 - worldY * k, k };
};

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
