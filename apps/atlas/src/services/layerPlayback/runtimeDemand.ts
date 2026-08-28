import type { TimelineClip } from '../../types/timeline';
import type { RuntimeProviderDemand } from '../../timeline/resources/TimelineVisualResourceDemand';

export function getRuntimeSrcKind(url: string): 'blob-url' | 'remote-url' | 'media-source' | 'unknown' {
  if (!url) return 'unknown';
  if (url.startsWith('blob:')) return 'blob-url';
  if (url.startsWith('http')) return 'remote-url';
  if (url.startsWith('mediastream:')) return 'media-source';
  return 'unknown';
}

export function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

export function createBackgroundImageDemand(
  layerIndex: number,
  clip: TimelineClip,
  ownerId: string,
  url: string
): RuntimeProviderDemand {
  const resourceId = `timeline-runtime:background:${ownerId}:image-canvas:image`;
  return {
    id: resourceId,
    facetId: `${resourceId}:facet`,
    resourceKind: 'image-canvas',
    policyId: 'background',
    leasePolicy: 'lease-visible',
    owner: removeUndefinedValues({
      ownerId,
      ownerType: 'clip' as const,
      clipId: clip.id,
      trackId: clip.trackId,
      mediaFileId: clip.mediaFileId,
    }),
    source: removeUndefinedValues({
      sourceId: clip.mediaFileId,
      mediaFileId: clip.mediaFileId,
      clipId: clip.id,
      trackId: clip.trackId,
      previewPath: url,
    }),
    dimensions: {
      durationSeconds: clip.duration,
    },
    priority: 'background',
    tags: ['background', 'image', `layer-${layerIndex}`],
  };
}
