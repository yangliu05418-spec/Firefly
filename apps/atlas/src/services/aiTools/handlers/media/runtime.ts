// Shared runtime helpers for media panel tool handlers

import { useMediaStore } from '../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../stores/timeline';

export type MediaStore = ReturnType<typeof useMediaStore.getState>;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForCompositionReady(compositionId: string, timeoutMs: number = 2500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const mediaState = useMediaStore.getState();
    const timelineState = useTimelineStore.getState();
    const composition = mediaState.compositions.find((comp) => comp.id === compositionId);

    const isActive = mediaState.activeCompositionId === compositionId;
    const expectedTracks = composition?.timelineData?.tracks ?? [];
    const timelineTracksMatch = expectedTracks.length === 0 || (
      timelineState.tracks.length === expectedTracks.length &&
      expectedTracks.every((track, index) => timelineState.tracks[index]?.id === track.id)
    );

    if (isActive && timelineTracksMatch) {
      return true;
    }

    await delay(25);
  }

  return false;
}
