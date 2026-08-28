import { useCallback } from 'react';

import { useTimelineStore } from '../../../../stores/timeline';
import { createMaskPathProperty } from "../../../../types/animationProperties";
import type { ClipMask } from "../../../../types/masks";
import { EMPTY_KEYFRAMES } from './maskTabTypes';
import { getMaskPathValue } from './maskPathMapping';
import { StopwatchIcon } from './StopwatchIcon';

interface MaskPathKeyframeToggleProps {
  clipId: string;
  mask: ClipMask;
}

export function MaskPathKeyframeToggle({ clipId, mask }: MaskPathKeyframeToggleProps) {
  const property = createMaskPathProperty(mask.id);
  const clipKeyframes = useTimelineStore(state => state.clipKeyframes.get(clipId) ?? EMPTY_KEYFRAMES);
  const recordingEnabled = useTimelineStore(state => state.keyframeRecordingEnabled.has(`${clipId}:${property}`));
  const hasPathKeyframes = clipKeyframes.some(keyframe => keyframe.property === property);
  const { addMaskPathKeyframe, toggleKeyframeRecording, disableMaskPathKeyframes } = useTimelineStore.getState();

  const addPathKeyframe = useCallback(() => {
    addMaskPathKeyframe(clipId, mask.id, getMaskPathValue(mask));
    if (!recordingEnabled && !hasPathKeyframes) {
      toggleKeyframeRecording(clipId, property);
    }
  }, [addMaskPathKeyframe, clipId, hasPathKeyframes, mask, property, recordingEnabled, toggleKeyframeRecording]);

  return (
    <button
      type="button"
      className={`keyframe-toggle ${recordingEnabled ? 'recording' : ''} ${hasPathKeyframes ? 'has-keyframes' : ''}`}
      title={recordingEnabled || hasPathKeyframes ? 'Add Mask Path keyframe (right-click to disable)' : 'Add Mask Path keyframe'}
      onClick={(event) => {
        event.stopPropagation();
        addPathKeyframe();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        disableMaskPathKeyframes(clipId, mask.id, getMaskPathValue(mask));
      }}
    >
      <StopwatchIcon />
    </button>
  );
}
