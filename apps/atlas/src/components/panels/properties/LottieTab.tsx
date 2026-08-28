import { useCallback, useState } from 'react';

import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import {
  DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
  createVectorAnimationStateProperty,
  getVectorAnimationStateIndex,
  isVectorAnimationSourceType,
  type VectorAnimationClipSettings,
  type VectorAnimationStateMachineInput,
} from '../../../types/vectorAnimation';
import { LottieBackgroundSection } from './lottieTab/LottieBackgroundSection';
import { LottieControlsSection } from './lottieTab/LottieControlsSection';
import { LottieDataBindingSection } from './lottieTab/LottieDataBindingSection';
import { LottieStateMachineSection } from './lottieTab/LottieStateMachineSection';
import { LottieSummarySection } from './lottieTab/LottieSummarySection';
import { useLottieResolutionDraft } from './lottieTab/useLottieResolutionDraft';
import { useLottieStateMachineInteractions } from './lottieTab/useLottieStateMachineInteractions';
import { useLottieValueInteractions } from './lottieTab/useLottieValueInteractions';

interface LottieTabProps {
  clipId: string;
}

const EMPTY_STATE_NAMES: string[] = [];
const EMPTY_STATE_MACHINE_INPUTS: VectorAnimationStateMachineInput[] = [];

