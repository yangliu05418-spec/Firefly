import type { ComponentProps, Dispatch, ReactNode, SetStateAction } from 'react';

import type {
  AudioEqBand,
  AudioEqBandDynamics,
  AudioEqBandSpectralDynamics,
  AudioEqBandType,
  AudioEqParamsV2,
} from '../../../../engine/audio/eq/AudioEqTypes';
import { DraggableNumber, MultiKeyframeToggle } from '../shared';
import { BandAdvancedPanels, type FlexEqAdvancedPanel } from './BandAdvancedPanels';
import { BAND_TYPE_OPTIONS } from './controlOptions';
import { HardwareKnob } from './HardwareKnob';
import {
  GRAPH_MAX_FREQUENCY_HZ,
  GRAPH_MIN_FREQUENCY_HZ,
  clamp,
} from './graphMath';

const SLOPE_OPTIONS_DB_PER_OCT = [12, 24, 36, 48, 72, 96] as const;

const KNOB_GAIN_RANGE_DB = 30;

function bandSupportsSlope(type: AudioEqBandType): boolean {
  return type === 'low-cut' || type === 'high-cut' || type === 'low-shelf' || type === 'high-shelf';
}

function bandSupportsBrickwall(type: AudioEqBandType): boolean {
  return type === 'low-cut' || type === 'high-cut';
}

