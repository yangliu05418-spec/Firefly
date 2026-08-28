import type { Dispatch, SetStateAction } from 'react';
import type {
  SilenceCleanupUiState,
  TransientCleanupUiState,
} from './audioEditStackTypes';
import { formatSeconds } from './audioEditStackHelpers';

interface SilenceCleanupSectionProps {
  hasSelectedAudioRegion: boolean;
  silenceCleanup: SilenceCleanupUiState;
  silenceMinSeconds: number;
  silenceRippleTimeline: boolean;
  silenceThresholdDb: number;
  setSilenceMinSeconds: Dispatch<SetStateAction<number>>;
  setSilenceRippleTimeline: Dispatch<SetStateAction<boolean>>;
  setSilenceThresholdDb: Dispatch<SetStateAction<number>>;
  onAnalyzeSilence: () => void;
  onApplyRoomToneFill: () => void;
  onApplySilenceRemoval: () => void;
}

export function SilenceCleanupSection({
  hasSelectedAudioRegion,
  silenceCleanup,
  silenceMinSeconds,
  silenceRippleTimeline,
  silenceThresholdDb,
  setSilenceMinSeconds,
  setSilenceRippleTimeline,
  setSilenceThresholdDb,
  onAnalyzeSilence,
  onApplyRoomToneFill,
  onApplySilenceRemoval,
}: SilenceCleanupSectionProps) {
  return (
    <div className="audio-silence-cleanup-section">
      <div className="audio-silence-cleanup-header">
        <div>
          <h4>Silence Cleanup</h4>
          <span>{silenceCleanup.message ?? 'Detect quiet ranges and compact the clip'}</span>
        </div>
        <div className="audio-silence-cleanup-actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={onAnalyzeSilence}
            disabled={silenceCleanup.phase === 'analyzing' || silenceCleanup.phase === 'applying'}
          >
            {silenceCleanup.phase === 'analyzing' ? 'Analyzing' : 'Analyze'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onApplySilenceRemoval}
            disabled={silenceCleanup.ranges.length === 0 || silenceCleanup.phase === 'applying'}
          >
            {silenceCleanup.phase === 'applying' ? 'Removing' : 'Remove'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onApplyRoomToneFill}
            disabled={!hasSelectedAudioRegion || silenceCleanup.phase === 'analyzing' || silenceCleanup.phase === 'applying'}
            title={hasSelectedAudioRegion ? 'Fill the selected audio region with room tone' : 'Select an audio region to fill'}
          >
            Fill Tone
          </button>
        </div>
      </div>
      <div className="audio-silence-cleanup-controls">
        <label>
          <span>Threshold</span>
          <input
            type="number"
            min="-100"
            max="-12"
            step="1"
            value={silenceThresholdDb}
            onChange={(event) => setSilenceThresholdDb(Number(event.currentTarget.value))}
          />
          <strong>dB</strong>
        </label>
        <label>
          <span>Min</span>
          <input
            type="number"
            min="0.05"
            max="30"
            step="0.01"
            value={silenceMinSeconds}
            onChange={(event) => setSilenceMinSeconds(Number(event.currentTarget.value))}
          />
          <strong>s</strong>
        </label>
        <label className="audio-silence-ripple-toggle">
          <input
            type="checkbox"
            checked={silenceRippleTimeline}
            onChange={(event) => setSilenceRippleTimeline(event.currentTarget.checked)}
          />
          <span>Ripple later clips</span>
        </label>
      </div>
      {silenceCleanup.ranges.length > 0 && (
        <div className="audio-silence-range-list">
          {silenceCleanup.ranges.slice(0, 5).map((range) => (
            <div key={`${range.start}-${range.end}`} className="audio-silence-range-row">
              <span>{formatSeconds(range.start)} - {formatSeconds(range.end)}</span>
              <strong>{range.duration.toFixed(2)}s | {range.rmsDb.toFixed(1)} dB</strong>
            </div>
          ))}
          {silenceCleanup.ranges.length > 5 && (
            <div className="audio-silence-range-more">+{silenceCleanup.ranges.length - 5} more</div>
          )}
        </div>
      )}
    </div>
  );
}

interface TransientCleanupSectionProps {
  transientCleanup: TransientCleanupUiState;
  transientCrestDb: number;
  transientGainDb: number;
  transientMinPeakDb: number;
  setTransientCrestDb: Dispatch<SetStateAction<number>>;
  setTransientGainDb: Dispatch<SetStateAction<number>>;
  setTransientMinPeakDb: Dispatch<SetStateAction<number>>;
  onAnalyzeTransients: () => void;
  onApplyTransientSoftening: () => void;
}

export function TransientCleanupSection({
  transientCleanup,
  transientCrestDb,
  transientGainDb,
  transientMinPeakDb,
  setTransientCrestDb,
  setTransientGainDb,
  setTransientMinPeakDb,
  onAnalyzeTransients,
  onApplyTransientSoftening,
}: TransientCleanupSectionProps) {
  return (
    <div className="audio-silence-cleanup-section audio-transient-cleanup-section">
      <div className="audio-silence-cleanup-header">
        <div>
          <h4>Transient Cleanup</h4>
          <span>{transientCleanup.message ?? 'Detect sharp peaks and soften them non-destructively'}</span>
        </div>
        <div className="audio-silence-cleanup-actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={onAnalyzeTransients}
            disabled={transientCleanup.phase === 'analyzing' || transientCleanup.phase === 'applying'}
          >
            {transientCleanup.phase === 'analyzing' ? 'Analyzing' : 'Analyze'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onApplyTransientSoftening}
            disabled={transientCleanup.ranges.length === 0 || transientCleanup.phase === 'applying'}
          >
            {transientCleanup.phase === 'applying' ? 'Softening' : 'Soften'}
          </button>
        </div>
      </div>
      <div className="audio-silence-cleanup-controls">
        <label>
          <span>Crest</span>
          <input
            type="number"
            min="6"
            max="60"
            step="1"
            value={transientCrestDb}
            onChange={(event) => setTransientCrestDb(Number(event.currentTarget.value))}
          />
          <strong>dB</strong>
        </label>
        <label>
          <span>Peak</span>
          <input
            type="number"
            min="-60"
            max="0"
            step="1"
            value={transientMinPeakDb}
            onChange={(event) => setTransientMinPeakDb(Number(event.currentTarget.value))}
          />
          <strong>dB</strong>
        </label>
        <label>
          <span>Gain</span>
          <input
            type="number"
            min="-36"
            max="0"
            step="0.5"
            value={transientGainDb}
            onChange={(event) => setTransientGainDb(Number(event.currentTarget.value))}
          />
          <strong>dB</strong>
        </label>
      </div>
      {transientCleanup.ranges.length > 0 && (
        <div className="audio-silence-range-list">
          {transientCleanup.ranges.slice(0, 5).map((range) => (
            <div key={`${range.start}-${range.end}`} className="audio-silence-range-row">
              <span>{formatSeconds(range.start)} - {formatSeconds(range.end)}</span>
              <strong>{range.crestDb.toFixed(1)} dB crest | {range.peakDb.toFixed(1)} dB peak</strong>
            </div>
          ))}
          {transientCleanup.ranges.length > 5 && (
            <div className="audio-silence-range-more">+{transientCleanup.ranges.length - 5} more</div>
          )}
        </div>
      )}
    </div>
  );
}
