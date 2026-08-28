import type { TimelineClip, SerializableClip } from '../../types/timeline';
import type { MediaFile } from '../../stores/mediaStore/types';
import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';

export function buildSlotDeckClip(
  serializedClip: SerializableClip,
  mediaFile: MediaFile | undefined
): TimelineClip {
  return {
    id: serializedClip.id,
    trackId: serializedClip.trackId,
    name: serializedClip.name,
    file: (mediaFile?.file ?? null) as never,
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
