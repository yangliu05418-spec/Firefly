/**
 * 拖拽交互状态机（纯函数）。
 * 移植自 infinite-canvas（MIT）project.tsx 的 handleNodeMouseDown / handleGlobalMouseMove / finishNodeDrag：
 * 分组子节点跟随、3px 拖拽阈值、rAF 节流位置更新、松手时分组吸附与归属更新。
 */
import type { CanvasNode, CanvasPosition } from "../canvas-types";
import { findContainingGroupId, findGroupDropTarget, snapNodesIntoGroup } from "./geometry";

export const DRAG_THRESHOLD_PX = 3;

export type DragSession = {
  hasMoved: boolean;
  startX: number;
  startY: number;
  dragIds: Set<string>;
  initialPositions: Map<string, CanvasPosition>;
};

/** 由选中集构建拖拽会话：选中的分组会带上其所有子节点 */
export const buildDragSession = (selectedIds: Set<string>, nodes: CanvasNode[], startX: number, startY: number): DragSession | null => {
  if (!selectedIds.size) return null;
  const dragIds = new Set(selectedIds);
  nodes.forEach((node) => {
    if (!selectedIds.has(node.id) || node.type !== "group") return;
    nodes.forEach((child) => {
      if (child.metadata.groupId === node.id) dragIds.add(child.id);
    });
  });
  const initialPositions = new Map<string, CanvasPosition>();
  nodes.forEach((node) => {
    if (dragIds.has(node.id)) initialPositions.set(node.id, { ...node.position });
  });
  return { hasMoved: false, startX, startY, dragIds, initialPositions };
};

export const isDragThresholdExceeded = (session: DragSession, clientX: number, clientY: number) => Math.abs(clientX - session.startX) > DRAG_THRESHOLD_PX || Math.abs(clientY - session.startY) > DRAG_THRESHOLD_PX;

/** 计算世界坐标偏移（缩放感知） */
export const dragOffset = (session: DragSession, clientX: number, clientY: number, scale: number) => ({
  dx: (clientX - session.startX) / scale,
  dy: (clientY - session.startY) / scale,
});

/** 应用拖拽偏移到节点集合（仅移动会话中的节点） */
export const applyDragPositions = (nodes: CanvasNode[], initialPositions: Map<string, CanvasPosition>, dx: number, dy: number): CanvasNode[] =>
  nodes.map((node) => {
    const initial = initialPositions.get(node.id);
    return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
  });

/** 松手结算：由初始位置重算最终位置（与实时拖拽结果一致），再尝试吸附进分组，否则更新 containing group 归属 */
export const resolveDragDrop = (nodes: CanvasNode[], movedIds: Set<string>, initialPositions: Map<string, CanvasPosition>, dx: number, dy: number): { nodes: CanvasNode[]; dropTargetGroupId: string | null } => {
  const moved = applyDragPositions(nodes, initialPositions, dx, dy);
  const targetGroup = findGroupDropTarget(movedIds, moved);
  if (targetGroup) return { nodes: snapNodesIntoGroup(movedIds, moved, targetGroup), dropTargetGroupId: targetGroup.id };
  return {
    nodes: moved.map((node) => {
      if (!movedIds.has(node.id) || node.type === "group") return node;
      const groupId = findContainingGroupId(node, moved);
      if (node.metadata.groupId === groupId) return node;
      return { ...node, metadata: { ...node.metadata, groupId } };
    }),
    dropTargetGroupId: null,
  };
};
