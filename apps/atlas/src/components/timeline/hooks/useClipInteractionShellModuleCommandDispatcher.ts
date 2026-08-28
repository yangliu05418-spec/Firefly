import { useCallback } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { Logger } from '../../../services/logger';
import {
  AUDIO_REGION_TIMELINE_EPSILON,
  resolveAudioRegionTimelineRangeForClip,
} from '../utils/audioRegionDisplay';
import type {
  ClipInteractionShellCommandContext,
  ClipInteractionShellModuleCommand,
  ClipInteractionShellModuleSlot,
} from '../interactionShell';

const log = Logger.create('ClipInteractionShellModuleCommandDispatcher');

export function useClipInteractionShellModuleCommandDispatcher() {
  return useCallback((
    slot: ClipInteractionShellModuleSlot,
    command: ClipInteractionShellModuleCommand,
    context: ClipInteractionShellCommandContext,
  ) => {
    const timelineState = useTimelineStore.getState();
    if (slot === 'audio-region') {
      const resolveActiveSelection = () => {
        const commandSelection = (
          (command.type === 'audio-region:split-selection' || command.type === 'audio-region:cut-selection') &&
          command.selection?.clipId === context.clip.id
        )
          ? command.selection
          : null;
        return commandSelection ??
          (timelineState.audioRegionSelection?.clipId === context.clip.id
            ? timelineState.audioRegionSelection
            : context.activeModules.audioRegion?.selection ?? null);
      };
      const resolveCurrentClip = () => (
        timelineState.clips.find((candidate) => candidate.id === context.clip.id) ?? context.clip
      );
      const splitAudioRegion = () => {
        const activeSelection = resolveActiveSelection();
        const currentClip = resolveCurrentClip();
        if (!activeSelection) {
          log.warn('Cannot split audio region without an active selection', { clipId: context.clip.id });
          return;
        }

        const range = resolveAudioRegionTimelineRangeForClip(currentClip, activeSelection);
        if (!range) {
          log.warn('Cannot split audio region outside clip bounds', {
            clipId: context.clip.id,
            selection: activeSelection,
          });
          return;
        }

        const clipStart = currentClip.startTime;
        const clipEnd = currentClip.startTime + Math.max(AUDIO_REGION_TIMELINE_EPSILON, currentClip.duration);
        const splitTimes = [range.start, range.end].filter((time) =>
          time > clipStart + AUDIO_REGION_TIMELINE_EPSILON &&
          time < clipEnd - AUDIO_REGION_TIMELINE_EPSILON
        );
        const result = splitTimes.length > 0
          ? timelineState.applyTimelineEditOperation({
            id: `split-audio-region:${context.clip.id}:${range.start}:${range.end}`,
            type: 'split-at-times',
            clipId: currentClip.id,
            times: splitTimes,
            includeLinked: false,
          }, {
            source: 'context-menu',
            historyLabel: 'Split audio region',
          })
          : { success: true };

        if (result.success) {
          const latestState = useTimelineStore.getState();
          const middleClip = latestState.clips.find((candidate) =>
            candidate.trackId === currentClip.trackId &&
            Math.abs(candidate.startTime - range.start) <= AUDIO_REGION_TIMELINE_EPSILON &&
            Math.abs(candidate.duration - range.duration) <= AUDIO_REGION_TIMELINE_EPSILON
          );
          if (middleClip) {
            latestState.selectClip(middleClip.id);
          }
          latestState.clearAudioRegionSelection();
          return;
        }

        log.warn('Split audio region operation failed', { clipId: currentClip.id, range, result });
        useTimelineStore.getState().clearAudioRegionSelection();
      };
      const cutAudioRegion = () => {
        const activeSelection = resolveActiveSelection();
        const currentClip = resolveCurrentClip();
        if (!activeSelection) {
          log.warn('Cannot cut audio region without an active selection', { clipId: context.clip.id });
          return;
        }

        const range = resolveAudioRegionTimelineRangeForClip(currentClip, activeSelection);
        if (!range) {
          log.warn('Cannot cut audio region outside clip bounds', {
            clipId: context.clip.id,
            selection: activeSelection,
          });
          return;
        }

        if (timelineState.audioRegionSelection?.clipId !== currentClip.id) {
          timelineState.setAudioRegionSelection(activeSelection);
        }
        timelineState.copySelectedAudioRegion();
        const result = timelineState.applyTimelineEditOperation({
          id: `cut-audio-region:${context.clip.id}:${range.start}:${range.end}`,
          type: 'lift-range',
          range: {
            startTime: range.start,
            endTime: range.end,
            trackIds: [currentClip.trackId],
          },
          includeLinked: false,
        }, {
          source: 'context-menu',
          historyLabel: 'Cut audio region',
        });
        if (result.success) {
          timelineState.clearAudioRegionSelection();
          return;
        }

        log.warn('Cut audio region operation failed', { clipId: currentClip.id, range, result });
      };

      if (command.type === 'audio-region:set-selection') {
        timelineState.setAudioRegionSelection(command.selection);
        return;
      }
      if (command.type === 'audio-region:clear-selection') {
        timelineState.clearAudioRegionSelection();
        return;
      }
      if (command.type === 'audio-region:commit-operation-range') {
        if (command.operationIds.length > 0) {
          timelineState.setClipAudioEditOperationRange(context.clip.id, [...command.operationIds], command.selection, {
            captureHistory: true,
            historyLabel: command.historyLabel,
          });
        }
        return;
      }
      if (command.type === 'audio-region:set-gain-preview') {
        timelineState.setAudioRegionGainPreview(command.preview);
        return;
      }
      if (command.type === 'audio-region:clear-gain-preview') {
        if (timelineState.audioRegionGainPreview?.clipId === context.clip.id) {
          timelineState.clearAudioRegionGainPreview();
        }
        return;
      }
      if (command.type === 'audio-region:set-gain-edit') {
        timelineState.setAudioRegionGainEdit(command.options);
        return;
      }
      if (command.type === 'audio-region:apply-edit') {
        timelineState.applyAudioRegionEdit(command.editType, command.options);
        return;
      }
      if (command.type === 'audio-region:copy-selection') {
        timelineState.copySelectedAudioRegion();
        return;
      }
      if (command.type === 'audio-region:paste-selection') {
        timelineState.pasteAudioRegionToSelection();
        return;
      }
      if (command.type === 'audio-region:split-selection') {
        splitAudioRegion();
        return;
      }
      if (command.type === 'audio-region:cut-selection') {
        cutAudioRegion();
        return;
      }
      if (command.type === 'audio-region:toggle-operation') {
        timelineState.setClipAudioEditOperationEnabled(context.clip.id, command.operationId, command.disabled);
        return;
      }
      if (command.type === 'audio-region:remove-operation') {
        timelineState.removeClipAudioEditOperation(context.clip.id, command.operationId);
        return;
      }
      if (command.type === 'audio-region:clear-stack') {
        timelineState.clearClipAudioEditStack(context.clip.id);
        return;
      }
      if (command.type === 'audio-region:bake-stack') {
        return timelineState.bakeClipAudioEditStack(context.clip.id).then(() => undefined);
      }
      if (command.type === 'audio-region:unbake-stack') {
        timelineState.unbakeClipAudioEditStack(context.clip.id);
      }
      return;
    }
    if (slot === 'spectral-region') {
      if (command.type === 'spectral-region:set-selection') {
        timelineState.setAudioSpectralRegionSelection(command.selection);
        return;
      }
      if (command.type === 'spectral-region:clear-selection') {
        timelineState.clearAudioSpectralRegionSelection();
        return;
      }
      if (command.type === 'spectral-region:apply-edit') {
        timelineState.applySpectralRegionEdit(command.editType);
        return;
      }
      if (command.type === 'spectral-region:add-image-layer') {
        timelineState.addClipSpectralImageLayer(context.clip.id, command.layer);
      }
      return;
    }
    if (slot === 'stem') {
      if (command.type === 'stem:prewarm-source-media-files') {
        timelineState.prewarmStemSourceMediaFiles([...command.mediaFileIds]);
        return;
      }
      if (command.type === 'stem:set-clip-source') {
        timelineState.setClipSourceToStem(context.clip.id, command.stemMediaFileId);
      }
      return;
    }
    if (slot !== 'video-bake') return;
    if (command.type === 'video-bake:bake-region') {
      void timelineState.bakeClipVideoBakeRegion(context.clip.id, command.regionId);
      return;
    }
    if (command.type === 'video-bake:unbake-region') {
      timelineState.unbakeClipVideoBakeRegion(context.clip.id, command.regionId);
      return;
    }
    if (command.type === 'video-bake:remove-region') {
      timelineState.removeClipVideoBakeRegion(context.clip.id, command.regionId);
    }
  }, []);
}
