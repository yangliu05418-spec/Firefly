import type { TimelineClip } from '../../types';
import type { TimelineClipDragPreview } from './types';

export function applyClipDragPreview(
  clips: TimelineClip[],
  preview: TimelineClipDragPreview | null | undefined,
): TimelineClip[] {
  if (!preview) return clips;

  const patchEntries = Object.entries(preview.patches);
  if (patchEntries.length === 0) return clips;

  const patches = new Map(patchEntries);
  let changed = false;

  const patchedClips = clips.map((clip) => {
    const patch = patches.get(clip.id);
    if (!patch) return clip;

    const startTime = Number.isFinite(patch.startTime)
      ? Math.max(0, patch.startTime)
      : clip.startTime;
    const trackId = patch.trackId ?? clip.trackId;

    if (startTime === clip.startTime && trackId === clip.trackId) {
      return clip;
    }

    changed = true;
    return {
      ...clip,
      startTime,
      trackId,
    };
  });

  return changed ? patchedClips : clips;
}
