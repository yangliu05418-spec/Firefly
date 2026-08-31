import type { MediaFolder } from '../../../../stores/mediaStore';
import { handleSubmenuHover, handleSubmenuLeave } from '../submenuPosition';

export interface MediaContextMoveFolderSubmenuProps {
  folders: readonly MediaFolder[];
  selectedIds: readonly string[];
  multiSelect: boolean;
  onMoveToFolder: (ids: readonly string[], folderId: string | null) => void;
  onClose: () => void;
}

export function MediaContextMoveFolderSubmenu({
  folders,
  selectedIds,
  multiSelect,
  onMoveToFolder,
  onClose,
}: MediaContextMoveFolderSubmenuProps) {
  if (folders.length === 0) return null;
  const firefly = import.meta.env.VITE_APP_VARIANT === 'firefly';

  const moveSelection = (folderId: string | null) => {
    onMoveToFolder(selectedIds, folderId);
    onClose();
  };

  return (
    <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
      <span>{firefly ? '移动到文件夹' : 'Move to Folder'}{multiSelect ? (firefly ? `（${selectedIds.length} 项）` : ` (${selectedIds.length})`) : ''}</span>
      <span className="submenu-arrow">&#9654;</span>
      <div className="context-submenu">
        <div
          className="context-menu-item"
          onClick={() => moveSelection(null)}
        >
          {firefly ? '根目录（无文件夹）' : 'Root (no folder)'}
        </div>
        <div className="context-menu-separator" />
        {folders.map((folder) => (
          <div
            key={folder.id}
            className="context-menu-item"
            onClick={() => moveSelection(folder.id)}
          >
            {folder.name}
          </div>
        ))}
      </div>
    </div>
  );
}
