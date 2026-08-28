import { useTimelineBodySurfaceController } from './useTimelineBodySurfaceController';
import { useTimelineTrackSectionSurfaceController } from './useTimelineTrackSectionSurfaceController';

type TrackSectionSurfaceParams = Parameters<typeof useTimelineTrackSectionSurfaceController>[0];
type BodySurfaceParams = Parameters<typeof useTimelineBodySurfaceController>[0];

type UseTimelineSurfaceControllerParams =
  TrackSectionSurfaceParams &
  Omit<BodySurfaceParams, 'renderAudioSection' | 'renderVideoSection'>;

export function useTimelineSurfaceController(
  params: UseTimelineSurfaceControllerParams,
): ReturnType<typeof useTimelineBodySurfaceController> {
  const { renderAudioSection, renderVideoSection } = useTimelineTrackSectionSurfaceController(params);

  return useTimelineBodySurfaceController({
    ...params,
    renderAudioSection,
    renderVideoSection,
  });
}
