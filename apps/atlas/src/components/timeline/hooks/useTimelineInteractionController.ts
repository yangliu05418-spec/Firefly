import { useTimelineAIMarkerFeedback } from './useTimelineAIMarkerFeedback';
import { useTimelineClipInteractionController } from './useTimelineClipInteractionController';
import { useTimelineExternalDropController } from './useTimelineExternalDropController';
import { useTimelineInputController } from './useTimelineInputController';

type ClipInteractionParams = Parameters<typeof useTimelineClipInteractionController>[0];
type ExternalDropParams = Parameters<typeof useTimelineExternalDropController>[0];
type InputParams = Parameters<typeof useTimelineInputController>[0];

type UseTimelineInteractionControllerParams =
  ClipInteractionParams &
  ExternalDropParams &
  Omit<InputParams, 'clipDrag' | 'clipTrim'>;

export function useTimelineInteractionController(params: UseTimelineInteractionControllerParams) {
  const clipInteraction = useTimelineClipInteractionController(params);
  const externalDrop = useTimelineExternalDropController(params);
  const aiAnimatedMarkers = useTimelineAIMarkerFeedback();
  const input = useTimelineInputController({
    ...params,
    clipDrag: clipInteraction.clipDrag,
    clipTrim: clipInteraction.clipTrim,
  });

  return {
    ...clipInteraction,
    ...externalDrop,
    ...input,
    aiAnimatedMarkers,
  };
}
