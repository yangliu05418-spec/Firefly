import type { MediaFile } from '../../stores/mediaStore/types';
import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import type { CompositionTimelineData, TimelineClip } from '../../types/timeline';

type SerializedLayerClip = CompositionTimelineData['clips'][number];

export function createLayerTimelineClip(
  serializedClip: SerializedLayerClip,
  mediaFile: MediaFile | undefined
): TimelineClip {
  return {
    id: serializedClip.id,
    trackId: serializedClip.trackId,
    name: serializedClip.name,
    file: mediaFile?.file ?? new File([], serializedClip.name),
    startTime: serializedClip.startTime,
    duration: serializedClip.duration,
    inPoint: serializedClip.inPoint,
    outPoint: serializedClip.outPoint,
    source: null,
    transform: serializedClip.transform || { ...DEFAULT_TRANSFORM },
    effects: serializedClip.effects || [],
    mediaFileId: serializedClip.mediaFileId,
    reversed: serializedClip.reversed,
    isComposition: serializedClip.isComposition,
    compositionId: serializedClip.compositionId,
    masks: serializedClip.masks,
  };
}
