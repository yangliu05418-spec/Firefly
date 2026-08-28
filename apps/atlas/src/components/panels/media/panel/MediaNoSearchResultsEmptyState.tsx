import type { MouseEventHandler } from 'react';

export interface MediaNoSearchResultsEmptyStateProps {
  query: string;
  onContextMenu: MouseEventHandler<HTMLDivElement>;
}

export function MediaNoSearchResultsEmptyState({
  query,
  onContextMenu,
}: MediaNoSearchResultsEmptyStateProps) {
  return (
    <div className="media-panel-empty" onContextMenu={onContextMenu}>
      <p>没有匹配的素材</p>
      <p className="hint">{query}</p>
    </div>
  );
}
