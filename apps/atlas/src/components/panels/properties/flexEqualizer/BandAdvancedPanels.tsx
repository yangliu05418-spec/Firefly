import type { ReactNode } from 'react';

import {
  AUDIO_EQ_DEFAULT_BAND_DYNAMICS,
  AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS,
} from '../../../../engine/audio/eq/AudioEqDefaults';
import type {
  AudioEqBand,
  AudioEqBandDynamics,
  AudioEqBandSpectralDynamics,
} from '../../../../engine/audio/eq/AudioEqTypes';
import { DraggableNumber } from '../shared';
import { clamp } from './graphMath';

export type FlexEqAdvancedPanel = 'none' | 'dynamics' | 'spectral';

interface BandAdvancedPanelsProps {
  advancedPanel: FlexEqAdvancedPanel;
  disabled: boolean;
  selectedBand: AudioEqBand;
  updateBandDynamics: (band: AudioEqBand, patch: Partial<AudioEqBandDynamics>) => void;
  updateBandSpectralDynamics: (band: AudioEqBand, patch: Partial<AudioEqBandSpectralDynamics>) => void;
  renderBandNumericKeyframeToggle: (band: AudioEqBand, paramPath: string, value: number) => ReactNode;
}

/** Collapsible dynamic-EQ / Spectral Dynamics parameter rows for one band. */
export function BandAdvancedPanels({
  advancedPanel,
  disabled,
  selectedBand,
  updateBandDynamics,
  updateBandSpectralDynamics,
  renderBandNumericKeyframeToggle,
}: BandAdvancedPanelsProps) {
  if (advancedPanel === 'dynamics') {
    return (
      <div className="flex-eq-dynamics-row">
        <button type="button" className={selectedBand.dynamic?.enabled ? 'active' : ''} disabled={disabled} onClick={() => updateBandDynamics(selectedBand, { enabled: selectedBand.dynamic?.enabled !== true })}>
          Dyn
        </button>
        <select value={selectedBand.dynamic?.mode ?? 'compress'} disabled={disabled} aria-label="Dynamic EQ mode" onChange={(event) => updateBandDynamics(selectedBand, { mode: event.currentTarget.value as AudioEqBandDynamics['mode'] })}>
          <option value="compress">Compress</option>
          <option value="expand">Expand</option>
        </select>
        {renderBandNumericKeyframeToggle(selectedBand, 'dynamic.thresholdDb', selectedBand.dynamic?.thresholdDb ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.thresholdDb)}
        <DraggableNumber value={selectedBand.dynamic?.thresholdDb ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.thresholdDb} onChange={(value) => updateBandDynamics(selectedBand, { thresholdDb: clamp(value, -120, 24) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_DYNAMICS.thresholdDb} min={-120} max={24} decimals={1} suffix=" dB" sensitivity={0.2} />
        {renderBandNumericKeyframeToggle(selectedBand, 'dynamic.rangeDb', selectedBand.dynamic?.rangeDb ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.rangeDb)}
        <DraggableNumber value={selectedBand.dynamic?.rangeDb ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.rangeDb} onChange={(value) => updateBandDynamics(selectedBand, { rangeDb: clamp(value, 0, 60) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_DYNAMICS.rangeDb} min={0} max={60} decimals={1} suffix=" dB" sensitivity={0.16} />
        {renderBandNumericKeyframeToggle(selectedBand, 'dynamic.ratio', selectedBand.dynamic?.ratio ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.ratio)}
        <DraggableNumber value={selectedBand.dynamic?.ratio ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.ratio} onChange={(value) => updateBandDynamics(selectedBand, { ratio: clamp(value, 1, 100) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_DYNAMICS.ratio} min={1} max={100} decimals={1} suffix=":1" sensitivity={0.08} />
        {renderBandNumericKeyframeToggle(selectedBand, 'dynamic.attackMs', selectedBand.dynamic?.attackMs ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.attackMs)}
        <DraggableNumber value={selectedBand.dynamic?.attackMs ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.attackMs} onChange={(value) => updateBandDynamics(selectedBand, { attackMs: clamp(value, 0.1, 5000) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_DYNAMICS.attackMs} min={0.1} max={5000} decimals={1} suffix=" ms" sensitivity={0.12} />
        {renderBandNumericKeyframeToggle(selectedBand, 'dynamic.releaseMs', selectedBand.dynamic?.releaseMs ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.releaseMs)}
        <DraggableNumber value={selectedBand.dynamic?.releaseMs ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.releaseMs} onChange={(value) => updateBandDynamics(selectedBand, { releaseMs: clamp(value, 1, 10000) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_DYNAMICS.releaseMs} min={1} max={10000} decimals={0} suffix=" ms" sensitivity={2} />
      </div>
    );
  }

  if (advancedPanel === 'spectral') {
    return (
      <div className="flex-eq-spectral-row">
        <button type="button" className={selectedBand.spectralDynamics?.enabled ? 'active' : ''} disabled={disabled || selectedBand.type === 'all-pass'} onClick={() => updateBandSpectralDynamics(selectedBand, { enabled: selectedBand.spectralDynamics?.enabled !== true })}>
          Spec
        </button>
        <select value={selectedBand.spectralDynamics?.mode ?? 'compress'} disabled={disabled || selectedBand.type === 'all-pass'} aria-label="Spectral Dynamics mode" onChange={(event) => updateBandSpectralDynamics(selectedBand, { mode: event.currentTarget.value as AudioEqBandSpectralDynamics['mode'] })}>
          <option value="compress">Compress</option>
          <option value="expand">Expand</option>
        </select>
        {renderBandNumericKeyframeToggle(selectedBand, 'spectralDynamics.thresholdDb', selectedBand.spectralDynamics?.thresholdDb ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.thresholdDb)}
        <DraggableNumber value={selectedBand.spectralDynamics?.thresholdDb ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.thresholdDb} onChange={(value) => updateBandSpectralDynamics(selectedBand, { thresholdDb: clamp(value, -120, 24) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.thresholdDb} min={-120} max={24} decimals={1} suffix=" dB" sensitivity={0.2} />
        {renderBandNumericKeyframeToggle(selectedBand, 'spectralDynamics.rangeDb', selectedBand.spectralDynamics?.rangeDb ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.rangeDb)}
        <DraggableNumber value={selectedBand.spectralDynamics?.rangeDb ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.rangeDb} onChange={(value) => updateBandSpectralDynamics(selectedBand, { rangeDb: clamp(value, 0, 60) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.rangeDb} min={0} max={60} decimals={1} suffix=" dB" sensitivity={0.16} />
        {renderBandNumericKeyframeToggle(selectedBand, 'spectralDynamics.ratio', selectedBand.spectralDynamics?.ratio ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.ratio)}
        <DraggableNumber value={selectedBand.spectralDynamics?.ratio ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.ratio} onChange={(value) => updateBandSpectralDynamics(selectedBand, { ratio: clamp(value, 1, 100) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.ratio} min={1} max={100} decimals={1} suffix=":1" sensitivity={0.08} />
        {renderBandNumericKeyframeToggle(selectedBand, 'spectralDynamics.attackMs', selectedBand.spectralDynamics?.attackMs ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.attackMs)}
        <DraggableNumber value={selectedBand.spectralDynamics?.attackMs ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.attackMs} onChange={(value) => updateBandSpectralDynamics(selectedBand, { attackMs: clamp(value, 0.1, 5000) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.attackMs} min={0.1} max={5000} decimals={1} suffix=" ms" sensitivity={0.12} />
        {renderBandNumericKeyframeToggle(selectedBand, 'spectralDynamics.releaseMs', selectedBand.spectralDynamics?.releaseMs ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.releaseMs)}
        <DraggableNumber value={selectedBand.spectralDynamics?.releaseMs ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.releaseMs} onChange={(value) => updateBandSpectralDynamics(selectedBand, { releaseMs: clamp(value, 1, 10000) })} defaultValue={AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.releaseMs} min={1} max={10000} decimals={0} suffix=" ms" sensitivity={2} />
        <select value={selectedBand.spectralDynamics?.resolution ?? 'balanced'} disabled={disabled || selectedBand.type === 'all-pass'} aria-label="Spectral Dynamics resolution" onChange={(event) => updateBandSpectralDynamics(selectedBand, { resolution: event.currentTarget.value as AudioEqBandSpectralDynamics['resolution'] })}>
          <option value="low-latency">Low</option>
          <option value="balanced">Bal</option>
          <option value="mastering">Mast</option>
        </select>
      </div>
    );
  }

  return null;
}
