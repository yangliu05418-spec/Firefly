import type { ClipAudioEditOperation } from '../../../../types/audio';
import type { AudioRepairSuggestion } from '../../../../services/audio/audioRepairSuggestions';
import type { RepairPreviewUiState } from './audioEditStackTypes';
import {
  formatSuggestionEvidence,
  getPreviewButtonLabel,
  isSuggestionApplied,
} from './audioEditStackHelpers';

interface RepairSuggestionsSectionProps {
  editStack: ClipAudioEditOperation[];
  repairPreview: RepairPreviewUiState | null;
  repairSuggestions: AudioRepairSuggestion[];
  onApplyRepairSuggestion: (suggestion: AudioRepairSuggestion) => void;
  onPreviewRepairSuggestion: (suggestion: AudioRepairSuggestion) => void;
}

export function RepairSuggestionsSection({
  editStack,
  repairPreview,
  repairSuggestions,
  onApplyRepairSuggestion,
  onPreviewRepairSuggestion,
}: RepairSuggestionsSectionProps) {
  return (
    <div className="audio-repair-suggestion-section">
      <div className="audio-repair-suggestion-header">
        <div>
          <h4>Repair Suggestions</h4>
          <span>{repairSuggestions.length ? `${repairSuggestions.length} available` : 'Run loudness, frequency, and phase analysis to populate suggestions'}</span>
        </div>
      </div>
      {repairSuggestions.length > 0 ? (
        <div className="audio-repair-suggestion-list">
          {repairSuggestions.map((suggestion) => {
            const applied = isSuggestionApplied(editStack, suggestion);
            const previewing = repairPreview?.suggestionId === suggestion.id;
            const evidence = formatSuggestionEvidence(suggestion);
            return (
              <div key={suggestion.id} className={`audio-repair-suggestion-card severity-${suggestion.severity} ${previewing ? 'previewing' : ''}`}>
                <div className="audio-repair-suggestion-main">
                  <div className="audio-repair-suggestion-title">
                    <strong>{suggestion.label}</strong>
                    <span>{suggestion.severity} | {Math.round(suggestion.confidence * 100)}%</span>
                  </div>
                  <p>{suggestion.reason}</p>
                  {evidence && (
                    <span className="audio-repair-suggestion-evidence">{evidence}</span>
                  )}
                  {previewing && repairPreview?.message && (
                    <span className={`audio-repair-suggestion-preview phase-${repairPreview.phase}`}>
                      {repairPreview.message}
                    </span>
                  )}
                </div>
                <div className="audio-repair-suggestion-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => onPreviewRepairSuggestion(suggestion)}
                  >
                    {getPreviewButtonLabel(previewing, repairPreview?.phase)}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={applied}
                    onClick={() => onApplyRepairSuggestion(suggestion)}
                  >
                    {applied ? 'Applied' : 'Apply'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="audio-repair-suggestion-empty">
          No repair suggestions from the current cached analysis.
        </div>
      )}
    </div>
  );
}
