import {
  createVectorAnimationInputProperty,
  getVectorAnimationInputNumericValue,
  normalizeVectorAnimationStateName,
  vectorAnimationInputValueToNumber,
  type VectorAnimationClipSettings,
  type VectorAnimationStateMachineInput,
  type VectorAnimationStateMachineInputValue,
  type VectorAnimationStateProperty,
} from '../../../../types/vectorAnimation';
import { DraggableNumber, KeyframeToggle } from '../shared';
import { formatInputType, formatSeconds } from './lottieMappings';
import type { LottieSettingsUpdater, LottieStateKeyframe } from './lottieTabTypes';

interface ClipKeyframeProperty {
  property: string;
}

interface LottieStateMachineSectionProps {
  clipDuration: number;
  clipId: string;
  clipKeyframes: readonly ClipKeyframeProperty[];
  clipLocalTime: number;
  currentStateIndex: number;
  currentStateName: string;
  liveSettings: VectorAnimationClipSettings;
  selectedStateMachineName: string;
  settings: VectorAnimationClipSettings;
  stateKeyframes: readonly LottieStateKeyframe[];
  stateMachineInputs: readonly VectorAnimationStateMachineInput[];
  stateMachineNames: readonly string[];
  stateMachineStateNames: readonly string[];
  stateProperty: VectorAnimationStateProperty | null;
  getInputValue: (input: VectorAnimationStateMachineInput) => VectorAnimationStateMachineInputValue;
  updateInputValue: (
    input: VectorAnimationStateMachineInput,
    value: VectorAnimationStateMachineInputValue,
  ) => void;
  updateSettings: LottieSettingsUpdater;
  onAddStateKeyframeAtPlayhead: () => void;
  onRemoveKeyframe: (keyframeId: string) => void;
  onSetStateValue: (stateName: string) => void;
  onUpdateStateKeyframeTime: (keyframeId: string, time: number) => void;
  onUpdateStateKeyframeValue: (keyframeId: string, stateName: string) => void;
}

