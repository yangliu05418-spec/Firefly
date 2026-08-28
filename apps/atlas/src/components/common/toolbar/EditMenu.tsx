import type { ToolbarMenuController, ToolbarShortcutLabels } from './menuTypes';

interface EditMenuProps extends ToolbarMenuController {
  fireflyEmbedded?: boolean;
  onCopy: () => void;
  onOpenSettings: () => void;
  onPaste: () => void;
  shortcutLabels: ToolbarShortcutLabels;
}

export function EditMenu({
  fireflyEmbedded = false,
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
        {fireflyEmbedded ? '编辑' : 'Edit'}
      </button>
      {openMenu === 'edit' && (
        <div className="menu-dropdown">
          <button className="menu-option" onClick={onCopy}>
            <span>{fireflyEmbedded ? '复制' : 'Copy'}</span>
            <span className="shortcut">{shortcutLabels.copy}</span>
          </button>
          <button className="menu-option" onClick={onPaste}>
            <span>{fireflyEmbedded ? '粘贴' : 'Paste'}</span>
            <span className="shortcut">{shortcutLabels.paste}</span>
          </button>
          <div className="menu-separator" />
          <button className="menu-option" onClick={onOpenSettings}>
            <span>{fireflyEmbedded ? '设置…' : 'Settings...'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
