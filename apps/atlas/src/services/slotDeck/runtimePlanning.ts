import type { TimelineClip } from '../../types/timeline';
import type { RuntimeProviderDemand } from '../../timeline/resources/TimelineVisualResourceDemand';
import type { SlotDeckEntry } from './types';

export function getRuntimeSrcKind(url: string): 'blob-url' | 'remote-url' | 'media-source' | 'unknown' {
  if (!url) return 'unknown';
  if (url.startsWith('blob:')) return 'blob-url';
  if (url.startsWith('http')) return 'remote-url';
  if (url.startsWith('mediastream:')) return 'media-source';
  return 'unknown';
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

export function createSlotDeckImageDemand(
  entry: SlotDeckEntry,
  clip: TimelineClip,
  ownerId: string,
  url: string
): RuntimeProviderDemand {
  const resourceId = `timeline-runtime:slot-deck:${ownerId}:image-canvas:image`;
  return {
    id: resourceId,
    facetId: `${resourceId}:facet`,
    resourceKind: 'image-canvas',
    policyId: 'slot-deck',
    leasePolicy: 'lease-visible',
    owner: removeUndefinedValues({
      ownerId,
      ownerType: 'slot' as const,
      clipId: clip.id,
      trackId: clip.trackId,
      compositionId: entry.compositionId,
      mediaFileId: clip.mediaFileId,
    }),
    source: removeUndefinedValues({
      sourceId: clip.mediaFileId,
      mediaFileId: clip.mediaFileId,
      clipId: clip.id,
      trackId: clip.trackId,
      compositionId: entry.compositionId,
      previewPath: url,
    }),
    dimensions: {
      durationSeconds: clip.duration,
    },
    priority: 'background',
    tags: ['slot-deck', 'image'],
  };
}
