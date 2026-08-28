import type { TimelineTrackProps } from '../types';
import { originalUi } from '../../../firefly/i18n/originalUi';

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
      title={originalUi('original.resizeTrackHeight', 'Drag to resize track height')}
      onPointerDown={(event) => onResizeStart(event, trackId)}
    />
  );
}
