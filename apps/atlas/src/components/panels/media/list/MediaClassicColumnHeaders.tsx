import type { DragEvent, MouseEvent } from 'react';

import { MEDIA_CLASSIC_COLUMN_LABELS } from './classicColumnLabels';
import type { MediaClassicColumnId } from './types';

export interface MediaClassicColumnHeadersProps {
  columnOrder: readonly MediaClassicColumnId[];
  draggingColumn: MediaClassicColumnId | null;
  dragOverColumn: MediaClassicColumnId | null;
  sortColumn: MediaClassicColumnId | null;
  sortDirection: 'asc' | 'desc';
  nameColumnWidth: number;
  onColumnDragStart: (event: DragEvent<HTMLDivElement>, columnId: MediaClassicColumnId) => void;
  onColumnDragOver: (event: DragEvent<HTMLDivElement>, columnId: MediaClassicColumnId) => void;
  onColumnDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onColumnDrop: (event: DragEvent<HTMLDivElement>, columnId: MediaClassicColumnId) => void;
  onColumnDragEnd: (event: DragEvent<HTMLDivElement>) => void;
  onColumnSort: (columnId: MediaClassicColumnId) => void;
  onNameColumnResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
}

export function MediaClassicColumnHeaders({
  columnOrder,
  draggingColumn,
  dragOverColumn,
  sortColumn,
  sortDirection,
  nameColumnWidth,
  onColumnDragStart,
  onColumnDragOver,
  onColumnDragLeave,
  onColumnDrop,
  onColumnDragEnd,
  onColumnSort,
  onNameColumnResizeStart,
}: MediaClassicColumnHeadersProps) {
  return (
    <div className="media-column-headers">
      {columnOrder.map((columnId) => (
        <div
          key={columnId}
          className={[
            'media-col',
            `media-col-${columnId}`,
            draggingColumn === columnId ? 'dragging' : '',
            dragOverColumn === columnId ? 'drag-over' : '',
            sortColumn === columnId ? 'sorted' : '',
          ].filter(Boolean).join(' ')}
          style={columnId === 'name' ? { width: nameColumnWidth, minWidth: nameColumnWidth, maxWidth: nameColumnWidth } : undefined}
          draggable
          onDragStart={(event) => onColumnDragStart(event, columnId)}
          onDragOver={(event) => onColumnDragOver(event, columnId)}
          onDragLeave={onColumnDragLeave}
          onDrop={(event) => onColumnDrop(event, columnId)}
          onDragEnd={onColumnDragEnd}
          onClick={() => onColumnSort(columnId)}
        >
          {MEDIA_CLASSIC_COLUMN_LABELS[columnId]}
          {sortColumn === columnId && (
            <span className="media-sort-indicator">{sortDirection === 'asc' ? '\u25b2' : '\u25bc'}</span>
          )}
          {columnId === 'name' && (
            <div
              className="media-col-resize-handle"
              onMouseDown={onNameColumnResizeStart}
              onClick={(event) => event.stopPropagation()}
            />
          )}
        </div>
      ))}
    </div>
  );
}
