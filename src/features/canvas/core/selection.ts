/**
 * 框选与多选集合运算（纯函数）。
 * 移植自 infinite-canvas（MIT）project.tsx 的框选判定（AABB 相交）。
 */
import type { CanvasNode } from "../canvas-types";

export type BoxRect = { x: number; y: number; width: number; height: number };

/** AABB 相交判定（含贴边） */
export const nodeIntersectsBox = (node: CanvasNode, rect: BoxRect): boolean =>
  rect.x < node.position.x + node.width && rect.x + rect.width > node.position.x && rect.y < node.position.y + node.height && rect.y + rect.height > node.position.y;

/** 框选集合：additive（shift）时保留初始选中集，否则从空集开始 */
export const selectNodesInBox = (nodes: CanvasNode[], rect: BoxRect, additive: boolean, initialSelectedNodeIds: string[]): Set<string> => {
  const nextSelected = new Set<string>(additive ? initialSelectedNodeIds : []);
  nodes.forEach((node) => {
    if (nodeIntersectsBox(node, rect)) nextSelected.add(node.id);
  });
  return nextSelected;
};

/** 点击选中逻辑：shift/meta/ctrl 切换，否则单选（已在选中集中则保持不变） */
export const toggleNodeSelection = (current: Set<string>, nodeId: string, additive: boolean): Set<string> => {
  const next = new Set(current);
  if (additive) {
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
  } else if (!next.has(nodeId)) {
    next.clear();
    next.add(nodeId);
  }
  return next;
};

/** 拖拽 vs 点击判定：位移超过阈值视为拖拽 */
export const isDragMoved = (startX: number, startY: number, currentX: number, currentY: number, threshold = 3): boolean => Math.abs(currentX - startX) > threshold || Math.abs(currentY - startY) > threshold;

/** 由两个世界坐标点构造框选矩形（支持任意拖拽方向） */
export const boxRectFromPoints = (startX: number, startY: number, currentX: number, currentY: number): BoxRect => ({
  x: Math.min(startX, currentX),
  y: Math.min(startY, currentY),
  width: Math.abs(currentX - startX),
  height: Math.abs(currentY - startY),
});
