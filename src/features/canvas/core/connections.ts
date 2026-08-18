/**
 * 连线几何与命中判定（纯函数）。
 * 移植自 infinite-canvas（MIT）canvas-connections.tsx / project.tsx：
 * 贝塞尔路径（曲率 max(dx*0.5, 50)）、40px 命中半径、节点外扩 32px、优先级 内部 < 把手 < 外扩。
 */
import type { CanvasConnection, CanvasNode, ConnectionHandle, CanvasPosition } from "../canvas-types";
import { getConnectionTargetAnchor, normalizeConnection } from "./geometry";

export const CONNECTION_HANDLE_HIT_RADIUS = 40;
export const CONNECTION_NODE_HIT_PADDING = 32;

export type ConnectionDropTarget = { nodeId: string | null; isNearNode: boolean };

/** 贝塞尔连线路径 */
export const connectionPathD = (from: CanvasNode, to: CanvasNode): string => {
  const startX = from.position.x + from.width;
  const startY = from.position.y + from.height / 2;
  const endX = to.position.x;
  const endY = to.position.y + to.height / 2;
  const dx = Math.abs(endX - startX);
  const curvature = Math.max(dx * 0.5, 50);
  return "M " + startX + " " + startY + " C " + (startX + curvature) + " " + startY + ", " + (endX - curvature) + " " + endY + ", " + endX + " " + endY;
};

/** 拖拽中的虚线预览路径（吸附目标时端点贴合） */
export const activeConnectionPathD = (node: CanvasNode | undefined, handle: ConnectionHandle, mouseWorld: CanvasPosition, target?: CanvasNode): string | null => {
  if (!node) return null;
  const startX = handle.handleType === "source" ? node.position.x + node.width : mouseWorld.x;
  const startY = handle.handleType === "source" ? node.position.y + node.height / 2 : mouseWorld.y;
  const endX = handle.handleType === "source" ? mouseWorld.x : node.position.x;
  const endY = handle.handleType === "source" ? mouseWorld.y : node.position.y + node.height / 2;
  const snappedStartX = handle.handleType === "target" && target ? target.position.x + target.width : startX;
  const snappedStartY = handle.handleType === "target" && target ? target.position.y + target.height / 2 : startY;
  const snappedEndX = handle.handleType === "source" && target ? target.position.x : endX;
  const snappedEndY = handle.handleType === "source" && target ? target.position.y + target.height / 2 : endY;
  const distance = Math.abs(snappedEndX - snappedStartX);
  return "M " + snappedStartX + " " + snappedStartY + " C " + (snappedStartX + distance * 0.5) + " " + snappedStartY + ", " + (snappedEndX - distance * 0.5) + " " + snappedEndY + ", " + snappedEndX + " " + snappedEndY;
};

/** 连线落点判定：世界坐标下寻找可连接节点（self/分组/非法方向排除；优先级：节点内部 > 把手命中 > 外扩区） */
export const getConnectionDropTarget = (world: CanvasPosition, current: ConnectionHandle, nodes: CanvasNode[], scale: number): ConnectionDropTarget => {
  const safeScale = Math.max(scale, 0.05);
  const padding = CONNECTION_NODE_HIT_PADDING / safeScale;
  const handleRadius = CONNECTION_HANDLE_HIT_RADIUS / safeScale;
  let isNearNode = false;
  let bestNodeId: string | null = null;
  let bestPriority = Number.POSITIVE_INFINITY;

  [...nodes]
    .reverse()
    .forEach((node) => {
      const anchor = getConnectionTargetAnchor(node, current);
      const dx = world.x - anchor.x;
      const dy = world.y - anchor.y;
      const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
      const hitsInside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
      const hitsExpanded = world.x >= node.position.x - padding && world.x <= node.position.x + node.width + padding && world.y >= node.position.y - padding && world.y <= node.position.y + node.height + padding;

      if (!hitsHandle && !hitsInside && !hitsExpanded) return;
      isNearNode = true;
      if (node.id === current.nodeId || !normalizeConnection(current.nodeId, node.id, nodes, current.handleType)) return;

      const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
      if (priority < bestPriority) {
        bestNodeId = node.id;
        bestPriority = priority;
      }
    });

  return { nodeId: bestNodeId, isNearNode };
};

/** 与某节点直接相连的节点 id 集合（hover 关联高亮） */
export const getRelatedNodeIds = (nodeId: string, connections: CanvasConnection[]): Set<string> => {
  const related = new Set<string>();
  connections.forEach((connection) => {
    if (connection.fromNodeId === nodeId) related.add(connection.toNodeId);
    if (connection.toNodeId === nodeId) related.add(connection.fromNodeId);
  });
  return related;
};
