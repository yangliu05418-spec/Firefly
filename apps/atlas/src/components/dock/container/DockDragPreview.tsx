import type { DockDragState } from '../../../types/dock';
import { localizePanelTitle } from '../../../firefly/i18n/panelLabels';

interface DockDragPreviewProps {
  dragState: DockDragState;
}

export function DockDragPreview({ dragState }: DockDragPreviewProps) {
  if (!dragState.isDragging || !dragState.draggedPanel) return null;

  return (
    <div
      className="dock-drag-preview"
      style={{
        left: dragState.currentPos.x - dragState.dragOffset.x,
        top: dragState.currentPos.y - dragState.dragOffset.y,
      }}
    >
      {localizePanelTitle(dragState.draggedPanel.type, dragState.draggedPanel.title)}
    </div>
  );
}
