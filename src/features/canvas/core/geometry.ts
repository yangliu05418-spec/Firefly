/**
 * 节点几何算法（纯函数）。
 * 移植自 infinite-canvas（MIT）canvas-node-geometry.ts / canvas-node-size.ts，
 * 裁剪了 Config 节点的特殊规则，保留分组吸附与自连拒绝。
 */
import type { CanvasNode, CanvasPosition, ConnectionHandle } from "../canvas-types";

export type Bounds = { left: number; top: number; right: number; bottom: number };

export const nodeBounds = (nodes: CanvasNode[]): Bounds =>
  nodes.reduce(
    (acc, node) => ({
      left: Math.min(acc.left, node.position.x),
      top: Math.min(acc.top, node.position.y),
      right: Math.max(acc.right, node.position.x + node.width),
      bottom: Math.max(acc.bottom, node.position.y + node.height),
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
  );

/** 寻找拖拽节点的分组吸附目标（顶层分组优先；拖动分组自身或空集合返回 null） */
export const findGroupDropTarget = (movedIds: Set<string>, nodes: CanvasNode[]): CanvasNode | null => {
  if (nodes.some((node) => movedIds.has(node.id) && node.type === "group")) return null;
  const movingNodes = nodes.filter((node) => movedIds.has(node.id) && node.type !== "group");
  if (!movingNodes.length) return null;
  return (
    [...nodes].reverse().find((group) => {
      if (group.type !== "group" || movedIds.has(group.id)) return false;
      return movingNodes.some((node) => {
        const centerX = node.position.x + node.width / 2;
        const centerY = node.position.y + node.height / 2;
        return centerX >= group.position.x && centerX <= group.position.x + group.width && centerY >= group.position.y && centerY <= group.position.y + group.height;
      });
    }) || null
  );
};

/** 将拖拽节点吸附进分组边界内，并写入 groupId 归属 */
export const snapNodesIntoGroup = (movedIds: Set<string>, nodes: CanvasNode[], group: CanvasNode): CanvasNode[] => {
  const movingNodes = nodes.filter((node) => movedIds.has(node.id) && node.type !== "group");
  if (!movingNodes.length) return nodes;
  const pad = 24;
  const bounds = nodeBounds(movingNodes);
  const left = group.position.x + pad;
  const top = group.position.y + pad;
  const right = group.position.x + group.width - pad;
  const bottom = group.position.y + group.height - pad;
  const dx = bounds.right - bounds.left > right - left ? left - bounds.left : bounds.left < left ? left - bounds.left : bounds.right > right ? right - bounds.right : 0;
  const dy = bounds.bottom - bounds.top > bottom - top ? top - bounds.top : bounds.top < top ? top - bounds.top : bounds.bottom > bottom ? bottom - bounds.bottom : 0;
  return nodes.map((node) => {
    if (!movedIds.has(node.id) || node.type === "group") return node;
    return { ...node, position: { x: node.position.x + dx, y: node.position.y + dy }, metadata: { ...node.metadata, groupId: group.id } };
  });
};

/** 按中心点寻找节点当前所在的分组（返回最上层分组 id；不包含自身） */
export const findContainingGroupId = (node: CanvasNode, nodes: CanvasNode[]): string | undefined => {
  const centerX = node.position.x + node.width / 2;
  const centerY = node.position.y + node.height / 2;
  return (
    [...nodes]
      .reverse()
      .find((group) => group.type === "group" && group.id !== node.id && centerX >= group.position.x && centerX <= group.position.x + group.width && centerY >= group.position.y && centerY <= group.position.y + group.height)?.id || undefined
  );
};

/** 连线锚点：source 在右边缘中点，target 在左边缘中点 */
export const getConnectionTargetAnchor = (node: CanvasNode, current: ConnectionHandle): CanvasPosition => ({
  x: current.handleType === "source" ? node.position.x : node.position.x + node.width,
  y: node.position.y + node.height / 2,
});

/** 规范化连线方向：分组不可连线、自连拒绝；方向保持 from → to */
export const normalizeConnection = (firstNodeId: string, secondNodeId: string, nodes: CanvasNode[], _firstHandleType?: "source" | "target"): { fromNodeId: string; toNodeId: string } | null => {
  const first = nodes.find((node) => node.id === firstNodeId);
  const second = nodes.find((node) => node.id === secondNodeId);
  if (!first || !second || first.id === second.id) return null;
  if (first.type === "group" || second.type === "group") return null;
  return { fromNodeId: first.id, toNodeId: second.id };
};

/** 等比缩放尺寸到最大边界内（保留原始比例） */
export const fitNodeSize = (width: number, height: number, maxWidth = 640, maxHeight = 640) => {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const scale = Math.min(1, maxWidth / w, maxHeight / h);
  return { width: w * scale, height: h * scale };
};

/** 按 "宽x高" / "宽:高" 字符串计算适配尺寸；比例越界或无法解析时返回 null */
export const nodeSizeFromRatio = (size: string, baseWidth: number, baseHeight: number): { width: number; height: number } | null => {
  const match = size?.match(/^(\d+)(?:x|:)(\d+)/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  const ratio = width / Math.max(1, height);
  if (ratio < 0.25 || ratio > 4) return { width: baseWidth, height: baseHeight };
  return ratio >= baseWidth / baseHeight ? { width: baseWidth, height: baseWidth / ratio } : { width: baseHeight * ratio, height: baseHeight };
};
