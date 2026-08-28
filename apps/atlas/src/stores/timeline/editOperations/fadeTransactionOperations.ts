import { endBatch, startBatch } from '../../historyStore';
import type { TimelineEditOperationApplyContext } from './editOperationContext';
import { isClipTrackLocked, resultFromWarnings } from './editOperationResults';
import { applyFadeCancel, applyFadeKeyframePlan } from './fadeKeyframePlan';
import type { FadeTransactionOperation } from './transactionTypes';
import type { TimelineEditOperation, TimelineEditResult } from './types';

export function isFadeTransactionOperation(operation: TimelineEditOperation): operation is FadeTransactionOperation {
  return (
    operation.type === 'fade-transaction-begin' ||
    operation.type === 'fade-transaction-update' ||
    operation.type === 'fade-transaction-commit' ||
    operation.type === 'fade-transaction-cancel'
  );
}

export function applyFadeTransactionOperation(
  operation: FadeTransactionOperation,
  context: TimelineEditOperationApplyContext,
): TimelineEditResult {
  const { get, options, set } = context;
  const operationId = operation.id;
  const clip = get().clips.find(candidate => candidate.id === operation.clipId);
  if (!clip) {
    return resultFromWarnings(operationId, [{
      code: 'clip-not-found',
      message: `Fade transaction clip not found: ${operation.clipId}`,
      clipId: operation.clipId,
    }]);
  }
  if (isClipTrackLocked(get().clips, get().tracks, operation.clipId)) {
    return resultFromWarnings(operationId, [{
      code: 'track-locked',
      message: `Fade transaction clip is on a locked track: ${operation.clipId}`,
      clipId: operation.clipId,
      trackId: clip.trackId,
    }]);
  }

  if (operation.type === 'fade-transaction-begin') {
    return {
      success: true,
      operationId,
      changedClipIds: [],
      warnings: [],
    };
  }

  const appliedFade = operation.type === 'fade-transaction-cancel'
    ? applyFadeCancel(operation.clipId, operation.discardKeyframeIds, get().clipKeyframes)
    : applyFadeKeyframePlan(
        operation.id,
        clip,
        operation.keyframePlan,
        operation.type === 'fade-transaction-update'
          ? operation.resolvedFadeDuration
          : operation.finalFadeDuration,
        get().clipKeyframes,
      );

  if (!appliedFade.changed && operation.type !== 'fade-transaction-commit') {
    return resultFromWarnings(operationId, [{
      code: 'no-op',
      message: 'No fade keyframes changed.',
      clipId: operation.clipId,
    }]);
  }

  const removedKeyframeIds = new Set(appliedFade.removedKeyframeIds);
  const selectedKeyframeIds = new Set(
    [...get().selectedKeyframeIds].filter(keyframeId => !removedKeyframeIds.has(keyframeId)),
  );

  const applyFadeState = () => {
    if (!appliedFade.changed) return;
    set({
      clipKeyframes: appliedFade.clipKeyframes,
      selectedKeyframeIds,
    });
    get().invalidateCache();
  };

  if (operation.type === 'fade-transaction-update') {
    startBatch(options.historyLabel ?? 'Edit clip fade');
    try {
      applyFadeState();
    } finally {
      if (!options.deferHistoryCommit) endBatch();
    }
  } else if (operation.type === 'fade-transaction-commit') {
    startBatch(options.historyLabel ?? 'Edit clip fade');
    try {
      applyFadeState();
    } finally {
      endBatch();
    }
  } else {
    try {
      applyFadeState();
    } finally {
      endBatch();
    }
  }

  return {
    success: true,
    operationId,
    changedClipIds: appliedFade.changed ? [operation.clipId] : [],
    warnings: [],
  };
}
