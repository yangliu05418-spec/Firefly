import type { Composition, MediaFile } from '../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../stores/timeline';

export type FixtureTimelineClip = ReturnType<typeof useTimelineStore.getState>['clips'][number];

export async function addMediaSegment(params: {
  media: MediaFile;
  trackId: string;
  startTime: number;
  inPoint: number;
  outPoint: number;
  name: string;
}): Promise<FixtureTimelineClip> {
  const { media, trackId, startTime, inPoint, outPoint, name } = params;
  const file = media.file;
  if (!file) {
    throw new Error(`Media file is not loaded: ${media.name}`);
  }

  const timelineStore = useTimelineStore.getState();
  const beforeIds = new Set(timelineStore.clips.map((clip) => clip.id));
  const duration = Math.max(0.05, outPoint - inPoint);
  await timelineStore.addClip(trackId, file, startTime, duration, media.id);

  const createdClips = useTimelineStore.getState().clips.filter((clip) => !beforeIds.has(clip.id));
  const trimmedClipIds = new Set<string>();
  for (const clip of createdClips) {
    if (trimmedClipIds.has(clip.id)) continue;
    const trimResult = useTimelineStore.getState().applyTimelineEditOperation({
      id: `stressTest-segment-trim:${clip.id}:${inPoint}:${outPoint}`,
      type: 'trim-clip',
      clipId: clip.id,
      inPoint,
      outPoint,
      includeLinked: true,
    }, {
      source: 'ai-tool',
      historyLabel: 'Stress test fixture: trim media segment',
    });
    if (!trimResult.success) {
      throw new Error(trimResult.warnings.map((warning) => warning.message).join(' ') || `Failed to trim fixture segment for ${media.name}`);
    }
    trimmedClipIds.add(clip.id);
    if (clip.linkedClipId) trimmedClipIds.add(clip.linkedClipId);
  }

  const visualClip = useTimelineStore.getState().clips.find((clip) =>
    !beforeIds.has(clip.id) &&
    clip.trackId === trackId &&
    clip.source?.type !== 'audio'
  );
  if (!visualClip) {
    throw new Error(`Failed to add fixture segment for ${media.name}`);
  }

  useTimelineStore.getState().updateClip(visualClip.id, { name });
  const refreshedClip = useTimelineStore.getState().clips.find((clip) => clip.id === visualClip.id);
  if (!refreshedClip) {
    throw new Error(`Fixture segment disappeared after creation: ${visualClip.id}`);
  }
  return refreshedClip;
}

export async function addCompositionSegment(params: {
  composition: Composition;
  trackId: string;
  startTime: number;
  name: string;
}): Promise<FixtureTimelineClip> {
  const { composition, trackId, startTime, name } = params;
  const timelineStore = useTimelineStore.getState();
  const beforeIds = new Set(timelineStore.clips.map((clip) => clip.id));
  await timelineStore.addCompClip(trackId, composition, startTime);
  const createdClip = useTimelineStore.getState().clips.find((clip) =>
    !beforeIds.has(clip.id) &&
    clip.trackId === trackId &&
    clip.isComposition === true
  );
  if (!createdClip) {
    throw new Error(`Failed to add nested composition clip for ${composition.name}`);
  }
  useTimelineStore.getState().updateClip(createdClip.id, { name });
  const refreshedClip = useTimelineStore.getState().clips.find((clip) => clip.id === createdClip.id);
  if (!refreshedClip) {
    throw new Error(`Nested composition clip disappeared after creation: ${createdClip.id}`);
  }
  return refreshedClip;
}
