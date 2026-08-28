import {
  coerceVectorAnimationDataBindingValue,
  coerceVectorAnimationInputValue,
  createVectorAnimationDataBindingProperty,
  createVectorAnimationInputProperty,
  getVectorAnimationDataBindingDefaultValue,
  getVectorAnimationInputNumericValue,
  vectorAnimationDataBindingValueToNumber,
  vectorAnimationInputValueToNumber,
  type VectorAnimationClipSettings,
  type VectorAnimationDataBindingProperty,
  type VectorAnimationDataBindingValue,
  type VectorAnimationStateMachineInput,
  type VectorAnimationStateMachineInputValue,
} from '../../../../types/vectorAnimation';
import type {
  LottieSetNumericProperty,
  LottieSettingsUpdater,
} from './lottieTabTypes';

interface UseLottieValueInteractionsArgs {
  clipId: string;
  liveSettings: VectorAnimationClipSettings;
  selectedStateMachineName: string;
  selectedViewModelName: string;
  settings: VectorAnimationClipSettings;
  setPropertyValue: LottieSetNumericProperty;
  updateSettings: LottieSettingsUpdater;
}

export function useLottieValueInteractions({
  clipId,
  liveSettings,
  selectedStateMachineName,
  selectedViewModelName,
  settings,
  setPropertyValue,
  updateSettings,
}: UseLottieValueInteractionsArgs) {
  const getInputValue = (input: VectorAnimationStateMachineInput): VectorAnimationStateMachineInputValue => (
    coerceVectorAnimationInputValue(
      input,
      liveSettings.stateMachineInputValues?.[input.name] ?? settings.stateMachineInputValues?.[input.name],
    )
  );

  const updateInputValue = (
    input: VectorAnimationStateMachineInput,
    value: VectorAnimationStateMachineInputValue,
  ) => {
    if (!selectedStateMachineName || input.type === 'trigger') {
      return;
    }

    const property = createVectorAnimationInputProperty(selectedStateMachineName, input.name);
    if (input.type === 'string') {
      updateSettings({
        stateMachineInputValues: {
          ...(settings.stateMachineInputValues ?? {}),
          [input.name]: String(value),
        },
      });
      return;
    }

    setPropertyValue(
      clipId,
      property,
      input.type === 'boolean' ? Number(Boolean(value)) : vectorAnimationInputValueToNumber(value),
    );
  };

  const getDataBindingValue = (
    property: VectorAnimationDataBindingProperty,
  ): VectorAnimationDataBindingValue => (
    coerceVectorAnimationDataBindingValue(
      property,
      liveSettings.dataBindingValues?.[property.name] ??
        settings.dataBindingValues?.[property.name] ??
        getVectorAnimationDataBindingDefaultValue(property),
    )
  );

  const updateDataBindingValue = (
    property: VectorAnimationDataBindingProperty,
    value: VectorAnimationDataBindingValue,
  ) => {
    if (property.type === 'trigger') {
      return;
    }

    const normalizedValue = coerceVectorAnimationDataBindingValue(property, value);
    if (property.type === 'string' || property.type === 'enum') {
      updateSettings({
        viewModelName: selectedViewModelName || settings.viewModelName,
        dataBindingValues: {
          ...(settings.dataBindingValues ?? {}),
          [property.name]: normalizedValue,
        },
      });
      return;
    }

    const propertyPath = createVectorAnimationDataBindingProperty(property.name);
    setPropertyValue(
      clipId,
      propertyPath,
      vectorAnimationDataBindingValueToNumber(normalizedValue),
    );
  };

  return {
    getDataBindingValue,
    getInputValue,
    getVectorAnimationInputNumericValue,
    updateDataBindingValue,
    updateInputValue,
  };
}
