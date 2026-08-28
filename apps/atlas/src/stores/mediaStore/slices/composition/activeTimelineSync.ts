import type { Composition } from '../../types';
import type { SerializableClip, TimelineClip } from '../../../../types/timeline';
import { compositionRenderer } from '../../../../services/compositionRenderer';
import { useTimelineStore } from '../../../timeline';
import {
  syncNestedCompReferenceClip,
  syncTimelineDataNestedCompReferences,
} from './timelineDataPlanner';

export type NestedCompReferenceClip =
  Pick<SerializableClip, 'isComposition' | 'compositionId' | 'inPoint' | 'outPoint' | 'duration'> &
  Partial<Pick<SerializableClip, 'sourceType' | 'naturalDuration' | 'waveform'>> &
  Partial<Pick<TimelineClip, 'source'>>;

export function syncInactiveCompositionNestedReferences(
  composition: Composition,
  activeCompositionId: string | null,
  changedCompositionId: string,
  previousDuration: number,
  nextDuration: number,
): Composition {
  if (composition.id === activeCompositionId) {
    return composition;
  }

  return {
    ...composition,
    timelineData: syncTimelineDataNestedCompReferences(
      composition.timelineData,
      changedCompositionId,
      previousDuration,
      nextDuration,
    ),
  };
}

export function syncActiveTimelineNestedCompReferences(
  activeCompositionId: string | null,
  compositionId: string,
  previousDuration: number,
  nextDuration: number,
): void {
  if (!activeCompositionId || activeCompositionId === compositionId) {
    return;
  }

  const timelineStore = useTimelineStore.getState();
  const audioClipIds: string[] = [];
  let changed = false;

  const updatedClips = timelineStore.clips.map((clip) => {
    const updatedClip = syncNestedCompReferenceClip(
      clip,
      compositionId,
      previousDuration,
      nextDuration,
    );
    if (updatedClip !== clip) {
      changed = true;
      if (updatedClip.source?.type === 'audio') {
        audioClipIds.push(updatedClip.id);
      }
    }
    return updatedClip;
  });

  if (!changed) {
    return;
  }

  useTimelineStore.setState({ clips: updatedClips });

  const refreshedTimelineStore = useTimelineStore.getState();
  refreshedTimelineStore.updateDuration();
  refreshedTimelineStore.invalidateCache();
  void refreshedTimelineStore.refreshCompClipNestedData(compositionId);

  for (const clipId of audioClipIds) {
    void refreshedTimelineStore.generateWaveformForClip(clipId);
  }
}

export function invalidateCompositionDurationDependents(compositionId: string): void {
  compositionRenderer.invalidateCompositionAndParents(compositionId);
}
