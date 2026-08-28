import type { ToolbarMenuController, ToolbarShortcutLabels } from './menuTypes';

interface EditMenuProps extends ToolbarMenuController {
  onCopy: () => void;
  onOpenSettings: () => void;
  onPaste: () => void;
  shortcutLabels: ToolbarShortcutLabels;
}

export function EditMenu({
  onCopy,
  onMenuClick,
  onMenuHover,
  onOpenSettings,
  onPaste,
  openMenu,
  shortcutLabels,
}: EditMenuProps) {
  return (
    <div className="menu-item">
      <button
        className={`menu-trigger ${openMenu === 'edit' ? 'active' : ''}`}
        onClick={() => onMenuClick('edit')}
        onMouseEnter={() => onMenuHover('edit')}
      >
        Edit
      </button>
      {openMenu === 'edit' && (
        <div className="menu-dropdown">
          <button className="menu-option" onClick={onCopy}>
            <span>Copy</span>
            <span className="shortcut">{shortcutLabels.copy}</span>
          </button>
          <button className="menu-option" onClick={onPaste}>
            <span>Paste</span>
            <span className="shortcut">{shortcutLabels.paste}</span>
          </button>
          <div className="menu-separator" />
          <button className="menu-option" onClick={onOpenSettings}>
            <span>Settings...</span>
          </button>
        </div>
      )}
    </div>
  );
}