export function LottieStateMachineSection({
  clipDuration,
  clipId,
  clipKeyframes,
  clipLocalTime,
  currentStateIndex,
  currentStateName,
  liveSettings,
  selectedStateMachineName,
  settings,
  stateKeyframes,
  stateMachineInputs,
  stateMachineNames,
  stateMachineStateNames,
  stateProperty,
  getInputValue,
  updateInputValue,
  updateSettings,
  onAddStateKeyframeAtPlayhead,
  onRemoveKeyframe,
  onSetStateValue,
  onUpdateStateKeyframeTime,
  onUpdateStateKeyframeValue,
}: LottieStateMachineSectionProps) {
  if (stateMachineNames.length === 0) {
    return null;
  }

  return (
    <div className="properties-section lottie-state-section">
      <h4>State Machine</h4>

      <label className="lottie-field-row">
        <span className="lottie-field-label">Machine</span>
        <select
          className="lottie-select"
          value={selectedStateMachineName}
          onChange={(event) => updateSettings({
            stateMachineName: event.target.value || undefined,
            stateMachineState: undefined,
            stateMachineStateCues: undefined,
            stateMachineInputValues: undefined,
          })}
        >
          <option value="">None</option>
          {stateMachineNames.map((stateMachineName) => (
            <option key={stateMachineName} value={stateMachineName}>
              {stateMachineName}
            </option>
          ))}
        </select>
      </label>

      {selectedStateMachineName && (
        <>
          <label className="lottie-field-row">
            <span className="lottie-field-label">State</span>
            {stateMachineStateNames.length > 0 && stateProperty ? (
              <div className="lottie-state-control">
                <KeyframeToggle
                  clipId={clipId}
                  property={stateProperty}
                  value={currentStateIndex}
                />
                <select
                  className="lottie-select"
                  value={currentStateName || stateMachineStateNames[0] || ''}
                  onChange={(event) => onSetStateValue(event.target.value)}
                >
                  {stateMachineStateNames.map((stateName) => (
                    <option key={stateName} value={stateName}>
                      {stateName}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <input
                className="lottie-input"
                type="text"
                value={settings.stateMachineState ?? ''}
                onChange={(event) => updateSettings({ stateMachineState: normalizeVectorAnimationStateName(event.target.value) })}
                placeholder="Initial"
              />
            )}
          </label>

          {stateMachineInputs.length > 0 && (
            <div className="lottie-input-list">
              <div className="lottie-subsection-title">Inputs</div>
              {stateMachineInputs.map((input) => {
                const property = createVectorAnimationInputProperty(selectedStateMachineName, input.name);
                const value = getInputValue(input);
                const numericValue = getVectorAnimationInputNumericValue(liveSettings, input);
                const isBooleanOn = Boolean(value);
                const hasKeyframesForInput = clipKeyframes.some((keyframe) => keyframe.property === property);

                return (
                  <div key={input.name} className={`lottie-input-row ${hasKeyframesForInput ? 'has-keyframes' : ''}`}>
                    <div className="lottie-input-label">
                      <span title={input.name}>{input.name}</span>
                      <span>{formatInputType(input)}</span>
                    </div>

                    {input.type !== 'string' && input.type !== 'trigger' && (
                      <KeyframeToggle
                        clipId={clipId}
                        property={property}
                        value={numericValue}
                      />
                    )}

                    {input.type === 'boolean' && (
                      <div className="lottie-boolean-control">
                        <button
                          type="button"
                          className={!isBooleanOn ? 'active' : ''}
                          onClick={() => updateInputValue(input, false)}
                        >
                          Off
                        </button>
                        <button
                          type="button"
                          className={isBooleanOn ? 'active' : ''}
                          onClick={() => updateInputValue(input, true)}
                        >
                          On
                        </button>
                      </div>
                    )}

                    {input.type === 'number' && (
                      <DraggableNumber
                        value={numericValue}
                        onChange={(nextValue) => updateInputValue(input, nextValue)}
                        defaultValue={vectorAnimationInputValueToNumber(input.defaultValue)}
                        decimals={2}
                        sensitivity={20}
                      />
                    )}

                    {input.type === 'string' && (
                      <input
                        className="lottie-input lottie-input-static"
                        type="text"
                        value={String(value)}
                        onChange={(event) => updateInputValue(input, event.target.value)}
                      />
                    )}

                    {input.type === 'trigger' && (
                      <span className="lottie-input-note">Trigger</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {stateMachineStateNames.length > 0 && stateProperty && (
            <div className="lottie-cue-panel">
              <button
                type="button"
                className="btn btn-xs lottie-cue-add-btn"
                onClick={onAddStateKeyframeAtPlayhead}
                disabled={!currentStateName}
              >
                Add State Keyframe at {formatSeconds(clipLocalTime)}
              </button>

              {stateKeyframes.length > 0 && (
                <div className="lottie-cue-list">
                  {stateKeyframes.map((keyframe) => {
                    const stateName = stateMachineStateNames[
                      Math.max(0, Math.min(stateMachineStateNames.length - 1, Math.round(keyframe.value)))
                    ] ?? '';

                    return (
                      <div key={keyframe.id} className="lottie-cue-row">
                        <input
                          className="lottie-input lottie-time-input"
                          type="number"
                          min={0}
                          max={clipDuration}
                          step={0.01}
                          value={Number(keyframe.time.toFixed(3))}
                          onChange={(event) => onUpdateStateKeyframeTime(keyframe.id, Number(event.target.value))}
                        />
                        <select
                          className="lottie-select"
                          value={stateName}
                          onChange={(event) => onUpdateStateKeyframeValue(keyframe.id, event.target.value)}
                        >
                          {stateMachineStateNames.map((candidateStateName) => (
                            <option key={candidateStateName} value={candidateStateName}>
                              {candidateStateName}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="lottie-cue-remove"
                          onClick={() => onRemoveKeyframe(keyframe.id)}
                          aria-label={`Remove ${stateName} state keyframe`}
                          title="Remove state keyframe"
                        >
                          x
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
