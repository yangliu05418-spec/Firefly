import type { TimelineTrackProps } from '../types';

type TimelineTrackResizeHandleProps = {
  isResizeActive: boolean;
  onResizeStart: NonNullable<TimelineTrackProps['onResizeStart']>;
  trackId: string;
};

export function TimelineTrackResizeHandle({
  isResizeActive,
  onResizeStart,
  trackId,
}: TimelineTrackResizeHandleProps) {
  return (
    <div
      className={`track-resize-handle track-resize-handle-lane ${isResizeActive ? 'active' : ''}`}
      role="separator"
      aria-orientation="horizontal"
      title="Drag to resize track height"
      onPointerDown={(event) => onResizeStart(event, trackId)}
    />
  );
}
