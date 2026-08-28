import type { KeyboardEvent } from 'react';

import type {
  VectorAnimationClipSettings,
  VectorAnimationMetadata,
  VectorAnimationPlaybackMode,
} from '../../../../types/vectorAnimation';
import type { LottieSettingsUpdater, ResolutionDraft } from './lottieTabTypes';

interface LottieControlsSectionProps {
  animationNames: string[];
  artboardNames: string[];
  metadata: VectorAnimationMetadata | undefined;
  resolutionDraft: ResolutionDraft;
  resolutionLinked: boolean;
  settings: VectorAnimationClipSettings;
  setResolutionLinked: (updater: (linked: boolean) => boolean) => void;
  updateSettings: LottieSettingsUpdater;
  onCommitRenderDimensions: () => void;
  onResolutionKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onResetRenderDimensions: () => void;
  onUpdateRenderDimensionDraft: (axis: 'width' | 'height', value: string) => void;
}

export function LottieControlsSection({
  animationNames,
  artboardNames,
  metadata,
  resolutionDraft,
  resolutionLinked,
  settings,
  setResolutionLinked,
  updateSettings,
  onCommitRenderDimensions,
  onResolutionKeyDown,
  onResetRenderDimensions,
  onUpdateRenderDimensionDraft,
}: LottieControlsSectionProps) {
  return (
    <div className="properties-section lottie-controls-section">
      <div className="lottie-field-row">
        <span className="lottie-field-label">Mode</span>
        <div className="lottie-segmented-control lottie-playback-mode">
          {[
            ['forward', 'Fwd'],
            ['reverse', 'Rev'],
            ['bounce', 'Bounce'],
            ['reverse-bounce', 'Rev Bounce'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={settings.playbackMode === value ? 'active' : ''}
              onClick={() => updateSettings({ playbackMode: value as VectorAnimationPlaybackMode })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="lottie-field-row">
        <span className="lottie-field-label">End</span>
        <div className="lottie-segmented-control">
          {[
            ['hold', 'Hold'],
            ['clear', 'Clear'],
            ['loop', 'Loop'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={settings.endBehavior === value ? 'active' : ''}
              onClick={() => updateSettings({ endBehavior: value as VectorAnimationClipSettings['endBehavior'] })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="lottie-field-row">
        <span className="lottie-field-label">Fit</span>
        <div className="lottie-segmented-control">
          {[
            ['contain', 'Contain'],
            ['cover', 'Cover'],
            ['fill', 'Fill'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={settings.fit === value ? 'active' : ''}
              onClick={() => updateSettings({ fit: value as VectorAnimationClipSettings['fit'] })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {artboardNames.length > 0 && (
        <label className="lottie-field-row">
          <span className="lottie-field-label">Artboard</span>
          <select
            className="lottie-select"
            value={settings.artboard ?? ''}
            onChange={(event) => updateSettings({
              artboard: event.target.value || undefined,
              animationName: undefined,
              stateMachineName: undefined,
              stateMachineState: undefined,
              stateMachineInputValues: undefined,
              viewModelName: undefined,
              viewModelInstanceName: undefined,
              dataBindingValues: undefined,
            })}
          >
            <option value="">Default</option>
            {artboardNames.map((artboardName) => (
              <option key={artboardName} value={artboardName}>
                {artboardName}
              </option>
            ))}
          </select>
        </label>
      )}

      {animationNames.length > 0 && (
        <label className="lottie-field-row">
          <span className="lottie-field-label">Animation</span>
          <select
            className="lottie-select"
            value={settings.animationName ?? metadata?.defaultAnimationName ?? animationNames[0]}
            onChange={(event) => updateSettings({ animationName: event.target.value || undefined })}
          >
            {animationNames.map((animationName) => (
              <option key={animationName} value={animationName}>
                {animationName}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="lottie-field-row">
        <span className="lottie-field-label">Resolution</span>
        <div className="lottie-resolution-row">
          <input
            className="lottie-input lottie-resolution-input"
            type="number"
            min={16}
            max={8192}
            step={1}
            value={resolutionDraft.width}
            onChange={(event) => onUpdateRenderDimensionDraft('width', event.target.value)}
            onBlur={() => onCommitRenderDimensions()}
            onKeyDown={onResolutionKeyDown}
          />
          <span>x</span>
          <input
            className="lottie-input lottie-resolution-input"
            type="number"
            min={16}
            max={8192}
            step={1}
            value={resolutionDraft.height}
            onChange={(event) => onUpdateRenderDimensionDraft('height', event.target.value)}
            onBlur={() => onCommitRenderDimensions()}
            onKeyDown={onResolutionKeyDown}
          />
          <button
            type="button"
            className={`lottie-link-toggle ${resolutionLinked ? 'active' : ''}`}
            onClick={() => setResolutionLinked((linked) => !linked)}
            title={resolutionLinked ? 'Unlink resolution' : 'Link resolution'}
          >
            1:1
          </button>
          <button
            type="button"
            className="btn btn-xs"
            onClick={onResetRenderDimensions}
          >
            Original
          </button>
        </div>
      </div>
    </div>
  );
}
