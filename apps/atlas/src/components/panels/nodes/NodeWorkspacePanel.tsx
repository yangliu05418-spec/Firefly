import { useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { getCategoriesWithEffects } from '../../../effects';
import type { NodeGraphLayout } from '../../../services/nodeGraph';
import { useDockStore } from '../../../stores/dockStore';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { useTimelineStore } from '../../../stores/timeline';
import { NodeGraphCanvas } from './NodeGraphCanvas';
import { NodeContextMenu } from './workspace/NodeContextMenu';
import { NodeInspector } from './workspace/NodeWorkspaceInspector';
import {
  canDeleteNodeFromClip,
  clampNodeWorkspaceInspectorWidth,
  NODE_WORKSPACE_INSPECTOR_DEFAULT_WIDTH,
  NODE_WORKSPACE_INSPECTOR_WIDTH_KEY,
} from './workspace/nodeWorkspaceUtils';
import { useNodeGraphSubject } from './useNodeGraphSubject';
import './NodeWorkspacePanel.css';

interface NodeWorkspaceContextMenuState {
  x: number;
  y: number;
  layout: NodeGraphLayout;
  nodeId?: string | null;
}

export function NodeWorkspacePanel() {
  const subject = useNodeGraphSubject();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const moveClipNodeGraphNode = useTimelineStore((state) => state.moveClipNodeGraphNode);
  const showClipNodeGraphBuiltIn = useTimelineStore((state) => state.showClipNodeGraphBuiltIn);
  const connectClipNodeGraphPorts = useTimelineStore((state) => state.connectClipNodeGraphPorts);
  const disconnectClipNodeGraphEdge = useTimelineStore((state) => state.disconnectClipNodeGraphEdge);
  const removeClipNodeGraphNode = useTimelineStore((state) => state.removeClipNodeGraphNode);
  const setClipEffectEnabled = useTimelineStore((state) => state.setClipEffectEnabled);
  const updateClipAICustomNode = useTimelineStore((state) => state.updateClipAICustomNode);
  const addClipEffect = useTimelineStore((state) => state.addClipEffect);
  const addClipAICustomNode = useTimelineStore((state) => state.addClipAICustomNode);
  const effectCategories = useMemo(() => getCategoriesWithEffects(), []);
  const [contextMenu, setContextMenu] = useState<NodeWorkspaceContextMenuState | null>(null);
  const [selection, setSelection] = useState<{ graphId: string | null; nodeId: string | null }>({
    graphId: null,
    nodeId: null,
  });
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    if (typeof window === 'undefined') {
      return NODE_WORKSPACE_INSPECTOR_DEFAULT_WIDTH;
    }
    const storedWidth = Number(window.localStorage.getItem(NODE_WORKSPACE_INSPECTOR_WIDTH_KEY));
    return Number.isFinite(storedWidth)
      ? clampNodeWorkspaceInspectorWidth(storedWidth, window.innerWidth)
      : NODE_WORKSPACE_INSPECTOR_DEFAULT_WIDTH;
  });
  const selectedNodeId = selection.graphId === subject?.graph.id
    ? selection.nodeId
    : subject?.graph.nodes[0]?.id ?? null;

  const selectedNode = useMemo(() => {
    if (!subject) return null;
    return subject.graph.nodes.find((node) => node.id === selectedNodeId) ?? subject.graph.nodes[0] ?? null;
  }, [selectedNodeId, subject]);
  const contextMenuNode = useMemo(() => {
    if (!subject || !contextMenu?.nodeId) return null;
    return subject.graph.nodes.find((node) => node.id === contextMenu.nodeId) ?? null;
  }, [contextMenu?.nodeId, subject]);

  const selectNode = useCallback((nodeId: string) => {
    setSelection({
      graphId: subject?.graph.id ?? null,
      nodeId,
    });
  }, [subject?.graph.id]);

  const openProperties = useCallback(() => {
    useDockStore.getState().activatePanelType('clip-properties');
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const startInspectorResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const panelRect = panelRef.current?.getBoundingClientRect();
    const panelRight = panelRect?.right ?? window.innerWidth;
    const panelWidth = panelRect?.width ?? window.innerWidth;

    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: MouseEvent) => {
      const nextWidth = clampNodeWorkspaceInspectorWidth(panelRight - moveEvent.clientX, panelWidth);
      setInspectorWidth(nextWidth);
      window.localStorage.setItem(NODE_WORKSPACE_INSPECTOR_WIDTH_KEY, String(Math.round(nextWidth)));
    };

    const handleUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, []);

  const addBuiltInNode = useCallback((node: 'transform' | 'mask' | 'color') => {
    if (!subject || subject.kind !== 'clip') return;
    startBatch('Add built-in node');
    try {
      showClipNodeGraphBuiltIn(subject.id, node);
      if (contextMenu) {
        moveClipNodeGraphNode(subject.id, node, contextMenu.layout);
      }
      selectNode(node);
    } finally {
      endBatch();
      closeContextMenu();
    }
  }, [closeContextMenu, contextMenu, moveClipNodeGraphNode, selectNode, showClipNodeGraphBuiltIn, subject]);

  const addEffectNode = useCallback((effectType: string) => {
    if (!subject || subject.kind !== 'clip') return;
    startBatch('Add effect node');
    try {
      const effectId = addClipEffect(subject.id, effectType);
      const nodeId = `effect-${effectId}`;
      if (contextMenu) {
        moveClipNodeGraphNode(subject.id, nodeId, contextMenu.layout);
      }
      selectNode(nodeId);
    } finally {
      endBatch();
      closeContextMenu();
    }
  }, [addClipEffect, closeContextMenu, contextMenu, moveClipNodeGraphNode, selectNode, subject]);

  const addAICustomNode = useCallback(() => {
    if (!subject || subject.kind !== 'clip') return;
    startBatch('Add AI node');
    try {
      const nodeId = addClipAICustomNode(subject.id);
      if (nodeId) {
        if (contextMenu) {
          moveClipNodeGraphNode(subject.id, nodeId, contextMenu.layout);
        }
        selectNode(nodeId);
      }
    } finally {
      endBatch();
      closeContextMenu();
    }
  }, [addClipAICustomNode, closeContextMenu, contextMenu, moveClipNodeGraphNode, selectNode, subject]);

  const deleteNode = useCallback((nodeId: string) => {
    if (!subject || subject.kind !== 'clip') return;
    const node = subject.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!canDeleteNodeFromClip(subject.clip, node)) return;

    startBatch('Delete node');
    try {
      removeClipNodeGraphNode(subject.id, nodeId);
      const fallbackNode = subject.graph.nodes.find((candidate) => candidate.id !== nodeId && candidate.kind === 'output') ??
        subject.graph.nodes.find((candidate) => candidate.id !== nodeId) ??
        null;
      setSelection({
        graphId: subject.graph.id,
        nodeId: fallbackNode?.id ?? null,
      });
    } finally {
      endBatch();
      closeContextMenu();
    }
  }, [closeContextMenu, removeClipNodeGraphNode, subject]);

  const moveNode = useCallback((nodeId: string, layout: NodeGraphLayout) => {
    if (!subject || subject.kind !== 'clip') return;
    moveClipNodeGraphNode(subject.id, nodeId, layout);
  }, [moveClipNodeGraphNode, subject]);

  const connectPorts = useCallback((connection: Parameters<typeof connectClipNodeGraphPorts>[1]) => {
    if (!subject || subject.kind !== 'clip') return;
    startBatch('Connect node ports');
    try {
      connectClipNodeGraphPorts(subject.id, connection);
    } finally {
      endBatch();
    }
  }, [connectClipNodeGraphPorts, subject]);

  const disconnectEdge = useCallback((edgeId: string) => {
    if (!subject || subject.kind !== 'clip') return;
    startBatch('Disconnect node link');
    try {
      disconnectClipNodeGraphEdge(subject.id, edgeId);
    } finally {
      endBatch();
    }
  }, [disconnectClipNodeGraphEdge, subject]);

  const toggleNodeBypass = useCallback((nodeId: string) => {
    if (!subject || subject.kind !== 'clip') return;
    const node = subject.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    const targetClipId = typeof node.params?.targetClipId === 'string'
      ? node.params.targetClipId
      : subject.id;

    startBatch('Toggle node bypass');
    try {
      if (node.kind === 'effect' && nodeId.startsWith('effect-')) {
        setClipEffectEnabled(targetClipId, nodeId.slice('effect-'.length), node.params?.enabled === false);
      } else if (node.kind === 'custom') {
        updateClipAICustomNode(subject.id, nodeId, { bypassed: node.params?.bypassed !== true });
      }
    } finally {
      endBatch();
    }
  }, [setClipEffectEnabled, subject, updateClipAICustomNode]);

  if (!subject) {
    return (
      <div className="node-workspace-panel" ref={panelRef}>
        <div className="node-workspace-empty-state">
          <h3>Nodes</h3>
          <p>Select a timeline clip</p>
        </div>
      </div>
    );
  }

  return (
    <div className="node-workspace-panel" ref={panelRef}>
      <div className="node-workspace-main">
        <NodeGraphCanvas
          graph={subject.graph}
          selectedNodeId={selectedNode?.id ?? null}
          onSelectNode={selectNode}
          onMoveNode={moveNode}
          onConnectPorts={connectPorts}
          onDisconnectEdge={disconnectEdge}
          onDeleteNode={deleteNode}
          onToggleNodeBypass={toggleNodeBypass}
          onOpenAddMenu={setContextMenu}
        />
      </div>
      <NodeInspector
        node={selectedNode}
        clip={subject.clip}
        inspectorWidth={inspectorWidth}
        onSelectNode={selectNode}
        onOpenProperties={openProperties}
        onStartResizeInspector={startInspectorResize}
      />
      {contextMenu && subject && (
        <NodeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          targetNode={contextMenuNode}
          canDeleteTarget={canDeleteNodeFromClip(subject.clip, contextMenuNode)}
          canAddVisualBuiltIns={subject.clip.source?.type !== 'audio'}
          effectCategories={effectCategories}
          onClose={closeContextMenu}
          onDeleteNode={() => {
            if (contextMenuNode) {
              deleteNode(contextMenuNode.id);
            }
          }}
          onAddAI={addAICustomNode}
          onAddBuiltIn={addBuiltInNode}
          onAddEffect={addEffectNode}
        />
      )}
    </div>
  );
}
