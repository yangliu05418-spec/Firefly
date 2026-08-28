import type { MouseEventHandler } from 'react';

export interface MediaNoMediaEmptyStateProps {
  onContextMenu: MouseEventHandler<HTMLDivElement>;
}

export function MediaNoMediaEmptyState({ onContextMenu }: MediaNoMediaEmptyStateProps) {
  return (
    <div className="media-panel-empty" onContextMenu={onContextMenu}>
      <div className="drop-icon">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>
      <p>还没有项目素材</p>
      <p className="hint">将文件或文件夹拖到这里，或点击“导入”</p>
    </div>
  );
}
