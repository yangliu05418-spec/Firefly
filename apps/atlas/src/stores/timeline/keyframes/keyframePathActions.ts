import type { TimelineEditOperationSource } from '../editOperations/types';
import type { KeyframeActions, SliceCreator } from '../types';
import { endBatch, startBatch } from '../../historyStore';
import { createMaskPathProperty, createTextBoundsPathProperty } from '../../../types';
import {
  applyTextBoundsPathValue,
  getTextBoundsPathValue,
} from '../../../services/textLayout';
import { normalizeEasingType } from '../../../utils/easing';
import {
  applyMaskPathValue,
  cloneMaskPathValue,
  createPathKeyframeTransactionId,
  getClipTextBounds,
  getMaskPathValue,
} from './pathKeyframeValues';
import { findClipById } from './keyframeClipLookup';

type PathKeyframeWriteOptions = {
  phase?: 'update' | 'commit';
  source?: TimelineEditOperationSource;
  historyLabel?: string;
};

type KeyframePathActions = Pick<
  KeyframeActions,
  | 'addMaskPathKeyframe'
  | 'recordMaskPathKeyframe'
  | 'disableMaskPathKeyframes'
  | 'addTextBoundsPathKeyframe'
  | 'recordTextBoundsPathKeyframe'
  | 'disableTextBoundsPathKeyframes'
>;

