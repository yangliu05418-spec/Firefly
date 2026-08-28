import type { NodeGraphPort } from '../../../../services/nodeGraph';

export function AIPortDropdown({ title, ports }: { title: string; ports: NodeGraphPort[] }) {
  return (
    <details className="node-workspace-ai-port-dropdown">
      <summary>
        <span>{title}</span>
        <span>{ports.length}</span>
      </summary>
      <div className="node-workspace-ai-port-list">
        {ports.length > 0 ? ports.map((port) => (
          <div key={port.id} className="node-workspace-ai-port-row">
            <span>{port.label}</span>
            <span>{port.type}</span>
          </div>
        )) : (
          <div className="node-workspace-inspector-empty">None</div>
        )}
      </div>
    </details>
  );
}
