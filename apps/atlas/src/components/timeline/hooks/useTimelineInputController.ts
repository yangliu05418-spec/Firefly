import { useCallback, type MouseEvent } from 'react';

import { useMarqueeSelection } from './useMarqueeSelection';
import { useMidiClipDraw } from './useMidiClipDraw';
import { useTimelinePlayheadMarkerController } from './useTimelinePlayheadMarkerController';

type PlayheadMarkerParams = Parameters<typeof useTimelinePlayheadMarkerController>[0];
type MarqueeParams = Parameters<typeof useMarqueeSelection>[0];
type MidiDrawParams = Parameters<typeof useMidiClipDraw>[0];

type UseTimelineInputControllerParams =
  PlayheadMarkerParams &
  Omit<MarqueeParams, 'markerDrag'> &
  MidiDrawParams;

interface UseTimelineInputControllerReturn extends ReturnType<typeof useTimelinePlayheadMarkerController> {
  handleSectionTracksMouseDown: (event: MouseEvent) => void;
  marquee: ReturnType<typeof useMarqueeSelection>['marquee'];
  midiDrawGhost: ReturnType<typeof useMidiClipDraw>['midiDrawGhost'];
}

export function useTimelineInputController(
  params: UseTimelineInputControllerParams,
): UseTimelineInputControllerReturn {
  const markerController = useTimelinePlayheadMarkerController(params);

  const { marquee, handleMarqueeMouseDown } = useMarqueeSelection({
    ...params,
    markerDrag: markerController.markerDrag,
  });

  const { midiDrawGhost, handleMidiDrawMouseDown } = useMidiClipDraw(params);

  const handleSectionTracksMouseDown = useCallback(
    (event: MouseEvent) => {
      handleMidiDrawMouseDown(event);
      if (event.defaultPrevented) return;
      handleMarqueeMouseDown(event);
    },
    [handleMarqueeMouseDown, handleMidiDrawMouseDown],
  );

  return {
    ...markerController,
    handleSectionTracksMouseDown,
    marquee,
    midiDrawGhost,
  };
}
