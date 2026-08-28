import type { PointerEvent, RefObject } from 'react';

import {
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_PADDING,
  GRAPH_NODE_WIDTH,
  getEdgePath,
} from './colorEditorMath';
import type { ColorEditorEdge, ColorEditorNode, ConnectionDragState } from './colorEditorTypes';

interface ColorGraphViewProps {
  canvasRef: RefObject<HTMLDivElement | null>;
  nodes: ColorEditorNode[];
  edges: ColorEditorEdge[];
  workspace: boolean;
  isPanning: boolean;
  selectedNodeId: string | undefined;
  selectedEdgeId: string | null;
  connectionDrag: ConnectionDragState | null;
  viewport: { x: number; y: number; zoom: number };
  onCanvasPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onCanvasClick: () => void;
  onNodePointerDown: (event: PointerEvent<HTMLDivElement>, node: ColorEditorNode) => void;
  onNodeSelect: (nodeId: string) => void;
  onNodeEnabledChange: (nodeId: string, enabled: boolean) => void;
  onConnectionStart: (event: PointerEvent<HTMLButtonElement>, node: ColorEditorNode) => void;
  onEdgeSelect: (edgeId: string) => void;
  onEdgeRemove: (edgeId: string) => void;
}

export function ColorGraphView({
  canvasRef,
  nodes,
  edges,
  workspace,
  isPanning,
  selectedNodeId,
  selectedEdgeId,
  connectionDrag,
  viewport,
  onCanvasPointerDown,
  onCanvasClick,
  onNodePointerDown,
  onNodeSelect,
  onNodeEnabledChange,
  onConnectionStart,
  onEdgeSelect,
  onEdgeRemove,
}: ColorGraphViewProps) {
  const graphWidth = Math.max(
    760,
    ...nodes.map(node => node.position.x + GRAPH_NODE_WIDTH + GRAPH_NODE_PADDING)
  );
  const graphHeight = Math.max(
    330,
    ...nodes.map(node => node.position.y + GRAPH_NODE_HEIGHT + GRAPH_NODE_PADDING)
  );
  const graphNodeById = new Map(nodes.map(node => [node.id, node]));
  const graphContentStyle = {
    width: graphWidth,
    height: graphHeight,
    transform: workspace
      ? `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
      : undefined,
  };

  return (
    <div className="color-graph-scroll">
      <div
        ref={canvasRef}
        className={`color-graph-canvas ${isPanning ? 'panning' : ''}`}
        onPointerDown={onCanvasPointerDown}
        onClick={onCanvasClick}
      >
        <div className="color-graph-content" style={graphContentStyle}>
          <svg
            className="color-graph-edges"
            viewBox={`0 0 ${graphWidth} ${graphHeight}`}
            width={graphWidth}
            height={graphHeight}
          >
            {edges.map(edge => {
              const fromNode = graphNodeById.get(edge.fromNodeId);
              const toNode = graphNodeById.get(edge.toNodeId);
              if (!fromNode || !toNode) return null;
              const x1 = fromNode.position.x + GRAPH_NODE_WIDTH;
              const y1 = fromNode.position.y + GRAPH_NODE_HEIGHT / 2;
              const x2 = toNode.position.x;
              const y2 = toNode.position.y + GRAPH_NODE_HEIGHT / 2;
              const path = getEdgePath(x1, y1, x2, y2);
              return (
                <g key={edge.id}>
                  <path
                    className="color-graph-edge-hit"
                    d={path}
                    onClick={(event) => {
                      event.stopPropagation();
                      onEdgeSelect(edge.id);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onEdgeRemove(edge.id);
                    }}
                  />
                  <path
                    className={`color-graph-edge ${edge.id === selectedEdgeId ? 'selected' : ''}`}
                    d={path}
                  />
                </g>
              );
            })}
            {connectionDrag && (
              <path
                className="color-graph-edge dragging"
                d={getEdgePath(
                  connectionDrag.start.x,
                  connectionDrag.start.y,
                  connectionDrag.current.x,
                  connectionDrag.current.y
                )}
              />
            )}
          </svg>
          {nodes.map(node => (
            <div
              key={node.id}
              className={[
                'color-graph-node',
                node.id === selectedNodeId ? 'selected' : '',
                node.enabled === false ? 'disabled' : '',
                !workspace ? 'compact-locked' : '',
                node.type,
              ].filter(Boolean).join(' ')}
              style={{
                left: node.position.x,
                top: node.position.y,
                width: GRAPH_NODE_WIDTH,
                height: GRAPH_NODE_HEIGHT,
              }}
              role="button"
              tabIndex={0}
              onPointerDown={workspace ? (event) => onNodePointerDown(event, node) : undefined}
              onClick={(event) => {
                event.stopPropagation();
                onNodeSelect(node.id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  onNodeSelect(node.id);
                }
              }}
            >
              {node.type !== 'input' && (
                <button
                  type="button"
                  className="color-graph-port input-port"
                  data-color-port="in"
                  data-color-node-id={node.id}
                  title="Input"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                />
              )}
              <span className="color-graph-node-type">{node.type}</span>
              <span className="color-graph-node-name">{node.name}</span>
              {node.type !== 'input' && node.type !== 'output' && (
                <input
                  type="checkbox"
                  checked={node.enabled !== false}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onNodeEnabledChange(node.id, event.target.checked)}
                  title={node.enabled !== false ? 'Disable node' : 'Enable node'}
                />
              )}
              {node.type !== 'output' && (
                <button
                  type="button"
                  className="color-graph-port output-port"
                  data-color-port="out"
                  data-color-node-id={node.id}
                  title="Drag to connect"
                  onPointerDown={(event) => onConnectionStart(event, node)}
                  onClick={(event) => event.stopPropagation()}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
