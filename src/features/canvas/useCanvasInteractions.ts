/**
 * 画布交互接线：节点拖拽（分组跟随/吸附）、框选、连线创建、剪贴板、撤销/重做、快捷键。
 * 移植自 infinite-canvas（MIT）project.tsx 的交互编排；状态读取走 zustand（事件处理器内 getState 免闭包过期）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { useCanvasStore } from "./canvas-store";
import type { CanvasClipboard, CanvasHistoryEntry, CanvasNode, CanvasPosition, ConnectionHandle, SelectionBox } from "./canvas-types";
import { canvasCenter, screenToCanvas } from "./core/viewport";
import { boxRectFromPoints, selectNodesInBox, toggleNodeSelection } from "./core/selection";
import { createHistory, historyPush, type HistoryState } from "./core/history";
import { copySelection, pasteClipboard } from "./core/clipboard";
import { getConnectionDropTarget, getRelatedNodeIds } from "./core/connections";
import { findGroupDropTarget, normalizeConnection } from "./core/geometry";
import { createCanvasNode } from "./core/nodes";
import { applyDragPositions, buildDragSession, dragOffset, isDragThresholdExceeded, resolveDragDrop, type DragSession } from "./core/interactions";
import { isEditableTarget, isImeComposing } from "./core/keyboard";

export type CanvasInteractionHandlers = {
  onCanvasMouseDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onCanvasDeselect: () => void;
  onCanvasDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onNodeMouseDown: (event: React.MouseEvent, nodeId: string) => void;
  onNodeSelectCapture: (event: React.MouseEvent, nodeId: string) => void;
  onNodeHoverStart: (nodeId: string) => void;
  onNodeHoverEnd: () => void;
  onNodeConnectStart: (event: React.MouseEvent, nodeId: string, handleType: "source" | "target") => void;
  onNodeResizeStart: (nodeId: string) => void;
  onNodeResize: (nodeId: string, width: number, height: number, position?: CanvasPosition) => void;
  onNodeResizeEnd: (nodeId: string) => void;
  onNodeContentChange: (nodeId: string, content: string) => void;
  onNodeTitleChange: (nodeId: string, title: string) => void;
};

export function useCanvasInteractions({ surfaceRef }: { surfaceRef: React.RefObject<HTMLDivElement | null> }) {
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const selectionBoxRef = useRef<SelectionBox | null>(null);
  const historyRef = useRef<HistoryState<CanvasHistoryEntry>>(createHistory());
  const lastHistoryRef = useRef<CanvasHistoryEntry | null>(null);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyPausedRef = useRef(false);
  const applyingHistoryRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const pendingSelectionRef = useRef<Set<string> | null>(null);
  const clipboardRef = useRef<CanvasClipboard | null>(null);
  const store = useCanvasStore;

  /** 重置历史（载入新文档时调用） */
  const resetHistory = useCallback(() => {
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = null;
    historyRef.current = createHistory();
    lastHistoryRef.current = { nodes: store.getState().document.nodes, connections: store.getState().document.connections, background: store.getState().document.background };
    applyingHistoryRef.current = false;
    historyPausedRef.current = false;
  }, [store]);

  const createHistoryEntry = useCallback((): CanvasHistoryEntry => {
    const { document } = store.getState();
    return { nodes: document.nodes, connections: document.connections, background: document.background };
  }, [store]);

  /** 文档变更后调用：180ms 防抖把"变更前快照"压入 past */
  const scheduleHistoryCommit = useCallback(() => {
    if (applyingHistoryRef.current || historyPausedRef.current) return;
    const previous = lastHistoryRef.current;
    const current = createHistoryEntry();
    if (!previous) {
      lastHistoryRef.current = current;
      return;
    }
    if (previous.nodes === current.nodes && previous.connections === current.connections && previous.background === current.background) return;
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      historyTimerRef.current = null;
      historyRef.current = historyPush(historyRef.current, previous);
      lastHistoryRef.current = createHistoryEntry();
    }, 180);
  }, [createHistoryEntry, store]);

  // 订阅文档变更触发历史提交（跳过渲染循环内重复提交）
  const nodes = store((state) => state.document.nodes);
  const connections = store((state) => state.document.connections);
  const background = store((state) => state.document.background);
  useEffect(() => {
    scheduleHistoryCommit();
  }, [nodes, connections, background, scheduleHistoryCommit]);

  const applyHistory = useCallback(
    (entry: CanvasHistoryEntry) => {
      if (historyTimerRef.current) {
        clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
      applyingHistoryRef.current = true;
      store.getState().replaceSnapshot(entry.nodes, entry.connections, entry.background);
      store.getState().clearSelection();
      store.getState().setHoveredNodeId(null);
      setTimeout(() => {
        lastHistoryRef.current = entry;
        applyingHistoryRef.current = false;
      });
    },
    [store],
  );

  const undoCanvas = useCallback(() => {
    const previous = historyRef.current.past[historyRef.current.past.length - 1];
    const current = lastHistoryRef.current;
    if (!previous || !current) return;
    historyRef.current = { past: historyRef.current.past.slice(0, -1), future: [...historyRef.current.future, current] };
    applyHistory(previous);
  }, [applyHistory]);

  const redoCanvas = useCallback(() => {
    const next = historyRef.current.future[historyRef.current.future.length - 1];
    const current = lastHistoryRef.current;
    if (!next || !current) return;
    historyRef.current = { past: [...historyRef.current.past, current], future: historyRef.current.future.slice(0, -1) };
    applyHistory(next);
  }, [applyHistory]);

  // ---------- 节点拖拽 ----------
  const handleNodeMouseDown = useCallback(
    (event: React.MouseEvent, nodeId: string) => {
      event.stopPropagation();
      const state = store.getState();
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      const nextSelected = pendingSelectionRef.current ?? toggleNodeSelection(new Set(state.selection), nodeId, additive);
      pendingSelectionRef.current = null;
      const session = buildDragSession(nextSelected, state.document.nodes, event.clientX, event.clientY);
      if (!session) return;
      dragRef.current = session;
      historyPausedRef.current = true;
    },
    [store],
  );

  const finishNodeDrag = useCallback(
    (clientX?: number, clientY?: number) => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const drag = dragRef.current;
      if (!drag) return;
      const state = store.getState();
      historyPausedRef.current = false;
      setDropTargetGroupId(null);
      if (drag.hasMoved && clientX !== undefined && clientY !== undefined) {
        const { dx, dy } = dragOffset(drag, clientX, clientY, state.document.viewport.k);
        const movedIds = new Set(drag.initialPositions.keys());
        const result = resolveDragDrop(state.document.nodes, movedIds, drag.initialPositions, dx, dy);
        store.getState().updateNodes(() => result.nodes);
        setDropTargetGroupId(null);
      }
      dragRef.current = null;
    },
    [store],
  );

  // ---------- 框选 ----------
  const handleCanvasMouseDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const state = store.getState();
      state.setHoveredNodeId(null);
      state.setSelectedConnectionId(null);
      const rect = surfaceRef.current?.getBoundingClientRect();
      const world = screenToCanvas(event.clientX, event.clientY, state.document.viewport, rect);
      const nextBox: SelectionBox = { startWorldX: world.x, startWorldY: world.y, currentWorldX: world.x, currentWorldY: world.y, additive: event.shiftKey, initialSelectedNodeIds: event.shiftKey ? [...state.selection] : [] };
      selectionBoxRef.current = nextBox;
      setSelectionBox(nextBox);
      if (!event.shiftKey) state.clearSelection();
    },
    [store, surfaceRef],
  );

  const handleCanvasDeselect = useCallback(() => {
    store.getState().clearSelection();
  }, [store]);

  // ---------- 连线 ----------
  const handleNodeConnectStart = useCallback(
    (event: React.MouseEvent, nodeId: string, handleType: "source" | "target") => {
      event.stopPropagation();
      const state = store.getState();
      const rect = surfaceRef.current?.getBoundingClientRect();
      state.setMouseWorld(screenToCanvas(event.clientX, event.clientY, state.document.viewport, rect));
      state.setConnecting({ nodeId, handleType });
      state.setConnectionTargetNodeId(null);
    },
    [store, surfaceRef],
  );

  const connectNodes = useCallback(
    (current: ConnectionHandle, targetNodeId: string) => {
      if (current.nodeId === targetNodeId) return;
      const state = store.getState();
      const connection = normalizeConnection(current.nodeId, targetNodeId, state.document.nodes, current.handleType);
      if (!connection) return;
      const exists = state.document.connections.some((item) => item.fromNodeId === connection.fromNodeId && item.toNodeId === connection.toNodeId);
      if (!exists) state.addConnection({ id: "conn-" + nanoid(10), ...connection });
    },
    [store],
  );

  // ---------- 剪贴板 ----------
  const copySelected = useCallback(() => {
    const state = store.getState();
    const clipboard = copySelection(state.document.nodes, state.document.connections, new Set(state.selection));
    if (clipboard) clipboardRef.current = clipboard;
  }, [store]);

  const pasteCopiedNodes = useCallback(() => {
    const clipboard = clipboardRef.current;
    if (!clipboard?.nodes.length) return false;
    const state = store.getState();
    const center = canvasCenter(state.document.viewport, state.viewportSize);
    const pasted = pasteClipboard(clipboard, center);
    state.updateNodes((nodes) => [...nodes, ...pasted.nodes]);
    pasted.connections.forEach((connection) => state.addConnection(connection));
    state.setSelection(pasted.nodes.map((node) => node.id));
    return true;
  }, [store]);

  const pasteSystemText = useCallback(async () => {
    if (!navigator.clipboard) return;
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (!trimmed) return;
      const state = store.getState();
      const node = createCanvasNode("text", canvasCenter(state.document.viewport, state.viewportSize), { content: trimmed, status: "success" });
      node.title = trimmed.slice(0, 32) || "剪贴板文本";
      state.addNode(node);
      state.setSelection([node.id]);
    } catch {
      // 剪贴板读取被拒绝时静默（用户仍可手动粘贴到文本节点）
    }
  }, [store]);

  // ---------- 删除 ----------
  const deleteSelection = useCallback(() => {
    const state = store.getState();
    if (state.selectedConnectionId) {
      state.removeConnection(state.selectedConnectionId);
      return;
    }
    if (state.selection.length) state.removeNodes(new Set(state.selection));
  }, [store]);

  // ---------- 全局指针事件 ----------
  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const state = store.getState();

      // 拖拽节点
      const drag = dragRef.current;
      if (drag) {
        if (!drag.hasMoved && isDragThresholdExceeded(drag, event.clientX, event.clientY)) drag.hasMoved = true;
        const { dx, dy } = dragOffset(drag, event.clientX, event.clientY, state.document.viewport.k);
        const movedIds = new Set(drag.initialPositions.keys());
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          const current = store.getState();
          const preview = applyDragPositions(current.document.nodes, drag.initialPositions, dx, dy);
          setDropTargetGroupId(findGroupDropTarget(movedIds, preview)?.id ?? null);
          store.getState().updateNodes(() => preview);
        });
        return;
      }

      // 拖拽连线
      const connecting = state.connecting;
      if (connecting) {
        const rect = surfaceRef.current?.getBoundingClientRect();
        const world = screenToCanvas(event.clientX, event.clientY, state.document.viewport, rect);
        const dropTarget = getConnectionDropTarget(world, connecting, state.document.nodes, state.document.viewport.k);
        state.setConnectionTargetNodeId(dropTarget.nodeId);
        state.setMouseWorld(world);
        return;
      }

      // 框选
      const box = selectionBoxRef.current;
      if (box) {
        if (event.buttons === 0) {
          selectionBoxRef.current = null;
          setSelectionBox(null);
          return;
        }
        const rect = surfaceRef.current?.getBoundingClientRect();
        const world = screenToCanvas(event.clientX, event.clientY, state.document.viewport, rect);
        selectionBoxRef.current = { ...box, currentWorldX: world.x, currentWorldY: world.y };
        setSelectionBox(selectionBoxRef.current);
        const rectBox = boxRectFromPoints(box.startWorldX, box.startWorldY, world.x, world.y);
        const nextSelected = selectNodesInBox(state.document.nodes, rectBox, box.additive, box.initialSelectedNodeIds);
        state.setSelection([...nextSelected]);
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      const state = store.getState();
      finishNodeDrag(event.clientX, event.clientY);
      selectionBoxRef.current = null;
      setSelectionBox(null);
      const connecting = state.connecting;
      if (connecting) {
        const rect = surfaceRef.current?.getBoundingClientRect();
        const world = screenToCanvas(event.clientX, event.clientY, state.document.viewport, rect);
        const dropTarget = getConnectionDropTarget(world, connecting, state.document.nodes, state.document.viewport.k);
        if (dropTarget.nodeId) connectNodes(connecting, dropTarget.nodeId);
        state.setConnecting(null);
        state.setConnectionTargetNodeId(null);
        state.setMouseWorld(null);
      }
    };

    const handleBlur = () => {
      finishNodeDrag();
      selectionBoxRef.current = null;
      setSelectionBox(null);
      const state = store.getState();
      if (state.connecting) {
        state.setConnecting(null);
        state.setConnectionTargetNodeId(null);
        state.setMouseWorld(null);
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("blur", handleBlur);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [connectNodes, finishNodeDrag, store, surfaceRef]);

  // ---------- 快捷键 ----------
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (isImeComposing(event)) return;
      const key = event.key.toLowerCase();
      const isModifier = event.metaKey || event.ctrlKey;

      if (isModifier && key === "c" && window.getSelection()?.toString()) return;

      if (isModifier && !event.altKey && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redoCanvas();
        else undoCanvas();
        return;
      }
      if (isModifier && !event.altKey && key === "y") {
        event.preventDefault();
        redoCanvas();
        return;
      }
      if (isModifier && key === "a") {
        event.preventDefault();
        const state = store.getState();
        state.setSelection(state.document.nodes.filter((node) => node.type !== "group").map((node) => node.id));
        return;
      }
      if (isModifier && key === "c") {
        event.preventDefault();
        copySelected();
        return;
      }
      if (isModifier && key === "v") {
        event.preventDefault();
        if (!pasteCopiedNodes()) void pasteSystemText();
        return;
      }
      if (key === "delete" || key === "backspace") {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (key === "escape") {
        const state = store.getState();
        if (state.connecting) {
          state.setConnecting(null);
          state.setConnectionTargetNodeId(null);
          state.setMouseWorld(null);
        }
        state.clearSelection();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [copySelected, deleteSelection, pasteCopiedNodes, pasteSystemText, redoCanvas, store, undoCanvas]);

  // ---------- 节点子事件 ----------
  const handleNodeSelectCapture = useCallback(
    (event: React.MouseEvent, nodeId: string) => {
      if (event.button !== 0) return;
      const state = store.getState();
      state.setHoveredNodeId(null);
      state.setSelectedConnectionId(null);
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      const next = toggleNodeSelection(new Set(state.selection), nodeId, additive);
      pendingSelectionRef.current = next;
      state.setSelection([...next]);
    },
    [store],
  );

  const handleNodeResizeStart = useCallback(() => {
    historyPausedRef.current = true;
  }, []);
  const handleNodeResizeEnd = useCallback(() => {
    historyPausedRef.current = false;
  }, []);

  const handlers: CanvasInteractionHandlers = {
    onCanvasMouseDown: handleCanvasMouseDown,
    onCanvasDeselect: handleCanvasDeselect,
    onCanvasDoubleClick: () => {},
    onNodeMouseDown: handleNodeMouseDown,
    onNodeSelectCapture: handleNodeSelectCapture,
    onNodeHoverStart: (nodeId) => store.getState().setHoveredNodeId(nodeId),
    onNodeHoverEnd: () => store.getState().setHoveredNodeId(null),
    onNodeConnectStart: handleNodeConnectStart,
    onNodeResizeStart: handleNodeResizeStart,
    onNodeResize: (nodeId, width, height, position) => store.getState().updateNode(nodeId, { width, height, ...(position ? { position } : {}) }),
    onNodeResizeEnd: handleNodeResizeEnd,
    onNodeContentChange: (nodeId, content) => {
      const node = store.getState().document.nodes.find((item) => item.id === nodeId);
      store.getState().updateNode(nodeId, { metadata: { ...(node?.metadata ?? {}), content } });
    },
    onNodeTitleChange: (nodeId, title) => store.getState().updateNode(nodeId, { title }),
  };

  return { handlers, selectionBox, dropTargetGroupId, resetHistory, undoCanvas, redoCanvas, getRelatedIds: (nodeId: string) => getRelatedNodeIds(nodeId, store.getState().document.connections) };
}
