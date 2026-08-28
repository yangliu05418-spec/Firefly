import type {
  RuntimeProviderDemand,
  TimelineRuntimeResourceKind,
} from '../../timeline';
import type { RenderResourceDescriptor } from './runtimeCoordinatorTypes';
import { createRenderResourceDescriptorFromDemand } from './runtimeProviderDemandBridge';
import { timelineRuntimeCoordinator } from './timelineRuntimeCoordinator';

export interface CompositionRenderSourceResource {
  compositionId: string;
  clipId: string;
  type: string;
  videoElement?: HTMLVideoElement;
  imageElement?: HTMLImageElement;
  textCanvas?: HTMLCanvasElement;
  naturalDuration?: number;
  runtimeSourceId?: string;
  runtimeSessionKey?: string;
  mediaFileId?: string;
}

function getCompositionSourceOwnerId(compositionId: string, clipId: string): string {
  return `composition:${compositionId}:clip:${clipId}`;
}

function getResourceId(
  entry: Pick<CompositionRenderSourceResource, 'compositionId' | 'clipId'>,
  suffix: string
): string {
  return `composition-render:${entry.compositionId}:${entry.clipId}:${suffix}`;
}

function getMediaStatus(element: HTMLMediaElement): 'ok' | 'warning' | 'unknown' {
  if (element.error) return 'warning';
  return element.readyState >= HTMLMediaElement.HAVE_METADATA ? 'ok' : 'unknown';
}

function getSrcKind(
  src: string | undefined
): 'blob-url' | 'remote-url' | 'project-path' | 'unknown' {
  if (!src) return 'unknown';
  if (src.startsWith('blob:')) return 'blob-url';
  if (src.startsWith('http')) return 'remote-url';
  return 'project-path';
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function createCompositionRenderDemand(
  entry: CompositionRenderSourceResource,
  resourceKind: TimelineRuntimeResourceKind,
  resourceId: string
): RuntimeProviderDemand {
  const ownerId = getCompositionSourceOwnerId(entry.compositionId, entry.clipId);
  const demand: RuntimeProviderDemand = {
    id: resourceId,
    facetId: `${resourceId}:facet`,
    resourceKind,
    policyId: 'composition-render' as const,
    leasePolicy: 'background-cache',
    owner: removeUndefinedValues({
      ownerId,
      ownerType: 'composition' as const,
      clipId: entry.clipId,
      compositionId: entry.compositionId,
      mediaFileId: entry.mediaFileId,
    }),
    source: removeUndefinedValues({
      sourceId: entry.runtimeSourceId,
      mediaFileId: entry.mediaFileId,
      clipId: entry.clipId,
      compositionId: entry.compositionId,
    }),
    priority: 'background',
    tags: ['composition-render', entry.type],
  };
  if (entry.naturalDuration !== undefined) {
    demand.dimensions = {
      durationSeconds: entry.naturalDuration,
    };
  }
  return demand;
}

function reportResource(resource: RenderResourceDescriptor): void {
  timelineRuntimeCoordinator.retainResource(resource);
}

export function reportCompositionRenderSource(entry: CompositionRenderSourceResource): void {
  releaseCompositionRenderSourceResource(entry.compositionId, entry.clipId);

  const ownerId = getCompositionSourceOwnerId(entry.compositionId, entry.clipId);

  if (entry.runtimeSourceId && entry.runtimeSessionKey) {
    const resourceId = getResourceId(entry, `runtime-binding:${entry.runtimeSourceId}:${entry.runtimeSessionKey}`);
    reportResource(createRenderResourceDescriptorFromDemand(
      createCompositionRenderDemand(entry, 'runtime-binding', resourceId),
      {
        resourceKind: 'runtime-binding',
        runtimeSourceId: entry.runtimeSourceId,
        runtimeSessionKey: entry.runtimeSessionKey,
        label: 'Composition render runtime binding',
      }
    ));
  }

  if (entry.videoElement) {
    const element = entry.videoElement;
    const src = element.currentSrc || element.src;
    const status = getMediaStatus(element);
    const resourceId = getResourceId(entry, 'html-media:video');
    reportResource(createRenderResourceDescriptorFromDemand(
      createCompositionRenderDemand(entry, 'html-media', resourceId),
      {
        resourceKind: 'html-media',
        mediaElementKind: 'video',
        elementId: `${ownerId}:video`,
        srcKind: getSrcKind(src),
        diagnostics: {
          status,
          provider: {
            providerId: `${ownerId}:video`,
            providerKind: 'html-video',
            status,
            isReady: element.readyState >= HTMLMediaElement.HAVE_METADATA,
            isPlaying: !element.paused,
            isSeeking: element.seeking,
            currentTimeSeconds: element.currentTime,
            readyState: element.readyState,
            networkState: element.networkState,
            errorCode: element.error ? String(element.error.code) : undefined,
          },
        },
        label: 'Composition render video element',
      }
    ));
  }

  if (entry.imageElement) {
    const resourceId = getResourceId(entry, 'image-canvas:image');
    reportResource(createRenderResourceDescriptorFromDemand(
      createCompositionRenderDemand(entry, 'image-canvas', resourceId),
      {
        resourceKind: 'image-canvas',
        imageKind: 'html-image',
        imageId: `${ownerId}:image`,
        label: 'Composition render image element',
      }
    ));
  }

  if (entry.textCanvas) {
    const resourceId = getResourceId(entry, 'image-canvas:text-canvas');
    reportResource(createRenderResourceDescriptorFromDemand(
      createCompositionRenderDemand(entry, 'image-canvas', resourceId),
      {
        resourceKind: 'image-canvas',
        imageKind: 'html-canvas',
        imageId: `${ownerId}:text-canvas`,
        label: 'Composition render text canvas',
      }
    ));
  }
}

export function releaseCompositionRenderSourceResource(
  compositionId: string,
  clipId: string
): void {
  timelineRuntimeCoordinator.clearResources({
    ownerId: getCompositionSourceOwnerId(compositionId, clipId),
    policyId: 'composition-render',
  });
}
