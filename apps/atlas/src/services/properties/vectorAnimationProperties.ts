
import type { TimelineClip } from '../../types/timeline';
import {
  DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
  coerceVectorAnimationDataBindingValue,
  createVectorAnimationDataBindingProperty,
  createVectorAnimationInputProperty,
  createVectorAnimationStateProperty,
  getVectorAnimationDataBindingDefaultValue,
  isVectorAnimationSourceType,
  mergeVectorAnimationSettings,
  parseVectorAnimationDataBindingProperty,
  parseVectorAnimationInputProperty,
  parseVectorAnimationStateProperty,
  type VectorAnimationDataBindingProperty,
} from '../../types/vectorAnimation';
import type { PropertyDescriptor } from '../../types/propertyRegistry';
import { useMediaStore } from '../../stores/mediaStore';

function getVectorDataBindingProperty(
  clip: TimelineClip,
  propertyName: string,
): VectorAnimationDataBindingProperty | undefined {
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  const metadata = mediaFileId
    ? useMediaStore.getState().files.find((file) => file.id === mediaFileId)?.vectorAnimation
    : undefined;
  const settings = mergeVectorAnimationSettings(clip.source?.vectorAnimationSettings);
  const viewModelName = settings.viewModelName ?? metadata?.defaultViewModelName;

  return metadata?.dataBindingProperties?.find((property) => (
    property.name === propertyName &&
    (!viewModelName || !property.viewModelName || property.viewModelName === viewModelName)
  ));
}

export function getVectorDescriptorForPath(path: string, clip?: TimelineClip): PropertyDescriptor | undefined {
  if (!isVectorAnimationSourceType(clip?.source?.type)) return undefined;

  const stateProperty = parseVectorAnimationStateProperty(path);
  if (stateProperty) {
    const settings = mergeVectorAnimationSettings(clip.source.vectorAnimationSettings);
    return {
      path,
      label: `${stateProperty.stateMachineName} State`,
      group: 'Vector Animation',
      valueType: 'enum',
      animatable: true,
      defaultValue: settings.stateMachineState ?? '',
      ui: { aliases: ['vector state', 'lottie state', 'rive state', stateProperty.stateMachineName] },
      read: (targetClip) => mergeVectorAnimationSettings(targetClip.source?.vectorAnimationSettings).stateMachineState ?? '',
      write: (targetClip, value) => ({
        ...targetClip,
        source: targetClip.source
          ? {
              ...targetClip.source,
              vectorAnimationSettings: {
                ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
                ...targetClip.source.vectorAnimationSettings,
                stateMachineName: stateProperty.stateMachineName,
                stateMachineState: String(value),
                stateMachineStateCues: undefined,
              },
            }
          : targetClip.source,
      }),
    };
  }

  const inputProperty = parseVectorAnimationInputProperty(path);
  if (!inputProperty) {
    const dataBindingPropertyPath = parseVectorAnimationDataBindingProperty(path);
    if (!dataBindingPropertyPath) return undefined;

    const settings = mergeVectorAnimationSettings(clip.source.vectorAnimationSettings);
    const metadataProperty = getVectorDataBindingProperty(clip, dataBindingPropertyPath.propertyName);
    const currentValue =
      settings.dataBindingValues?.[dataBindingPropertyPath.propertyName] ??
      (metadataProperty ? getVectorAnimationDataBindingDefaultValue(metadataProperty) : 0);
    return {
      path,
      label: dataBindingPropertyPath.propertyName,
      group: 'Vector Animation / Data Binding',
      valueType: metadataProperty?.type === 'boolean'
        ? 'boolean'
        : metadataProperty?.type === 'string' || metadataProperty?.type === 'enum'
          ? 'enum'
          : metadataProperty?.type === 'color'
            ? 'color'
            : 'number',
      animatable: metadataProperty?.type !== 'string' && metadataProperty?.type !== 'enum' && metadataProperty?.type !== 'trigger',
      defaultValue: currentValue,
      ui: {
        aliases: ['rive data', 'data binding', dataBindingPropertyPath.propertyName],
        options: metadataProperty?.values?.map((value) => ({ value, label: value })),
      },
      read: (targetClip) => {
        const targetSettings = mergeVectorAnimationSettings(targetClip.source?.vectorAnimationSettings);
        return targetSettings.dataBindingValues?.[dataBindingPropertyPath.propertyName] ?? currentValue;
      },
      write: (targetClip, value) => {
        const targetSettings = mergeVectorAnimationSettings(targetClip.source?.vectorAnimationSettings);
        const nextValue = metadataProperty
          ? coerceVectorAnimationDataBindingValue(metadataProperty, value as boolean | number | string)
          : value as boolean | number | string;
        return {
          ...targetClip,
          source: targetClip.source
            ? {
                ...targetClip.source,
                vectorAnimationSettings: {
                  ...targetSettings,
                  dataBindingValues: {
                    ...(targetSettings.dataBindingValues ?? {}),
                    [dataBindingPropertyPath.propertyName]: nextValue,
                  },
                },
              }
            : targetClip.source,
        };
      },
    };
  }

  const settings = mergeVectorAnimationSettings(clip.source.vectorAnimationSettings);
  const currentValue = settings.stateMachineInputValues?.[inputProperty.inputName] ?? 0;
  return {
    path,
    label: inputProperty.inputName,
    group: 'Vector Animation',
    valueType: typeof currentValue === 'boolean' ? 'boolean' : typeof currentValue === 'string' ? 'enum' : 'number',
    animatable: typeof currentValue !== 'string',
    defaultValue: currentValue,
    ui: { aliases: ['vector input', 'lottie input', 'rive input', inputProperty.stateMachineName] },
    read: (targetClip) => {
      const targetSettings = mergeVectorAnimationSettings(targetClip.source?.vectorAnimationSettings);
      return targetSettings.stateMachineInputValues?.[inputProperty.inputName] ?? currentValue;
    },
    write: (targetClip, value) => {
      const targetSettings = mergeVectorAnimationSettings(targetClip.source?.vectorAnimationSettings);
      return {
        ...targetClip,
        source: targetClip.source
          ? {
              ...targetClip.source,
              vectorAnimationSettings: {
                ...targetSettings,
                stateMachineName: inputProperty.stateMachineName,
                stateMachineInputValues: {
                  ...(targetSettings.stateMachineInputValues ?? {}),
                  [inputProperty.inputName]: value as boolean | number | string,
                },
              },
            }
          : targetClip.source,
      };
    },
  };
}

export function getVectorDescriptorsForClip(clip: TimelineClip): PropertyDescriptor[] {
  if (!isVectorAnimationSourceType(clip.source?.type)) return [];

  const settings = mergeVectorAnimationSettings(clip.source.vectorAnimationSettings);
  const descriptors: PropertyDescriptor[] = [];
  if (settings.stateMachineName) {
    const stateDescriptor = getVectorDescriptorForPath(
      createVectorAnimationStateProperty(settings.stateMachineName),
      clip,
    );
    if (stateDescriptor) descriptors.push(stateDescriptor);

    Object.keys(settings.stateMachineInputValues ?? {}).forEach((inputName) => {
      const descriptor = getVectorDescriptorForPath(
        createVectorAnimationInputProperty(settings.stateMachineName!, inputName),
        clip,
      );
      if (descriptor) descriptors.push(descriptor);
    });
  }
  Object.keys(settings.dataBindingValues ?? {}).forEach((propertyName) => {
    const descriptor = getVectorDescriptorForPath(
      createVectorAnimationDataBindingProperty(propertyName),
      clip,
    );
    if (descriptor) descriptors.push(descriptor);
  });
  return descriptors;
}
