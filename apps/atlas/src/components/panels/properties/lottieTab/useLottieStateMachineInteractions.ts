import { useEffect } from 'react';

import {
  getVectorAnimationStateIndex,
  normalizeVectorAnimationStateCues,
  normalizeVectorAnimationStateName,
  type VectorAnimationClipSettings,
  type VectorAnimationStateProperty,
} from '../../../../types/vectorAnimation';
import type {
  LottieAddStateKeyframe,
  LottieSetNumericProperty,
  LottieSettingsUpdater,
  LottieUpdateStateKeyframe,
} from './lottieTabTypes';

interface LottieStateMachineClip {
  duration: number;
}

interface UseLottieStateMachineInteractionsArgs {
  clip: LottieStateMachineClip | undefined;
  clipId: string;
  clipLocalTime: number;
  currentStateIndex: number;
  settings: VectorAnimationClipSettings;
  stateMachineStateNames: string[];
  stateProperty: VectorAnimationStateProperty | null;
  addKeyframe: LottieAddStateKeyframe;
  setPropertyValue: LottieSetNumericProperty;
  updateKeyframe: LottieUpdateStateKeyframe;
  updateSettings: LottieSettingsUpdater;
}

export function useLottieStateMachineInteractions({
  clip,
  clipId,
  clipLocalTime,
  currentStateIndex,
  settings,
  stateMachineStateNames,
  stateProperty,
  addKeyframe,
  setPropertyValue,
  updateKeyframe,
  updateSettings,
}: UseLottieStateMachineInteractionsArgs) {
  useEffect(() => {
    if (
      !clip ||
      !stateProperty ||
      stateMachineStateNames.length === 0 ||
      !settings.stateMachineStateCues ||
      settings.stateMachineStateCues.length === 0
    ) {
      return;
    }

    normalizeVectorAnimationStateCues(settings.stateMachineStateCues).forEach((cue) => {
      addKeyframe(
        clipId,
        stateProperty,
        getVectorAnimationStateIndex(stateMachineStateNames, cue.stateName),
        Math.max(0, Math.min(cue.time, clip.duration)),
        'linear',
      );
    });
    updateSettings({ stateMachineStateCues: undefined });
  }, [
    addKeyframe,
    clip,
    clipId,
    settings.stateMachineStateCues,
    stateMachineStateNames,
    stateProperty,
    updateSettings,
  ]);

  const setStateValue = (stateName: string) => {
    if (!stateProperty || stateMachineStateNames.length === 0) {
      updateSettings({
        stateMachineState: normalizeVectorAnimationStateName(stateName),
        stateMachineStateCues: undefined,
      });
      return;
    }

    setPropertyValue(
      clipId,
      stateProperty,
      getVectorAnimationStateIndex(stateMachineStateNames, stateName),
    );
  };

  const addStateKeyframeAtPlayhead = () => {
    if (!clip || !stateProperty || stateMachineStateNames.length === 0) {
      return;
    }

    addKeyframe(
      clipId,
      stateProperty,
      currentStateIndex,
      Math.max(0, Math.min(clipLocalTime, clip.duration)),
      'linear',
    );
  };

  const updateStateKeyframeValue = (keyframeId: string, stateName: string) => {
    updateKeyframe(keyframeId, {
      value: getVectorAnimationStateIndex(stateMachineStateNames, stateName),
    });
  };

  const updateStateKeyframeTime = (keyframeId: string, time: number) => {
    if (!clip) {
      return;
    }

    updateKeyframe(keyframeId, {
      time: Math.max(0, Math.min(time, clip.duration)),
    });
  };

  return {
    addStateKeyframeAtPlayhead,
    setStateValue,
    updateStateKeyframeTime,
    updateStateKeyframeValue,
  };
}
