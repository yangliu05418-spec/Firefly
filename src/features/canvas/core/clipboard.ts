/**
 * 复制/粘贴（纯函数）。
 * 移植自 infinite-canvas（MIT）project.tsx copySelectedNodes / pasteCopiedNodes：
 * 复制保留组内连线；粘贴居中、id 全量重映射（含 groupId、connections）、标题追加 " Copy"。
 */
import type { CanvasClipboard, CanvasConnection, CanvasNode, CanvasPosition } from "../canvas-types";
import { nodeBounds } from "./geometry";
import { createNodeId } from "./nodes";

export const copySelection = (nodes: CanvasNode[], connections: CanvasConnection[], selectedIds: Set<string>): CanvasClipboard | null => {
  if (!selectedIds.size) return null;
  const copiedNodes = nodes
    .filter((node) => selectedIds.has(node.id))
    .map((node) => ({
      ...node,
      position: { ...node.position },
      metadata: { ...node.metadata },
    }));
  if (!copiedNodes.length) return null;
  return {
    nodes: copiedNodes,
    connections: connections
      .filter((connection) => selectedIds.has(connection.fromNodeId) && selectedIds.has(connection.toNodeId))
      .map((connection) => ({ ...connection })),
  };
};

/** 粘贴：整体居中到 anchor，id 全量重映射（节点自身、groupId、连线两端），标题追加 " Copy"（幂等） */
export const pasteClipboard = (clipboard: CanvasClipboard, anchor: CanvasPosition): { nodes: CanvasNode[]; connections: CanvasConnection[] } => {
  if (!clipboard.nodes.length) return { nodes: [], connections: [] };

  const bounds = nodeBounds(clipboard.nodes);
  const dx = anchor.x - (bounds.left + bounds.right) / 2;
  const dy = anchor.y - (bounds.top + bounds.bottom) / 2;
  const idMap = new Map<string, string>();
  const nextNodes = clipboard.nodes.map((node) => {
    const id = createNodeId(node.type);
    idMap.set(node.id, id);
    return {
      ...node,
      id,
      title: node.title.endsWith(" Copy") ? node.title : node.title + " Copy",
      position: { x: node.position.x + dx, y: node.position.y + dy },
      metadata: { ...node.metadata },
    };
  });

  const pastedNodes = nextNodes.map((node) => {
    const groupId = node.metadata?.groupId;
    if (!groupId) return node;
    const remapped = idMap.get(groupId);
    if (!remapped) return node;
    return { ...node, metadata: { ...node.metadata, groupId: remapped } };
  });

  const nextConnections = clipboard.connections.flatMap((connection) => {
    const fromNodeId = idMap.get(connection.fromNodeId);
    const toNodeId = idMap.get(connection.toNodeId);
    if (!fromNodeId || !toNodeId) return [];
    return [{ ...connection, id: createNodeId("conn"), fromNodeId, toNodeId }];
  });

  return { nodes: pastedNodes, connections: nextConnections };
};
