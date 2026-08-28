import type { AnimatableProperty, Keyframe, TimelineClip } from '../../../types';
import {
  getVectorAnimationStateLabelAtIndex,
  isVectorAnimationSourceType,
  mergeVectorAnimationSettings,
  parseVectorAnimationDataBindingProperty,
  parseVectorAnimationInputProperty,
  parseVectorAnimationStateProperty,
} from '../../../types/vectorAnimation';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';
import {
  getVectorAnimationDataBindingBaseValue,
  getVectorAnimationInputBaseValue,
  getVectorAnimationStateBaseValue,
  getVectorAnimationStateNames,
} from '../../../stores/timeline/keyframes/vectorAnimationKeyframeValues';
import type { HeaderKeyframe, KeyframeTrackClip } from './timelineHeaderPropertyTypes';

export function getTimelineHeaderVectorAnimationPropertyValue(
  clip: KeyframeTrackClip,
  prop: string,
  keyframes: HeaderKeyframe[],
  clipLocalTime: number,
): number | null {
  const inputProperty = parseVectorAnimationInputProperty(prop);
  const dataBindingProperty = parseVectorAnimationDataBindingProperty(prop);
  const stateProperty = parseVectorAnimationStateProperty(prop);
  if (!inputProperty && !dataBindingProperty && !stateProperty) return null;
  if (!isVectorAnimationSourceType(clip.source?.type)) return null;

  const settings = mergeVectorAnimationSettings(clip.source.vectorAnimationSettings);
  const baseValue = inputProperty
    ? getVectorAnimationInputBaseValue(
      clip as TimelineClip,
      settings,
      inputProperty.stateMachineName,
      inputProperty.inputName,
    )
    : dataBindingProperty
      ? getVectorAnimationDataBindingBaseValue(
        clip as TimelineClip,
        settings,
        dataBindingProperty.propertyName,
      )
      : stateProperty
        ? getVectorAnimationStateBaseValue(
          clip as TimelineClip,
          settings,
          stateProperty.stateMachineName,
        )
        : 0;

  return interpolateKeyframes(
    keyframes as Keyframe[],
    prop as AnimatableProperty,
    clipLocalTime,
    baseValue,
  );
}

export function formatTimelineHeaderVectorAnimationPropertyValue(
  value: number,
  prop: string,
  clip?: KeyframeTrackClip | null,
): string | null {
  const stateProperty = parseVectorAnimationStateProperty(prop);
  if (stateProperty && isVectorAnimationSourceType(clip?.source?.type)) {
    const stateNames = getVectorAnimationStateNames(
      clip as TimelineClip,
      stateProperty.stateMachineName,
    );
    return getVectorAnimationStateLabelAtIndex(stateNames, value) ?? `State ${Math.round(value)}`;
  }

  if (parseVectorAnimationInputProperty(prop) || parseVectorAnimationDataBindingProperty(prop)) {
    return value === 0 || value === 1 ? (value >= 0.5 ? 'On' : 'Off') : value.toFixed(2);
  }

  return null;
}