export const createKeyframePathActions: SliceCreator<KeyframePathActions> = (set, get) => ({
  addMaskPathKeyframe: (clipId, maskId, providedPathValue, time, easing = 'linear', options?: PathKeyframeWriteOptions) => {
    const { clips, playheadPosition } = get();
    const clip = findClipById(clips, clipId);
    const mask = clip?.masks?.find(candidate => candidate.id === maskId);
    if (!clip || !mask) return;

    const property = createMaskPathProperty(maskId);
    const normalizedEasing = normalizeEasingType(easing, 'linear');
    const clipLocalTime = time ?? (playheadPosition - clip.startTime);
    const clampedTime = Math.max(0, Math.min(clipLocalTime, clip.duration));
    const pathValue = providedPathValue ? cloneMaskPathValue(providedPathValue) : getMaskPathValue(mask);
    const phase = options?.phase ?? 'commit';
    const source = options?.source ?? 'ui';
    const transactionId = createPathKeyframeTransactionId('mask-path-keyframe', clipId, property);
    const operation = {
      type: 'keyframe-create' as const,
      clipId,
      property,
      time: clampedTime,
      value: { pathValue },
      easing: normalizedEasing,
    };

    if (phase === 'update') {
      get().applyTimelineEditOperation({
        id: `${transactionId}-update`,
        type: 'keyframe-transaction-update',
        phase: 'update',
        transactionId,
        historyBatchId: transactionId,
        source,
        clipId,
        property,
        keyframeIds: [],
        operations: [operation],
      }, {
        source,
        historyLabel: options?.historyLabel ?? 'Edit mask path keyframe',
        deferHistoryCommit: true,
      });
      return;
    }

    get().applyTimelineEditOperation({
      id: `${transactionId}-commit`,
      type: 'keyframe-transaction-commit',
      phase: 'commit',
      transactionId,
      historyBatchId: transactionId,
      source,
      clipId,
      property,
      keyframeIds: [],
      operations: [operation],
    }, {
      source,
      historyLabel: options?.historyLabel ?? 'Add mask path keyframe',
    });
  },

  recordMaskPathKeyframe: (clipId, maskId) => {
    const property = createMaskPathProperty(maskId);
    const { isRecording, hasKeyframes, addMaskPathKeyframe } = get();
    if (!isRecording(clipId, property) && !hasKeyframes(clipId, property)) return;
    addMaskPathKeyframe(clipId, maskId);
  },

  disableMaskPathKeyframes: (clipId, maskId, pathValue) => {
    const { clips, clipKeyframes, keyframeRecordingEnabled, invalidateCache } = get();
    const property = createMaskPathProperty(maskId);
    const existingKeyframes = clipKeyframes.get(clipId) || [];
    const removedKeyframes = existingKeyframes.filter(keyframe => keyframe.property === property);

    const newRecording = new Set(keyframeRecordingEnabled);
    newRecording.delete(`${clipId}:${property}`);

    startBatch('Disable mask path keyframes');
    try {
      if (pathValue) {
        set({
          clips: clips.map(clip => {
            if (clip.id !== clipId) return clip;
            return {
              ...clip,
              masks: (clip.masks || []).map(mask =>
                mask.id === maskId ? applyMaskPathValue(mask, pathValue) : mask
              ),
            };
          }),
        });
      }

      set({ keyframeRecordingEnabled: newRecording });

      if (removedKeyframes.length > 0) {
        const transactionId = createPathKeyframeTransactionId('disable-mask-path-keyframes', clipId, property);
        get().applyTimelineEditOperation({
          id: `${transactionId}-update`,
          type: 'keyframe-transaction-update',
          phase: 'update',
          transactionId,
          historyBatchId: transactionId,
          source: 'ui',
          clipId,
          property,
          keyframeIds: removedKeyframes.map(keyframe => keyframe.id),
          operations: removedKeyframes.map(keyframe => ({
            type: 'keyframe-remove' as const,
            keyframeId: keyframe.id,
            clipId,
            property,
          })),
        }, {
          source: 'ui',
          historyLabel: 'Disable mask path keyframes',
          deferHistoryCommit: true,
        });
      } else {
        invalidateCache();
      }
    } finally {
      endBatch();
    }
  },

  addTextBoundsPathKeyframe: (clipId, providedPathValue, time, easing = 'linear', options?: PathKeyframeWriteOptions) => {
    const { clips, playheadPosition } = get();
    const clip = findClipById(clips, clipId);
    const textBounds = clip ? getClipTextBounds(clip) : undefined;
    if (!clip || !textBounds) return;

    const property = createTextBoundsPathProperty();
    const normalizedEasing = normalizeEasingType(easing, 'linear');
    const clipLocalTime = time ?? (playheadPosition - clip.startTime);
    const clampedTime = Math.max(0, Math.min(clipLocalTime, clip.duration));
    const pathValue = providedPathValue ? cloneMaskPathValue(providedPathValue) : getTextBoundsPathValue(textBounds);
    const phase = options?.phase ?? 'commit';
    const source = options?.source ?? 'ui';
    const transactionId = createPathKeyframeTransactionId('text-bounds-path-keyframe', clipId, property);
    const operation = {
      type: 'keyframe-create' as const,
      clipId,
      property,
      time: clampedTime,
      value: { pathValue },
      easing: normalizedEasing,
    };

    if (phase === 'update') {
      get().applyTimelineEditOperation({
        id: `${transactionId}-update`,
        type: 'keyframe-transaction-update',
        phase: 'update',
        transactionId,
        historyBatchId: transactionId,
        source,
        clipId,
        property,
        keyframeIds: [],
        operations: [operation],
      }, {
        source,
        historyLabel: options?.historyLabel ?? 'Edit text bounds path keyframe',
        deferHistoryCommit: true,
      });
      return;
    }

    get().applyTimelineEditOperation({
      id: `${transactionId}-commit`,
      type: 'keyframe-transaction-commit',
      phase: 'commit',
      transactionId,
      historyBatchId: transactionId,
      source,
      clipId,
      property,
      keyframeIds: [],
      operations: [operation],
    }, {
      source,
      historyLabel: options?.historyLabel ?? 'Add text bounds path keyframe',
    });
  },

  recordTextBoundsPathKeyframe: (clipId) => {
    const property = createTextBoundsPathProperty();
    const { isRecording, hasKeyframes, addTextBoundsPathKeyframe } = get();
    if (!isRecording(clipId, property) && !hasKeyframes(clipId, property)) return;
    addTextBoundsPathKeyframe(clipId);
  },

  disableTextBoundsPathKeyframes: (clipId, pathValue) => {
    const { clips, clipKeyframes, keyframeRecordingEnabled, invalidateCache } = get();
    const property = createTextBoundsPathProperty();
    const existingKeyframes = clipKeyframes.get(clipId) || [];
    const removedKeyframes = existingKeyframes.filter(keyframe => keyframe.property === property);

    const newRecording = new Set(keyframeRecordingEnabled);
    newRecording.delete(`${clipId}:${property}`);

    startBatch('Disable text bounds path keyframes');
    try {
      if (pathValue) {
        set({
          clips: clips.map(clip => {
            if (clip.id !== clipId || !clip.textProperties) return clip;
            const textBounds = getClipTextBounds(clip);
            if (!textBounds) return clip;
            return {
              ...clip,
              textProperties: {
                ...clip.textProperties,
                boxEnabled: true,
                textBounds: applyTextBoundsPathValue(textBounds, pathValue),
              },
            };
          }),
        });
      }

      set({ keyframeRecordingEnabled: newRecording });

      if (removedKeyframes.length > 0) {
        const transactionId = createPathKeyframeTransactionId('disable-text-bounds-path-keyframes', clipId, property);
        get().applyTimelineEditOperation({
          id: `${transactionId}-update`,
          type: 'keyframe-transaction-update',
          phase: 'update',
          transactionId,
          historyBatchId: transactionId,
          source: 'ui',
          clipId,
          property,
          keyframeIds: removedKeyframes.map(keyframe => keyframe.id),
          operations: removedKeyframes.map(keyframe => ({
            type: 'keyframe-remove' as const,
            keyframeId: keyframe.id,
            clipId,
            property,
          })),
        }, {
          source: 'ui',
          historyLabel: 'Disable text bounds path keyframes',
          deferHistoryCommit: true,
        });
      } else {
        invalidateCache();
      }
    } finally {
      endBatch();
    }
  },
});
