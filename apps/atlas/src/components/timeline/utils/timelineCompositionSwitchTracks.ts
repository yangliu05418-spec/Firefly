import type { TimelineTrack } from '../../../types';

export function buildCompositionSwitchTracks(
  currentTracks: TimelineTrack[],
  targetTracks: TimelineTrack[] | null
): TimelineTrack[] {
  if (!targetTracks || targetTracks.length === 0) return currentTracks;

  const currentById = new Map(currentTracks.map((track) => [track.id, track]));
  const currentByType: Record<TimelineTrack['type'], TimelineTrack[]> = {
    video: currentTracks.filter((track) => track.type === 'video'),
    audio: currentTracks.filter((track) => track.type === 'audio'),
    midi: currentTracks.filter((track) => track.type === 'midi'),
  };
  const usedCurrentIds = new Set<string>();
  const typeCursor: Record<TimelineTrack['type'], number> = { video: 0, audio: 0, midi: 0 };

  const mappedTargetTracks = targetTracks.map((targetTrack) => {
    const sameIdTrack = currentById.get(targetTrack.id);
    let matchedCurrent = sameIdTrack && !usedCurrentIds.has(sameIdTrack.id)
      ? sameIdTrack
      : undefined;

    if (!matchedCurrent) {
      const tracksOfType = currentByType[targetTrack.type];
      while (typeCursor[targetTrack.type] < tracksOfType.length) {
        const candidate = tracksOfType[typeCursor[targetTrack.type]];
        typeCursor[targetTrack.type] += 1;
        if (!usedCurrentIds.has(candidate.id)) {
          matchedCurrent = candidate;
          break;
        }
      }
    }

    if (!matchedCurrent) return { ...targetTrack };

    usedCurrentIds.add(matchedCurrent.id);
    return {
      ...targetTrack,
      id: matchedCurrent.id,
    };
  });

  const departingTracks = currentTracks
    .filter((track) => !usedCurrentIds.has(track.id))
    .map((track) => ({
      ...track,
      name: '',
      height: 0,
      muted: false,
      visible: false,
      solo: false,
    }));

  return [...mappedTargetTracks, ...departingTracks];
}
