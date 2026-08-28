import type { TimelineClip } from '../../../types';
import type { AnimatableProperty, Keyframe } from '../types';
import { useMediaStore } from '../../mediaStore';
import {
  getVectorAnimationDataBindingDefaultValue,
  getVectorAnimationInputDefaultValue,
  getVectorAnimationStateIndex,
  mergeVectorAnimationSettings,
  vectorAnimationDataBindingValueToNumber,
  vectorAnimationInputValueToNumber,
  type VectorAnimationClipSettings,
  type VectorAnimationDataBindingProperty,
} from '../../../types/vectorAnimation';

export function getVectorAnimationInputBaseValue(
  clip: TimelineClip,
  settings: VectorAnimationClipSettings,
  stateMachineName: string,
  inputName: string,
): number {
  const explicitValue = settings.stateMachineInputValues?.[inputName];
  if (explicitValue !== undefined) {
    return vectorAnimationInputValueToNumber(explicitValue);
  }

  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  const input = mediaFileId
    ? useMediaStore
        .getState()
        .files
        .find((file) => file.id === mediaFileId)
        ?.vectorAnimation
        ?.stateMachineInputs
        ?.[stateMachineName]
        ?.find((candidate) => candidate.name === inputName)
    : undefined;

  return input
    ? vectorAnimationInputValueToNumber(getVectorAnimationInputDefaultValue(input))
    : 0;
}

export function getVectorAnimationDataBindingProperty(
  clip: TimelineClip,
  propertyName: string,
): VectorAnimationDataBindingProperty | undefined {
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  if (!mediaFileId) {
    return undefined;
  }

  const metadata = useMediaStore
    .getState()
    .files
    .find((file) => file.id === mediaFileId)
    ?.vectorAnimation;
  const settings = mergeVectorAnimationSettings(clip.source?.vectorAnimationSettings);
  const viewModelName = settings.viewModelName ?? metadata?.defaultViewModelName;

  return metadata
    ?.dataBindingProperties
    ?.find((property) => (
      property.name === propertyName &&
      (!viewModelName || !property.viewModelName || property.viewModelName === viewModelName)
    ));
}

export function getVectorAnimationDataBindingBaseValue(
  clip: TimelineClip,
  settings: VectorAnimationClipSettings,
  propertyName: string,
): number {
  const explicitValue = settings.dataBindingValues?.[propertyName];
  if (explicitValue !== undefined) {
    return vectorAnimationDataBindingValueToNumber(explicitValue);
  }

  const property = getVectorAnimationDataBindingProperty(clip, propertyName);
  return property
    ? vectorAnimationDataBindingValueToNumber(getVectorAnimationDataBindingDefaultValue(property))
    : 0;
}

export function getVectorAnimationStateNames(
  clip: TimelineClip,
  stateMachineName: string,
): string[] {
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  if (!mediaFileId) {
    return [];
  }

  return useMediaStore
    .getState()
    .files
    .find((file) => file.id === mediaFileId)
    ?.vectorAnimation
    ?.stateMachineStates
    ?.[stateMachineName] ?? [];
}

export function getVectorAnimationStateBaseValue(
  clip: TimelineClip,
  settings: VectorAnimationClipSettings,
  stateMachineName: string,
): number {
  return getVectorAnimationStateIndex(
    getVectorAnimationStateNames(clip, stateMachineName),
    settings.stateMachineState,
  );
}

export function normalizeVectorAnimationStateKeyframeValue(
  clip: TimelineClip,
  stateMachineName: string,
  value: number,
): number {
  const stateNames = getVectorAnimationStateNames(clip, stateMachineName);
  if (stateNames.length === 0) {
    return Math.max(0, Math.round(value));
  }
  return Math.max(0, Math.min(stateNames.length - 1, Math.round(value)));
}

export function getSteppedKeyframeValue(
  keyframes: Keyframe[],
  property: AnimatableProperty,
  clipLocalTime: number,
  baseValue: number,
): number {
  const sorted = keyframes
    .filter((keyframe) => keyframe.property === property)
    .sort((a, b) => a.time - b.time);
  let currentValue = baseValue;

  for (const keyframe of sorted) {
    if (keyframe.time > clipLocalTime + 1e-6) {
      break;
    }
    currentValue = keyframe.value;
  }

  return currentValue;
}