function BandTypeGlyph({ type }: { type: AudioEqBandType }) {
  const path = type === 'bell' || type === 'notch' || type === 'band-pass' || type === 'all-pass'
    ? (type === 'notch' ? 'M2 7 L10 7 Q14 7 14 17 Q14 7 18 7 L26 7' : 'M2 16 Q10 16 12 9 Q14 4 16 9 Q18 16 26 16')
    : type === 'low-shelf'
      ? 'M2 8 L10 8 Q16 8 18 14 L26 14'
      : type === 'high-shelf' || type === 'tilt-shelf'
        ? 'M2 14 L10 14 Q16 14 18 8 L26 8'
        : type === 'low-cut'
          ? 'M4 20 Q10 8 14 7 L26 7'
          : 'M2 7 L14 7 Q18 8 24 20';
  return (
    <svg className="flex-eq-band-glyph" viewBox="0 0 28 22" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

interface ControlModuleProps {
  compact: boolean;
  disabled: boolean;
  effectId: string | undefined;
  keyframeClipId: string | undefined;
  normalized: AudioEqParamsV2;
  selectedBand: AudioEqBand | undefined;
  selectedBandAllKeyframeEntries: ComponentProps<typeof MultiKeyframeToggle>['entries'];
  soloBandIds: readonly string[];
  advancedPanel: FlexEqAdvancedPanel;
  setAdvancedPanel: Dispatch<SetStateAction<FlexEqAdvancedPanel>>;
  toggleSoloBand: (bandId: string) => void;
  updateBand: (bandId: string, patch: Partial<AudioEqBand>) => void;
  scheduleBandDragCommit: (bandId: string, patch: Partial<AudioEqBand>) => void;
  flushBandDragCommit: () => void;
  updateBandDynamics: (band: AudioEqBand, patch: Partial<AudioEqBandDynamics>) => void;
  updateBandSpectralDynamics: (band: AudioEqBand, patch: Partial<AudioEqBandSpectralDynamics>) => void;
  removeSelectedBand: () => void;
  renderBandNumericKeyframeToggle: (band: AudioEqBand, paramPath: string, value: number) => ReactNode;
  /** Global tool rail rendered as the module's top row. */
  utilitySlot?: ReactNode;
  /** Expanded preset browser rendered inside the module when open. */
  presetBrowserSlot?: ReactNode;
}

/**
 * The single hardware-style control panel below the EQ display: band chips,
 * the selected band's knobs (freq/gain/Q) with LED readouts, band type and
 * slope selectors, toggles, and the advanced dynamics panels.
 */
export function ControlModule({
  compact,
  disabled,
  effectId,
  keyframeClipId,
  normalized,
  selectedBand,
  selectedBandAllKeyframeEntries,
  soloBandIds,
  advancedPanel,
  setAdvancedPanel,
  toggleSoloBand,
  updateBand,
  scheduleBandDragCommit,
  flushBandDragCommit,
  updateBandDynamics,
  updateBandSpectralDynamics,
  removeSelectedBand,
  renderBandNumericKeyframeToggle,
  utilitySlot,
  presetBrowserSlot,
}: ControlModuleProps) {
  const gainDisabled = disabled || (selectedBand
    ? selectedBand.type === 'low-cut' || selectedBand.type === 'high-cut' || selectedBand.type === 'notch' || selectedBand.type === 'band-pass' || selectedBand.type === 'all-pass'
    : true);

  return (
    <section className={`flex-eq-control-module ${compact ? 'compact' : ''}`} aria-label="EQ control module">
      {utilitySlot}
      {presetBrowserSlot}

      {selectedBand && (
        <div className="flex-eq-module-main">
          <div className="flex-eq-module-side">
            <div className="flex-eq-module-field">
              <BandTypeGlyph type={selectedBand.type} />
              <select
                value={selectedBand.type}
                disabled={disabled}
                aria-label="Band type"
                onChange={(event) => updateBand(selectedBand.id, { type: event.currentTarget.value as AudioEqBandType })}
              >
                {BAND_TYPE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <label>Band Type</label>
            </div>

            {bandSupportsSlope(selectedBand.type) && (
              <div className="flex-eq-module-field">
                <select
                  value={selectedBand.brickwall === true && bandSupportsBrickwall(selectedBand.type)
                    ? 'brickwall'
                    : String(Math.max(12, Math.min(96, Math.round((selectedBand.slopeDbPerOct ?? 12) / 12) * 12)))}
                  disabled={disabled}
                  aria-label="Band slope"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (value === 'brickwall') {
                      updateBand(selectedBand.id, { brickwall: true });
                      return;
                    }
                    updateBand(selectedBand.id, { slopeDbPerOct: Number(value), brickwall: false });
                  }}
                >
                  {SLOPE_OPTIONS_DB_PER_OCT.map(slope => (
                    <option key={slope} value={String(slope)}>{slope} dB/oct</option>
                  ))}
                  {bandSupportsBrickwall(selectedBand.type) && <option value="brickwall">Brickwall</option>}
                </select>
                <label>Slope</label>
              </div>
            )}

            {keyframeClipId && effectId && selectedBandAllKeyframeEntries.length > 0 && (
              <div className="flex-eq-module-field flex-eq-module-keyframes">
                <MultiKeyframeToggle
                  clipId={keyframeClipId}
                  entries={selectedBandAllKeyframeEntries}
                  dragId={`${keyframeClipId}:effect:${effectId}:eq-band:${selectedBand.id}:all`}
                  title="Add all selected band parameter keyframes"
                />
                <label>Keys</label>
              </div>
            )}
          </div>

          <div className="flex-eq-module-knobs">
            <div className="flex-eq-knob-block">
              <HardwareKnob
                value={clamp(selectedBand.frequencyHz, GRAPH_MIN_FREQUENCY_HZ, GRAPH_MAX_FREQUENCY_HZ)}
                min={GRAPH_MIN_FREQUENCY_HZ}
                max={GRAPH_MAX_FREQUENCY_HZ}
                scale="log"
                size="sm"
                label="Freq (Hz)"
                minLabel="20"
                maxLabel="20k"
                disabled={disabled}
                defaultValue={selectedBand.frequencyHz}
                onChange={(value) => scheduleBandDragCommit(selectedBand.id, { frequencyHz: clamp(Math.round(value), GRAPH_MIN_FREQUENCY_HZ, GRAPH_MAX_FREQUENCY_HZ) })}
                onDragEnd={flushBandDragCommit}
              />
              <div className="flex-eq-led-row">
                {renderBandNumericKeyframeToggle(selectedBand, 'frequencyHz', selectedBand.frequencyHz)}
                <div className="flex-eq-led">
                  <DraggableNumber
                    value={selectedBand.frequencyHz}
                    onChange={(value) => updateBand(selectedBand.id, { frequencyHz: clamp(value, GRAPH_MIN_FREQUENCY_HZ, GRAPH_MAX_FREQUENCY_HZ) })}
                    defaultValue={selectedBand.frequencyHz}
                    min={GRAPH_MIN_FREQUENCY_HZ}
                    max={GRAPH_MAX_FREQUENCY_HZ}
                    decimals={0}
                    sensitivity={80}
                  />
                </div>
              </div>
            </div>

            <div className="flex-eq-knob-block primary">
              <HardwareKnob
                value={clamp(selectedBand.gainDb, -KNOB_GAIN_RANGE_DB, KNOB_GAIN_RANGE_DB)}
                min={-KNOB_GAIN_RANGE_DB}
                max={KNOB_GAIN_RANGE_DB}
                size="lg"
                label="Gain (dB)"
                minLabel={`-${KNOB_GAIN_RANGE_DB}`}
                maxLabel={`+${KNOB_GAIN_RANGE_DB}`}
                disabled={gainDisabled}
                defaultValue={0}
                onChange={(value) => scheduleBandDragCommit(selectedBand.id, { gainDb: clamp(value, -60, 60) })}
                onDragEnd={flushBandDragCommit}
              />
              <div className="flex-eq-led-row">
                {renderBandNumericKeyframeToggle(selectedBand, 'gainDb', selectedBand.gainDb)}
                <div className="flex-eq-led">
                  <DraggableNumber
                    value={selectedBand.gainDb}
                    onChange={(value) => updateBand(selectedBand.id, { gainDb: clamp(value, -60, 60) })}
                    defaultValue={0}
                    min={-60}
                    max={60}
                    decimals={1}
                    sensitivity={0.2}
                  />
                </div>
              </div>
            </div>

            <div className="flex-eq-knob-block">
              <HardwareKnob
                value={clamp(selectedBand.q, 0.025, 100)}
                min={0.025}
                max={100}
                scale="log"
                size="sm"
                label="Q"
                minLabel="0.025"
                maxLabel="100"
                disabled={disabled}
                defaultValue={1}
                onChange={(value) => scheduleBandDragCommit(selectedBand.id, { q: clamp(Math.round(value * 1000) / 1000, 0.025, 100) })}
                onDragEnd={flushBandDragCommit}
              />
              <div className="flex-eq-led-row">
                {renderBandNumericKeyframeToggle(selectedBand, 'q', selectedBand.q)}
                <div className="flex-eq-led">
                  <DraggableNumber
                    value={selectedBand.q}
                    onChange={(value) => updateBand(selectedBand.id, { q: clamp(value, 0.025, 100) })}
                    defaultValue={1}
                    min={0.025}
                    max={100}
                    decimals={2}
                    sensitivity={0.04}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex-eq-module-toggles">
            <button type="button" className={selectedBand.enabled ? 'active' : ''} disabled={disabled} onClick={() => updateBand(selectedBand.id, { enabled: !selectedBand.enabled })}>
              On
            </button>
            <button type="button" className={soloBandIds.includes(selectedBand.id) ? 'active' : ''} disabled={disabled} onClick={() => toggleSoloBand(selectedBand.id)}>
              Solo
            </button>
            <button type="button" className={advancedPanel === 'dynamics' || selectedBand.dynamic?.enabled ? 'active' : ''} disabled={disabled} onClick={() => setAdvancedPanel(current => current === 'dynamics' ? 'none' : 'dynamics')}>
              Dyn
            </button>
            <button type="button" className={advancedPanel === 'spectral' || selectedBand.spectralDynamics?.enabled ? 'active' : ''} disabled={disabled || selectedBand.type === 'all-pass'} onClick={() => setAdvancedPanel(current => current === 'spectral' ? 'none' : 'spectral')}>
              Spec
            </button>
            <button type="button" className="danger" disabled={disabled || normalized.audible.bands.length <= 1} onClick={removeSelectedBand}>
              Del
            </button>
          </div>
        </div>
      )}

      {selectedBand && (
        <BandAdvancedPanels
          advancedPanel={advancedPanel}
          disabled={disabled}
          selectedBand={selectedBand}
          updateBandDynamics={updateBandDynamics}
          updateBandSpectralDynamics={updateBandSpectralDynamics}
          renderBandNumericKeyframeToggle={renderBandNumericKeyframeToggle}
        />
      )}

    </section>
  );
}
