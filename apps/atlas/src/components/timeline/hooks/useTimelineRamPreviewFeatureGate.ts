import { useEffect, useMemo } from 'react';

import type { TimelineClip, VideoBakeRegion } from '../../../types';
import { RAM_PREVIEW_FEATURE_ENABLED } from '../utils/timelineHostConstants';

interface UseTimelineRamPreviewFeatureGateProps {
  clips: readonly TimelineClip[];
  videoBakeRegions: readonly VideoBakeRegion[];
  ramPreviewEnabled: boolean;
  ramPreviewProgress: number | null;
  ramPreviewRange: { start: number; end: number } | null;
  isRamPreviewing: boolean;
  toggleRamPreviewEnabled: () => void;
  cancelRamPreview: () => void;
  clearRamPreview: () => void;
}

interface UseTimelineRamPreviewFeatureGateReturn {
  effectiveRamPreviewEnabled: boolean;
  effectiveRamPreviewProgress: number | null;
  effectiveRamPreviewRange: { start: number; end: number } | null;
  effectiveIsRamPreviewing: boolean;
}

export function useTimelineRamPreviewFeatureGate({
  clips,
  videoBakeRegions,
  ramPreviewEnabled,
  ramPreviewProgress,
  ramPreviewRange,
  isRamPreviewing,
  toggleRamPreviewEnabled,
  cancelRamPreview,
  clearRamPreview,
}: UseTimelineRamPreviewFeatureGateProps): UseTimelineRamPreviewFeatureGateReturn {
  const hasActiveVideoBakeCache = useMemo(() => {
    const isActiveBakeRegion = (region: VideoBakeRegion) =>
      region.status === 'baking' || region.status === 'baked';

    return videoBakeRegions.some(isActiveBakeRegion) ||
      clips.some(clip => clip.videoState?.bakeRegions?.some(isActiveBakeRegion));
  }, [clips, videoBakeRegions]);

  useEffect(() => {
    if (RAM_PREVIEW_FEATURE_ENABLED) return;
    if (hasActiveVideoBakeCache) return;

    if (isRamPreviewing) {
      cancelRamPreview();
    }
    if (ramPreviewEnabled) {
      toggleRamPreviewEnabled();
      return;
    }
    if (ramPreviewRange || ramPreviewProgress !== null) {
      clearRamPreview();
    }
  }, [
    ramPreviewEnabled,
    ramPreviewProgress,
    ramPreviewRange,
    isRamPreviewing,
    hasActiveVideoBakeCache,
    toggleRamPreviewEnabled,
    cancelRamPreview,
    clearRamPreview,
  ]);

  return {
    effectiveRamPreviewEnabled: RAM_PREVIEW_FEATURE_ENABLED && ramPreviewEnabled,
    effectiveRamPreviewProgress: RAM_PREVIEW_FEATURE_ENABLED ? ramPreviewProgress : null,
    effectiveRamPreviewRange: RAM_PREVIEW_FEATURE_ENABLED ? ramPreviewRange : null,
    effectiveIsRamPreviewing: RAM_PREVIEW_FEATURE_ENABLED && isRamPreviewing,
  };
}
