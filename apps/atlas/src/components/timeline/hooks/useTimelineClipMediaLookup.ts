import { useCallback } from 'react';

import type { MediaFile } from '../../../stores/mediaStore';
import type { TimelineClip } from '../../../types';

export function useTimelineClipMediaLookup(
  mediaFiles: readonly MediaFile[],
): (clip: TimelineClip) => MediaFile | undefined {
  return useCallback(
    (clip: TimelineClip) => mediaFiles.find(
      (file) =>
        file.id === clip.mediaFileId ||
        file.name === clip.name ||
        file.name === clip.name.replace(' (Audio)', '')
    ),
    [mediaFiles],
  );
}
