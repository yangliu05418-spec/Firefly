import type { ToolbarMenuController } from './menuTypes';

interface OutputMenuProps extends ToolbarMenuController {
  isEngineReady: boolean;
  outputTargets: { id: string; name: string }[];
  onNewOutput: () => void;
  onOpenOutputManager: () => void;
}

export function OutputMenu({
  isEngineReady,
  onMenuClick,
  onMenuHover,
  onNewOutput,
  onOpenOutputManager,
  openMenu,
  outputTargets,
}: OutputMenuProps) {
  return (
    <div className="menu-item">
      <button
        className={`menu-trigger ${openMenu === 'output' ? 'active' : ''}`}
        onClick={() => onMenuClick('output')}
        onMouseEnter={() => onMenuHover('output')}
      >
        Output
      </button>
      {openMenu === 'output' && (
        <div className="menu-dropdown">
          <button className="menu-option" onClick={onNewOutput} disabled={!isEngineReady}>
            <span>New Output Window</span>
          </button>
          <button className="menu-option" onClick={onOpenOutputManager}>
            <span>Open Output Manager</span>
          </button>
          {outputTargets.length > 0 && (
            <>
              <div className="menu-separator" />
              <div className="menu-submenu">
                <span className="menu-label">Active Outputs</span>
                {outputTargets.map((output) => (
                  <div key={output.id} className="menu-option">
                    <span>{output.name || `Output ${output.id}`}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
