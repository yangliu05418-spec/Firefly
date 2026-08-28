import type { ClipAudioEditOperation } from '../../../../types/audio';
import type { EditPreviewUiState } from './audioEditStackTypes';
import {
  formatValue,
  getOperationLabel,
  getOperationRange,
  getPreviewButtonLabel,
  getTimelineRange,
} from './audioEditStackHelpers';

interface AudioEditOperationStackProps {
  editPreview: EditPreviewUiState | null;
  editStack: ClipAudioEditOperation[];
  selectedOperation: ClipAudioEditOperation | null;
  onPreviewEditOperation: (operation: ClipAudioEditOperation) => void;
  onRemoveSelectedOperation: () => void;
  onSelectOperation: (operationId: string) => void;
  onToggleSelectedOperation: () => void;
}

export function AudioEditOperationStack({
  editPreview,
  editStack,
  selectedOperation,
  onPreviewEditOperation,
  onRemoveSelectedOperation,
  onSelectOperation,
  onToggleSelectedOperation,
}: AudioEditOperationStackProps) {
  if (editStack.length === 0) {
    return <div className="panel-empty"><p>No audio edits applied</p></div>;
  }

  return (
    <div className="audio-edit-stack-layout">
      <div className="audio-edit-operation-list">
        {editStack.map((operation, index) => {
          const enabled = operation.enabled !== false;
          const selected = selectedOperation?.id === operation.id;
          return (
            <button
              type="button"
              key={operation.id}
              className={`audio-edit-operation-row ${selected ? 'selected' : ''} ${enabled ? '' : 'bypassed'}`}
              onClick={() => onSelectOperation(operation.id)}
            >
              <span className="audio-edit-operation-index">{index + 1}</span>
              <span className="audio-edit-operation-main">
                <span className="audio-edit-operation-name">{getOperationLabel(operation)}</span>
                <span className="audio-edit-operation-range">{getOperationRange(operation)}</span>
              </span>
              <span className="audio-edit-operation-state">{enabled ? 'On' : 'Off'}</span>
            </button>
          );
        })}
      </div>

      {selectedOperation && (
        <div className="audio-edit-operation-detail">
          <div className="audio-edit-detail-header">
            <div>
              <h4>{getOperationLabel(selectedOperation)}</h4>
              <span>{selectedOperation.type}</span>
            </div>
            <div className="audio-edit-detail-actions">
              <button
                className="btn btn-sm"
                onClick={() => onPreviewEditOperation(selectedOperation)}
                disabled={selectedOperation.enabled === false}
              >
                {getPreviewButtonLabel(
                  editPreview?.previewId === `operation:${selectedOperation.id}`,
                  editPreview?.phase,
                )}
              </button>
              <button
                className="btn btn-sm"
                onClick={onToggleSelectedOperation}
              >
                {selectedOperation.enabled === false ? 'Enable' : 'Bypass'}
              </button>
              <button className="btn btn-sm btn-danger" onClick={onRemoveSelectedOperation}>
                Remove
              </button>
            </div>
          </div>
          {editPreview?.previewId === `operation:${selectedOperation.id}` && editPreview.message && (
            <span className={`audio-edit-preview-status phase-${editPreview.phase}`}>
              {editPreview.message}
            </span>
          )}

          <div className="audio-edit-detail-grid">
            <span>Source</span>
            <strong>{getOperationRange(selectedOperation)}</strong>
            <span>Timeline</span>
            <strong>{getTimelineRange(selectedOperation)}</strong>
            <span>Channels</span>
            <strong>{selectedOperation.channelMask?.length ? selectedOperation.channelMask.join(', ') : 'All'}</strong>
            <span>Created</span>
            <strong>{new Date(selectedOperation.createdAt).toLocaleString()}</strong>
          </div>

          <div className="audio-edit-param-list">
            {Object.entries(selectedOperation.params ?? {}).map(([key, value]) => (
              <div key={key} className="audio-edit-param-row">
                <span>{key}</span>
                <strong>{formatValue(value)}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
