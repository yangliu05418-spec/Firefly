import type { ShortcutActionId } from '../../../../services/shortcutTypes';
import type { MaskVertexHandleMode } from "../../../../types/masks";
import { IconButton } from './IconButton';

interface MaskVertexToolsShortcutRegistry {
  getLabel: (command: ShortcutActionId) => string;
}

interface MaskVertexToolsProps {
  registry: MaskVertexToolsShortcutRegistry;
  selectedHandleMode: MaskVertexHandleMode | 'mixed' | null;
  selectedVertexCount: number;
  onCycleSelectedHandles: () => void;
  onSetSelectedHandles: (mode: MaskVertexHandleMode) => void;
}

export function MaskVertexTools({
  registry,
  selectedHandleMode,
  selectedVertexCount,
  onCycleSelectedHandles,
  onSetSelectedHandles,
}: MaskVertexToolsProps) {
  if (selectedVertexCount === 0) return null;

  return (
    <div className="mask-vertex-tools">
      <span>{selectedVertexCount} selected</span>
      <div className="mask-mode-segmented compact" role="group" aria-label="Vertex handle mode">
        <button
          type="button"
          className={selectedHandleMode === 'none' ? 'active' : ''}
          title="Corner vertex"
          onClick={() => onSetSelectedHandles('none')}
        >
          Corner
        </button>
        <button
          type="button"
          className={selectedHandleMode === 'mirrored' ? 'active' : ''}
          title={`Linked bezier handles (${registry.getLabel('mask.toggleVertexHandles')})`}
          onClick={() => onSetSelectedHandles('mirrored')}
        >
          Linked
        </button>
        <button
          type="button"
          className={selectedHandleMode === 'split' ? 'active' : ''}
          title="Split bezier handles"
          onClick={() => onSetSelectedHandles('split')}
        >
          Split
        </button>
      </div>
      <IconButton
        icon="pen"
        title={`Cycle handle mode (${registry.getLabel('mask.toggleVertexHandles')})`}
        onClick={() => onCycleSelectedHandles()}
      />
    </div>
  );
}
