/**
 * 画布状态（zustand）。无 persist 中间件——持久化走 /api/canvases（M3 自动保存）。
 * 变更通过不可变更新触发订阅；selection 用数组存储（Set 不可序列化且不利于 diff）。
 */
import { create } from "zustand";
import type { CanvasBackground, CanvasConnection, CanvasDocument, CanvasNode, CanvasPosition, CanvasViewportTransform, ConnectionHandle } from "./canvas-types";

export type CanvasTool = "select" | "pan";

type CanvasStore = {
  document: CanvasDocument;
  selection: string[];
  selectedConnectionId: string | null;
  tool: CanvasTool;
  viewportSize: { width: number; height: number };
  minimapOpen: boolean;
  hoveredNodeId: string | null;
  connecting: ConnectionHandle | null;
  mouseWorld: CanvasPosition | null;
  connectionTargetNodeId: string | null;

  hydrate: (document: CanvasDocument) => void;
  setViewport: (viewport: CanvasViewportTransform) => void;
  setViewportSize: (size: { width: number; height: number }) => void;
  setBackground: (background: CanvasBackground) => void;
  setTool: (tool: CanvasTool) => void;
  setMinimapOpen: (open: boolean) => void;
  setHoveredNodeId: (id: string | null) => void;
  setSelection: (ids: Set<string> | string[]) => void;
  toggleNodeSelection: (nodeId: string, additive: boolean) => void;
  clearSelection: () => void;
  setSelectedConnectionId: (id: string | null) => void;
  setConnecting: (handle: ConnectionHandle | null) => void;
  setMouseWorld: (world: CanvasPosition | null) => void;
  setConnectionTargetNodeId: (id: string | null) => void;

  addNode: (node: CanvasNode) => void;
  updateNode: (nodeId: string, patch: Partial<CanvasNode>) => void;
  moveNodes: (positions: Map<string, CanvasPosition>) => void;
  updateNodes: (updater: (nodes: CanvasNode[]) => CanvasNode[]) => void;
  removeNodes: (ids: Set<string>) => void;
  addConnection: (connection: CanvasConnection) => void;
  removeConnection: (id: string) => void;
};

const toSet = (ids: Set<string> | string[]) => (ids instanceof Set ? ids : new Set(ids));

export const useCanvasStore = create<CanvasStore>((set) => ({
  document: { version: 1, viewport: { x: 0, y: 0, k: 1 }, background: "dots", nodes: [], connections: [] },
  selection: [],
  selectedConnectionId: null,
  tool: "select",
  viewportSize: { width: 0, height: 0 },
  minimapOpen: true,
  hoveredNodeId: null,
  connecting: null,
  mouseWorld: null,
  connectionTargetNodeId: null,

  hydrate: (document) => set({ document: { ...document, nodes: [...document.nodes], connections: [...document.connections] }, selection: [], selectedConnectionId: null, connecting: null, mouseWorld: null, connectionTargetNodeId: null, tool: "select" }),
  setViewport: (viewport) => set((state) => ({ document: { ...state.document, viewport } })),
  setViewportSize: (viewportSize) => set({ viewportSize }),
  setBackground: (background) => set((state) => ({ document: { ...state.document, background } })),
  setTool: (tool) => set({ tool }),
  setMinimapOpen: (minimapOpen) => set({ minimapOpen }),
  setHoveredNodeId: (hoveredNodeId) => set({ hoveredNodeId }),
  setSelection: (ids) => set({ selection: [...toSet(ids)], selectedConnectionId: null }),
  toggleNodeSelection: (nodeId, additive) =>
    set((state) => {
      const next = new Set(state.selection);
      if (additive) {
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
      } else if (!next.has(nodeId)) {
        next.clear();
        next.add(nodeId);
      }
      return { selection: [...next], selectedConnectionId: null };
    }),
  clearSelection: () => set({ selection: [], selectedConnectionId: null }),
  setSelectedConnectionId: (selectedConnectionId) => set({ selectedConnectionId }),
  setConnecting: (connecting) => set({ connecting, selectedConnectionId: null }),
  setMouseWorld: (mouseWorld) => set({ mouseWorld }),
  setConnectionTargetNodeId: (connectionTargetNodeId) => set({ connectionTargetNodeId }),

  addNode: (node) => set((state) => ({ document: { ...state.document, nodes: [...state.document.nodes, node] } })),
  updateNode: (nodeId, patch) =>
    set((state) => ({ document: { ...state.document, nodes: state.document.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)) } })),
  moveNodes: (positions) =>
    set((state) => ({ document: { ...state.document, nodes: state.document.nodes.map((node) => (positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node)) } })),
  updateNodes: (updater) => set((state) => ({ document: { ...state.document, nodes: updater(state.document.nodes) } })),
  removeNodes: (ids) =>
    set((state) => {
      const removed = toSet(ids);
      const nodes = state.document.nodes.filter((node) => !removed.has(node.id));
      const connections = state.document.connections.filter((connection) => !removed.has(connection.fromNodeId) && !removed.has(connection.toNodeId));
      return { document: { ...state.document, nodes, connections }, selection: state.selection.filter((id) => !removed.has(id)), selectedConnectionId: null };
    }),
  addConnection: (connection) => set((state) => ({ document: { ...state.document, connections: [...state.document.connections, connection] } })),
  removeConnection: (id) =>
    set((state) => ({ document: { ...state.document, connections: state.document.connections.filter((connection) => connection.id !== id) }, selectedConnectionId: state.selectedConnectionId === id ? null : state.selectedConnectionId })),
}));
