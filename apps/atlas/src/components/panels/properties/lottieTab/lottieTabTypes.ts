import type {
  VectorAnimationClipSettings,
  VectorAnimationDataBindingPropertyPath,
  VectorAnimationInputProperty,
  VectorAnimationStateProperty,
} from '../../../../types/vectorAnimation';

export type LottieSettingsUpdater = (updates: Partial<VectorAnimationClipSettings>) => void;

export type LottieNumericProperty =
  | VectorAnimationInputProperty
  | VectorAnimationStateProperty
  | VectorAnimationDataBindingPropertyPath;

export type LottieSetNumericProperty = (
  clipId: string,
  property: LottieNumericProperty,
  value: number,
) => void;

export type LottieAddStateKeyframe = (
  clipId: string,
  property: VectorAnimationStateProperty,
  value: number,
  time?: number,
  easing?: string | null,
) => void;

export type LottieUpdateStateKeyframe = (
  keyframeId: string,
  updates: { value?: number; time?: number },
) => void;

export interface LottieStateKeyframe {
  id: string;
  time: number;
  value: number;
}

export interface ResolutionDraft {
  sourceKey: string;
  width: string;
  height: string;
}
