import type { Dispatch, SetStateAction } from 'react';

import type {
  AudioEqBandType,
  AudioEqCharacterMode,
  AudioEqParamsV2,
  AudioEqPhaseMode,
  AudioEqPresetKind,
} from '../../../../engine/audio/eq/AudioEqTypes';
import type { FlexEqGraphMode } from './canvasRenderer';
import type { FlexEqControlParamValue } from './controlTypes';
import { ANALYZER_VIEW_OPTIONS, PRESET_OPTIONS } from './controlOptions';

interface UtilityStripProps {
  disabled: boolean;
  normalized: AudioEqParamsV2;
  graphMode: FlexEqGraphMode;
  hasAnalyzer: boolean;
  showPresetBrowser: boolean;
  matchSourceActive: boolean;
  matchTargetActive: boolean;
  canApplyMatch: boolean;
  activeABSlot: 'A' | 'B';
  hasSelectedBand: boolean;
  setShowPresetBrowser: Dispatch<SetStateAction<boolean>>;
  setGraphMode: Dispatch<SetStateAction<FlexEqGraphMode>>;
  setSketchPoints: (points: []) => void;
  updatePresetKind: (kind: AudioEqPresetKind) => void;
  updatePath: (path: string, value: FlexEqControlParamValue) => void;
  switchABSlot: (slot: 'A' | 'B') => void;
  syncActiveABSlot: () => void;
  handleCopyCurve: () => void;
  handleCopyBands: () => void;
  handlePaste: () => void;
  captureMatchSource: () => void;
  captureMatchTarget: () => void;
  applyCapturedMatch: () => void;
  addBand: (type: AudioEqBandType, frequencyHz: number) => void;
}

/** One compact row of all global EQ tools below the control module. */
export function UtilityStrip({
  disabled,
  normalized,
  graphMode,
  hasAnalyzer,
  showPresetBrowser,
  matchSourceActive,
  matchTargetActive,
  canApplyMatch,
  activeABSlot,
  hasSelectedBand,
  setShowPresetBrowser,
  setGraphMode,
  setSketchPoints,
  updatePresetKind,
  updatePath,
  switchABSlot,
  syncActiveABSlot,
  handleCopyCurve,
  handleCopyBands,
  handlePaste,
  captureMatchSource,
  captureMatchTarget,
  applyCapturedMatch,
  addBand,
}: UtilityStripProps) {
  return (
    <div className="flex-eq-utility-strip">
      <div className="flex-eq-utility-group" role="group" aria-label="Add band">
        <button type="button" disabled={disabled} onClick={() => addBand('bell', 1000)}>+ Bell</button>
        <button type="button" disabled={disabled} onClick={() => addBand('low-shelf', 120)}>+ Shelf</button>
        <button type="button" disabled={disabled} onClick={() => addBand('low-cut', 35)}>+ Cut</button>
      </div>

      <div className="flex-eq-utility-group flex-eq-segments" role="group" aria-label="EQ preset">
        {PRESET_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            className={normalized.audible.presetKind === option.value ? 'active' : ''}
            disabled={disabled}
            onClick={() => updatePresetKind(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="flex-eq-utility-group" role="group" aria-label="EQ processing modes">
        <select
          value={normalized.audible.phaseMode}
          disabled={disabled}
          aria-label="EQ phase mode"
          onChange={(event) => updatePath('eq.audible.phaseMode', event.currentTarget.value as AudioEqPhaseMode)}
        >
          <option value="zero-latency">Zero</option>
          <option value="natural">Natural</option>
          <option value="linear">Linear</option>
        </select>
        <select
          value={normalized.audible.characterMode}
          disabled={disabled}
          aria-label="EQ character mode"
          onChange={(event) => updatePath('eq.audible.characterMode', event.currentTarget.value as AudioEqCharacterMode)}
        >
          <option value="clean">Clean</option>
          <option value="subtle">Subtle</option>
          <option value="warm">Warm</option>
        </select>
      </div>

      <div className="flex-eq-utility-group" role="group" aria-label="EQ A/B">
        <button type="button" className={activeABSlot === 'A' ? 'active' : ''} disabled={disabled} onClick={() => switchABSlot('A')}>A</button>
        <button type="button" className={activeABSlot === 'B' ? 'active' : ''} disabled={disabled} onClick={() => switchABSlot('B')}>B</button>
        <button type="button" disabled={disabled} onClick={syncActiveABSlot}>Store</button>
      </div>

      <div className="flex-eq-utility-group" role="group" aria-label="EQ presets and clipboard">
        <button
          type="button"
          className={showPresetBrowser ? 'active' : ''}
          disabled={disabled}
          onClick={() => setShowPresetBrowser(current => !current)}
        >
          Presets
        </button>
        <button type="button" disabled={disabled} onClick={handleCopyCurve}>Copy</button>
        <button type="button" disabled={disabled || !hasSelectedBand} onClick={handleCopyBands}>Band</button>
        <button type="button" disabled={disabled} onClick={handlePaste}>Paste</button>
      </div>

      <div className="flex-eq-utility-group" role="group" aria-label="EQ graph mode">
        <button type="button" className={graphMode === 'edit' ? 'active' : ''} disabled={disabled} onClick={() => { setGraphMode('edit'); setSketchPoints([]); }}>
          Edit
        </button>
        <button type="button" className={graphMode === 'sketch' ? 'active' : ''} disabled={disabled} onClick={() => { setGraphMode(graphMode === 'sketch' ? 'edit' : 'sketch'); setSketchPoints([]); }}>
          Sketch
        </button>
        <button type="button" className={graphMode === 'grab' ? 'active' : ''} disabled={disabled || !hasAnalyzer} onClick={() => setGraphMode(graphMode === 'grab' ? 'edit' : 'grab')}>
          Grab
        </button>
      </div>

      <div className="flex-eq-utility-group" role="group" aria-label="EQ match">
        <button type="button" disabled={disabled || !hasAnalyzer} className={matchSourceActive ? 'active' : ''} onClick={captureMatchSource}>Src</button>
        <button type="button" disabled={disabled || !hasAnalyzer} className={matchTargetActive ? 'active' : ''} onClick={captureMatchTarget}>Ref</button>
        <button type="button" disabled={disabled || !canApplyMatch} onClick={applyCapturedMatch}>Match</button>
      </div>

      <div className="flex-eq-utility-group" role="group" aria-label="Spectrum view">
        {ANALYZER_VIEW_OPTIONS.map(option => {
          const currentAnalyzerMode = normalized.display.analyzerMode === 'off'
            ? 'post'
            : normalized.display.analyzerMode;
          return (
            <button key={option.value} type="button" disabled={disabled || !hasAnalyzer} className={currentAnalyzerMode === option.value ? 'active' : ''} onClick={() => updatePath('eq.display.analyzerMode', option.value)}>
              {option.label}
            </button>
          );
        })}
        <select
          value={normalized.display.graphRangeDb}
          disabled={disabled}
          aria-label="Graph range"
          onChange={(event) => updatePath('eq.display.graphRangeDb', Number(event.currentTarget.value))}
        >
          <option value={3}>3 dB</option>
          <option value={6}>6 dB</option>
          <option value={12}>12 dB</option>
          <option value={30}>30 dB</option>
        </select>
      </div>
    </div>
  );
}
