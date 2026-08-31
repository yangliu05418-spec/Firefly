import type { MediaFile } from '../../../../stores/mediaStore';
import { handleSubmenuHover, handleSubmenuLeave } from '../submenuPosition';

export interface MediaContextExplorerSubmenuProps {
  mediaFile: MediaFile;
  hasProxy: boolean;
  proxyFolderName: string | null | undefined;
  onShowRaw: (mediaFile: MediaFile) => Promise<void>;
  onShowProxy: (mediaFile: MediaFile) => Promise<void>;
  onClose: () => void;
}

export function MediaContextExplorerSubmenu({
  mediaFile,
  hasProxy,
  proxyFolderName,
  onShowRaw,
  onShowProxy,
  onClose,
}: MediaContextExplorerSubmenuProps) {
  const firefly = import.meta.env.VITE_APP_VARIANT === 'firefly';
  return (
    <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
      <span>{firefly ? '在文件管理器中显示' : 'Show in Explorer'}</span>
      <span className="submenu-arrow">&#9654;</span>
      <div className="context-submenu">
        <div
          className="context-menu-item"
          onClick={() => { void onShowRaw(mediaFile); }}
        >
          {firefly ? '原始文件' : 'Raw'} {mediaFile.hasFileHandle && (firefly ? '（已有路径）' : '(has path)')}
        </div>
        <div
          className={`context-menu-item ${!hasProxy ? 'disabled' : ''}`}
          onClick={() => {
            if (hasProxy) {
              void onShowProxy(mediaFile);
            } else {
              onClose();
            }
          }}
        >
          {firefly ? '代理文件' : 'Proxy'} {!hasProxy
            ? (firefly ? '（不可用）' : '(not available)')
            : proxyFolderName
              ? `(${proxyFolderName})`
              : '(IndexedDB)'}
        </div>
      </div>
    </div>
  );
}
