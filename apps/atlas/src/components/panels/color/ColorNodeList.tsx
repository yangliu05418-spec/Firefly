import type { ColorEditorNode } from './colorEditorTypes';

interface ColorNodeListProps {
  nodes: ColorEditorNode[];
  selectedNodeId: string | undefined;
  selectedNodeHasKeyframes: boolean;
  onSelectNode: (nodeId: string) => void;
  onSetNodeEnabled: (nodeId: string, enabled: boolean) => void;
  onResetNode: (nodeId: string) => void;
  onRemoveNode: (nodeId: string) => void;
}

export function ColorNodeList({
  nodes,
  selectedNodeId,
  selectedNodeHasKeyframes,
  onSelectNode,
  onSetNodeEnabled,
  onResetNode,
  onRemoveNode,
}: ColorNodeListProps) {
  return (
    <div className="color-node-list">
      {nodes.map(node => (
        <div
          key={node.id}
          className={`color-node-row ${node.id === selectedNodeId ? 'selected' : ''}`}
          onClick={() => onSelectNode(node.id)}
        >
          <input
            type="checkbox"
            checked={node.enabled !== false}
            onChange={(event) => {
              event.stopPropagation();
              onSetNodeEnabled(node.id, event.target.checked);
            }}
          />
          <span className="color-node-row-name">{node.name}</span>
          {node.id === selectedNodeId && selectedNodeHasKeyframes && <span className="color-kf-dot">KF</span>}
          <button
            onClick={(event) => {
              event.stopPropagation();
              onResetNode(node.id);
            }}
          >
            Reset
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onRemoveNode(node.id);
            }}
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}
