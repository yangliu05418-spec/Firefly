import {
  createVectorAnimationDataBindingProperty,
  vectorAnimationDataBindingValueToNumber,
  type VectorAnimationClipSettings,
  type VectorAnimationDataBindingProperty,
  type VectorAnimationDataBindingValue,
  type VectorAnimationViewModelMetadata,
} from '../../../../types/vectorAnimation';
import { DraggableNumber, KeyframeToggle } from '../shared';
import {
  formatDataBindingType,
  hexToRiveColor,
  riveColorToHex,
} from './lottieMappings';
import type { LottieSettingsUpdater } from './lottieTabTypes';

interface ClipKeyframeProperty {
  property: string;
}

interface LottieDataBindingSectionProps {
  clipId: string;
  clipKeyframes: readonly ClipKeyframeProperty[];
  dataBindingProperties: readonly VectorAnimationDataBindingProperty[];
  selectedViewModel: VectorAnimationViewModelMetadata | undefined;
  selectedViewModelName: string;
  settings: VectorAnimationClipSettings;
  viewModels: readonly VectorAnimationViewModelMetadata[];
  getDataBindingValue: (property: VectorAnimationDataBindingProperty) => VectorAnimationDataBindingValue;
  updateDataBindingValue: (
    property: VectorAnimationDataBindingProperty,
    value: VectorAnimationDataBindingValue,
  ) => void;
  updateSettings: LottieSettingsUpdater;
}

export function LottieDataBindingSection({
  clipId,
  clipKeyframes,
  dataBindingProperties,
  selectedViewModel,
  selectedViewModelName,
  settings,
  viewModels,
  getDataBindingValue,
  updateDataBindingValue,
  updateSettings,
}: LottieDataBindingSectionProps) {
  if (viewModels.length === 0) {
    return null;
  }

  return (
    <div className="properties-section lottie-state-section">
      <h4>Data Binding</h4>

      <label className="lottie-field-row">
        <span className="lottie-field-label">View Model</span>
        <select
          className="lottie-select"
          value={selectedViewModelName}
          onChange={(event) => updateSettings({
            viewModelName: event.target.value || undefined,
            viewModelInstanceName: undefined,
            dataBindingValues: undefined,
          })}
        >
          {viewModels.map((viewModel) => (
            <option key={viewModel.name} value={viewModel.name}>
              {viewModel.name}
            </option>
          ))}
        </select>
      </label>

      {selectedViewModel?.instanceNames && selectedViewModel.instanceNames.length > 0 && (
        <label className="lottie-field-row">
          <span className="lottie-field-label">Instance</span>
          <select
            className="lottie-select"
            value={settings.viewModelInstanceName ?? ''}
            onChange={(event) => updateSettings({
              viewModelInstanceName: event.target.value || undefined,
              dataBindingValues: undefined,
            })}
          >
            <option value="">Default</option>
            {selectedViewModel.instanceNames.map((instanceName) => (
              <option key={instanceName} value={instanceName}>
                {instanceName}
              </option>
            ))}
          </select>
        </label>
      )}

      {dataBindingProperties.length > 0 && (
        <div className="lottie-input-list">
          <div className="lottie-subsection-title">Properties</div>
          {dataBindingProperties.map((property) => {
            const propertyPath = createVectorAnimationDataBindingProperty(property.name);
            const value = getDataBindingValue(property);
            const numericValue = vectorAnimationDataBindingValueToNumber(value);
            const isBooleanOn = Boolean(value);
            const hasKeyframesForProperty = clipKeyframes.some((keyframe) => keyframe.property === propertyPath);

            return (
              <div key={`${property.viewModelName}:${property.name}`} className={`lottie-input-row ${hasKeyframesForProperty ? 'has-keyframes' : ''}`}>
                <div className="lottie-input-label">
                  <span title={property.name}>{property.name}</span>
                  <span>{formatDataBindingType(property)}</span>
                </div>

                {property.type !== 'string' && property.type !== 'enum' && property.type !== 'trigger' && (
                  <KeyframeToggle
                    clipId={clipId}
                    property={propertyPath}
                    value={numericValue}
                  />
                )}

                {property.type === 'boolean' && (
                  <div className="lottie-boolean-control">
                    <button
                      type="button"
                      className={!isBooleanOn ? 'active' : ''}
                      onClick={() => updateDataBindingValue(property, false)}
                    >
                      Off
                    </button>
                    <button
                      type="button"
                      className={isBooleanOn ? 'active' : ''}
                      onClick={() => updateDataBindingValue(property, true)}
                    >
                      On
                    </button>
                  </div>
                )}

                {(property.type === 'number' || property.type === 'integer') && (
                  <DraggableNumber
                    value={numericValue}
                    onChange={(nextValue) => updateDataBindingValue(property, nextValue)}
                    defaultValue={vectorAnimationDataBindingValueToNumber(property.defaultValue)}
                    decimals={property.type === 'integer' ? 0 : 2}
                    sensitivity={20}
                  />
                )}

                {property.type === 'color' && (
                  <span className="lottie-color-swatch">
                    <input
                      type="color"
                      value={riveColorToHex(value)}
                      onChange={(event) => updateDataBindingValue(property, hexToRiveColor(event.target.value))}
                      aria-label={`${property.name} color`}
                    />
                  </span>
                )}

                {property.type === 'string' && (
                  <input
                    className="lottie-input lottie-input-static"
                    type="text"
                    value={String(value)}
                    onChange={(event) => updateDataBindingValue(property, event.target.value)}
                  />
                )}

                {property.type === 'enum' && (
                  <select
                    className="lottie-select"
                    value={String(value)}
                    onChange={(event) => updateDataBindingValue(property, event.target.value)}
                  >
                    {(property.values ?? []).map((enumValue) => (
                      <option key={enumValue} value={enumValue}>
                        {enumValue}
                      </option>
                    ))}
                  </select>
                )}

                {property.type === 'trigger' && (
                  <span className="lottie-input-note">Trigger</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
