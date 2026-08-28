import type { EditPreviewUiState } from './audioEditStackTypes';
import { getPreviewButtonLabel } from './audioEditStackHelpers';

interface AudioEditStackHeaderProps {
  activeOperationCount: number;
  activeSpectralLayerCount: number;
  baking: boolean;
  canUnbake: boolean;
  editPreview: EditPreviewUiState | null;
  editStackLength: number;
  spectralLayerCount: number;
  onBake: () => void;
  onClearEditStack: () => void;
  onPreviewEditStack: () => void;
  onPreviewSourceAudio: () => void;
  onUnbake: () => void;
}

export function AudioEditStackHeader({
  activeOperationCount,
  activeSpectralLayerCount,
  baking,
  canUnbake,
  editPreview,
  editStackLength,
  spectralLayerCount,
  onBake,
  onClearEditStack,
  onPreviewEditStack,
  onPreviewSourceAudio,
  onUnbake,
}: AudioEditStackHeaderProps) {
  return (
    <>
      <div className="audio-edit-stack-header">
        <div className="audio-edit-stack-title">
          <span>{activeOperationCount} active</span>
          <span>{editStackLength} total</span>
          <span>{activeSpectralLayerCount}/{spectralLayerCount} image layers</span>
        </div>
        <div className="audio-edit-stack-actions">
          <button className="btn btn-sm" onClick={onPreviewSourceAudio}>
            {getPreviewButtonLabel(editPreview?.previewId === 'source', editPreview?.phase, 'Preview Source')}
          </button>
          <button
            className="btn btn-sm"
            onClick={onPreviewEditStack}
            disabled={activeOperationCount === 0}
          >
            {getPreviewButtonLabel(editPreview?.previewId === 'stack', editPreview?.phase, 'Preview Stack')}
          </button>
          <button className="btn btn-sm" onClick={onBake} disabled={baking || activeOperationCount === 0}>
            {baking ? 'Baking...' : 'Bake'}
          </button>
          <button className="btn btn-sm" onClick={onUnbake} disabled={baking || !canUnbake}>
            Unbake
          </button>
          <button className="btn btn-sm" onClick={onClearEditStack} disabled={editStackLength === 0}>
            Clear
          </button>
        </div>
      </div>
      {editPreview?.previewId === 'stack' && editPreview.message && (
        <span className={`audio-edit-preview-status phase-${editPreview.phase}`}>
          {editPreview.message}
        </span>
      )}
      {editPreview?.previewId === 'source' && editPreview.message && (
        <span className={`audio-edit-preview-status phase-${editPreview.phase}`}>
          {editPreview.message}
        </span>
      )}
    </>
  );
}
