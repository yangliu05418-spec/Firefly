import type { TimelineClip, VideoBakeRegion } from '../../../types';
import { useTimelineRamPreviewFeatureGate } from './useTimelineRamPreviewFeatureGate';
import { useTimelineStableActionBindings } from './useTimelineStableActionBindings';

export type TimelineActionBindings = ReturnType<typeof useTimelineStableActionBindings>;

interface UseTimelineActionControllerParams {
  clips: readonly TimelineClip[];
  isRamPreviewing: boolean;
  ramPreviewEnabled: boolean;
  ramPreviewProgress: number | null;
  ramPreviewRange: { start: number; end: number } | null;
  videoBakeRegions: readonly VideoBakeRegion[];
}

export function useTimelineActionController({
  clips,
  isRamPreviewing,
  ramPreviewEnabled,
  ramPreviewProgress,
  ramPreviewRange,
  videoBakeRegions,
}: UseTimelineActionControllerParams) {
  const actions = useTimelineStableActionBindings();
  const ramPreviewGate = useTimelineRamPreviewFeatureGate({
    clips,
    videoBakeRegions,
    ramPreviewEnabled,
    ramPreviewProgress,
    ramPreviewRange,
    isRamPreviewing,
    toggleRamPreviewEnabled: actions.toggleRamPreviewEnabled,
    cancelRamPreview: actions.cancelRamPreview,
    clearRamPreview: actions.clearRamPreview,
  });

  return {
    actions,
    ...ramPreviewGate,
  };
}