export function LottieTab({ clipId }: LottieTabProps) {
  const clip = useTimelineStore((state) => state.clips.find((current) => current.id === clipId));
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const clipKeyframes = useTimelineStore((state) => state.clipKeyframes);
  const setPropertyValue = useTimelineStore((state) => state.setPropertyValue);
  const addKeyframe = useTimelineStore((state) => state.addKeyframe);
  const updateKeyframe = useTimelineStore((state) => state.updateKeyframe);
  const removeKeyframe = useTimelineStore((state) => state.removeKeyframe);
  const getInterpolatedVectorAnimationSettings = useTimelineStore((state) => state.getInterpolatedVectorAnimationSettings);
  const files = useMediaStore((state) => state.files);
  const [resolutionLinked, setResolutionLinked] = useState(true);

  const mediaFile = clip?.source?.mediaFileId
    ? files.find((file) => file.id === clip.source?.mediaFileId)
    : undefined;
  const metadata = mediaFile?.vectorAnimation;
  const providerName = metadata?.provider === 'rive' ? 'Rive' : 'Lottie';
  const settings: VectorAnimationClipSettings = {
    ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
    ...clip?.source?.vectorAnimationSettings,
  };
  const animationNames = metadata?.animationNames ?? [];
  const artboardNames = metadata?.artboardNames ?? [];
  const stateMachineNames = metadata?.stateMachineNames ?? [];
  const selectedStateMachineName = settings.stateMachineName ?? '';
  const stateMachineStateNames = selectedStateMachineName
    ? metadata?.stateMachineStates?.[selectedStateMachineName] ?? EMPTY_STATE_NAMES
    : EMPTY_STATE_NAMES;
  const stateMachineInputs = selectedStateMachineName
    ? metadata?.stateMachineInputs?.[selectedStateMachineName] ?? EMPTY_STATE_MACHINE_INPUTS
    : EMPTY_STATE_MACHINE_INPUTS;
  const stateProperty = selectedStateMachineName
    ? createVectorAnimationStateProperty(selectedStateMachineName)
    : null;
  const clipKeyframeList = clipKeyframes.get(clipId) ?? [];
  const stateKeyframes = stateProperty
    ? clipKeyframeList
      .filter((keyframe) => keyframe.property === stateProperty)
      .toSorted((a, b) => a.time - b.time)
    : [];
  const clipLocalTime = clip
    ? Math.max(0, Math.min(playheadPosition - clip.startTime, clip.duration))
    : 0;
  const liveSettings = clip
    ? getInterpolatedVectorAnimationSettings(clipId, clipLocalTime)
    : settings;
  const currentStateName = liveSettings.stateMachineState ?? settings.stateMachineState ?? stateMachineStateNames[0] ?? '';
  const currentStateIndex = getVectorAnimationStateIndex(stateMachineStateNames, currentStateName);
  const viewModels = metadata?.viewModels ?? [];
  const selectedViewModelName = settings.viewModelName ?? metadata?.defaultViewModelName ?? viewModels[0]?.name ?? '';
  const selectedViewModel = selectedViewModelName
    ? viewModels.find((viewModel) => viewModel.name === selectedViewModelName)
    : undefined;
  const dataBindingProperties = selectedViewModel?.properties ?? [];

  const updateSettings = useCallback((updates: Partial<VectorAnimationClipSettings>) => {
    const { clips } = useTimelineStore.getState();
    const current = clips.find((candidate) => candidate.id === clipId);
    if (!current?.source || !isVectorAnimationSourceType(current.source.type)) {
      return;
    }

    useTimelineStore.setState({
      clips: clips.map((candidate) =>
        candidate.id === clipId
          ? {
              ...candidate,
              source: {
                ...candidate.source!,
                vectorAnimationSettings: {
                  ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
                  ...candidate.source?.vectorAnimationSettings,
                  ...updates,
                },
              },
            }
          : candidate
      ),
    });
    useTimelineStore.getState().invalidateCache();
  }, [clipId]);

  const {
    resolutionDraft,
    commitRenderDimensions,
    updateRenderDimensionDraft,
    handleResolutionKeyDown,
    resetRenderDimensions,
  } = useLottieResolutionDraft({
    settings,
    metadataWidth: metadata?.width,
    metadataHeight: metadata?.height,
    resolutionLinked,
    updateSettings,
  });

  const {
    addStateKeyframeAtPlayhead,
    setStateValue,
    updateStateKeyframeTime,
    updateStateKeyframeValue,
  } = useLottieStateMachineInteractions({
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
  });

  const {
    getDataBindingValue,
    getInputValue,
    updateDataBindingValue,
    updateInputValue,
  } = useLottieValueInteractions({
    clipId,
    liveSettings,
    selectedStateMachineName,
    selectedViewModelName,
    settings,
    setPropertyValue,
    updateSettings,
  });

  if (!clip || !isVectorAnimationSourceType(clip.source?.type)) {
    return null;
  }

  return (
    <div className="properties-tab-content lottie-tab">
      <LottieSummarySection
        clipName={clip.name}
        metadata={metadata}
        providerName={providerName}
        settings={settings}
        updateSettings={updateSettings}
      />

      <LottieControlsSection
        animationNames={animationNames}
        artboardNames={artboardNames}
        metadata={metadata}
        resolutionDraft={resolutionDraft}
        resolutionLinked={resolutionLinked}
        settings={settings}
        setResolutionLinked={setResolutionLinked}
        updateSettings={updateSettings}
        onCommitRenderDimensions={commitRenderDimensions}
        onResolutionKeyDown={handleResolutionKeyDown}
        onResetRenderDimensions={resetRenderDimensions}
        onUpdateRenderDimensionDraft={updateRenderDimensionDraft}
      />

      <LottieStateMachineSection
        clipDuration={clip.duration}
        clipId={clipId}
        clipKeyframes={clipKeyframeList}
        clipLocalTime={clipLocalTime}
        currentStateIndex={currentStateIndex}
        currentStateName={currentStateName}
        liveSettings={liveSettings}
        selectedStateMachineName={selectedStateMachineName}
        settings={settings}
        stateKeyframes={stateKeyframes}
        stateMachineInputs={stateMachineInputs}
        stateMachineNames={stateMachineNames}
        stateMachineStateNames={stateMachineStateNames}
        stateProperty={stateProperty}
        getInputValue={getInputValue}
        updateInputValue={updateInputValue}
        updateSettings={updateSettings}
        onAddStateKeyframeAtPlayhead={addStateKeyframeAtPlayhead}
        onRemoveKeyframe={removeKeyframe}
        onSetStateValue={setStateValue}
        onUpdateStateKeyframeTime={updateStateKeyframeTime}
        onUpdateStateKeyframeValue={updateStateKeyframeValue}
      />

      <LottieDataBindingSection
        clipId={clipId}
        clipKeyframes={clipKeyframeList}
        dataBindingProperties={dataBindingProperties}
        selectedViewModel={selectedViewModel}
        selectedViewModelName={selectedViewModelName}
        settings={settings}
        viewModels={viewModels}
        getDataBindingValue={getDataBindingValue}
        updateDataBindingValue={updateDataBindingValue}
        updateSettings={updateSettings}
      />

      <LottieBackgroundSection
        settings={settings}
        updateSettings={updateSettings}
      />
    </div>
  );
}
