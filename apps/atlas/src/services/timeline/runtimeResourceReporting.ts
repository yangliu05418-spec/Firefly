import type { TimelineClip } from '../../types';
import type {
  RuntimeProviderDemand,
  TimelineRuntimeResourceKind,
} from '../../timeline';
import type {
  RenderResourceDescriptor,
  RuntimeResourceOwnerDescriptor,
  TimelineRuntimeAdmissionDecision,
  TimelineRuntimePolicyId,
} from './runtimeCoordinatorTypes';
import { createRenderResourceDescriptorFromDemand } from './runtimeProviderDemandBridge';
import { timelineRuntimeCoordinator } from './timelineRuntimeCoordinator';

type ClipSource = NonNullable<TimelineClip['source']>;

type PlannedClipRuntimeSource = Pick<
  ClipSource,
  'type' | 'mediaFileId' | 'filePath' | 'naturalDuration' | 'runtimeSourceId' | 'runtimeSessionKey'
>;

interface ReservePlannedClipRuntimeResourcesParams extends ReportClipRuntimeResourcesParams {
  source: PlannedClipRuntimeSource;
  mediaElementKind?: 'video' | 'audio';
  srcKind?: 'blob-url' | 'remote-url' | 'media-source' | 'unknown';
  dimensions?: {
    durationSeconds?: number;
  };
}

export type PlannedClipRuntimeResourceReservation =
  | {
      admitted: true;
      resourceIds: readonly string[];
      release: () => void;
    }
  | {
      admitted: false;
      decision: TimelineRuntimeAdmissionDecision;
      resourceIds: readonly string[];
      release: () => void;
    };

interface ReportClipRuntimeResourcesParams {
  policyId: TimelineRuntimePolicyId;
  ownerId: string;
  clip: TimelineClip;
  ownerType?: RuntimeResourceOwnerDescriptor['ownerType'];
  compositionId?: string;
  label?: string;
  tags?: readonly string[];
}

function getSourceId(source: ClipSource): string | undefined {
  return source.runtimeSourceId ?? source.mediaFileId ?? undefined;
}

function getSrcKind(element: HTMLMediaElement): 'blob-url' | 'remote-url' | 'media-source' | 'unknown' {
  const src = element.currentSrc || element.src;
  if (!src) return 'unknown';
  if (src.startsWith('blob:')) return 'blob-url';
  if (src.startsWith('http')) return 'remote-url';
  if (src.startsWith('mediastream:')) return 'media-source';
  return 'unknown';
}

function getMediaProviderStatus(element: HTMLMediaElement): 'ok' | 'warning' | 'unknown' {
  if (element.error) return 'warning';
  return element.readyState >= HTMLMediaElement.HAVE_METADATA ? 'ok' : 'unknown';
}

function getOwner(params: ReportClipRuntimeResourcesParams): RuntimeResourceOwnerDescriptor {
  const mediaFileId = params.clip.source?.mediaFileId ?? params.clip.mediaFileId;
  return removeUndefinedValues({
    ownerId: params.ownerId,
    ownerType: params.ownerType ?? 'clip',
    clipId: params.clip.id,
    trackId: params.clip.trackId,
    compositionId: params.compositionId ?? params.clip.compositionId,
    mediaFileId,
  });
}

function getPlannedOwner(params: ReservePlannedClipRuntimeResourcesParams): RuntimeResourceOwnerDescriptor {
  const mediaFileId = params.source.mediaFileId ?? params.clip.source?.mediaFileId ?? params.clip.mediaFileId;
  return removeUndefinedValues({
    ownerId: params.ownerId,
    ownerType: params.ownerType ?? 'clip',
    clipId: params.clip.id,
    trackId: params.clip.trackId,
    compositionId: params.compositionId ?? params.clip.compositionId,
    mediaFileId,
  });
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function createReportedClipRuntimeDemand(
  params: ReportClipRuntimeResourcesParams,
  source: ClipSource,
  resourceKind: TimelineRuntimeResourceKind,
  resourceId: string
): RuntimeProviderDemand {
  const demand: RuntimeProviderDemand = {
    id: resourceId,
    facetId: `${resourceId}:facet`,
    resourceKind,
    policyId: params.policyId,
    leasePolicy: 'lease-visible',
    owner: getOwner(params),
    source: removeUndefinedValues({
      sourceId: getSourceId(source),
      clipId: params.clip.id,
      trackId: params.clip.trackId,
      compositionId: params.compositionId ?? params.clip.compositionId,
      mediaFileId: source.mediaFileId ?? params.clip.mediaFileId,
      projectPath: source.filePath,
    }),
    dimensions: {
      durationSeconds: source.naturalDuration ?? params.clip.duration,
    },
    priority: params.policyId === 'interactive' ? 'visible' : 'background',
  };
  if (params.tags) {
    demand.tags = params.tags;
  }
  return demand;
}

function createPlannedClipRuntimeDemand(
  params: ReservePlannedClipRuntimeResourcesParams,
  resourceKind: TimelineRuntimeResourceKind,
  resourceId: string
): RuntimeProviderDemand {
  const demand: RuntimeProviderDemand = {
    id: resourceId,
    facetId: `${resourceId}:facet`,
    resourceKind,
    policyId: params.policyId,
    leasePolicy: 'lease-visible',
    owner: getPlannedOwner(params),
    source: removeUndefinedValues({
      sourceId: params.source.runtimeSourceId ?? params.source.mediaFileId ?? undefined,
      clipId: params.clip.id,
      trackId: params.clip.trackId,
      compositionId: params.compositionId ?? params.clip.compositionId,
      mediaFileId: params.source.mediaFileId ?? params.clip.mediaFileId,
      projectPath: params.source.filePath,
    }),
    dimensions: {
      durationSeconds: params.dimensions?.durationSeconds ?? params.source.naturalDuration ?? params.clip.duration,
    },
    priority: params.policyId === 'interactive' ? 'visible' : 'background',
  };
  if (params.tags) {
    demand.tags = params.tags;
  }
  return demand;
}

function createPlannedClipRuntimeResources(
  params: ReservePlannedClipRuntimeResourcesParams
): RenderResourceDescriptor[] {
  const idBase = `timeline-runtime:${params.policyId}:${params.ownerId}`;
  const resources: RenderResourceDescriptor[] = [];

  if (params.source.runtimeSourceId && params.source.runtimeSessionKey) {
    const resourceId = `${idBase}:runtime-binding:${params.source.runtimeSourceId}:${params.source.runtimeSessionKey}`;
    resources.push(createRenderResourceDescriptorFromDemand(
      createPlannedClipRuntimeDemand(params, 'runtime-binding', resourceId),
      {
        resourceKind: 'runtime-binding',
        runtimeSourceId: params.source.runtimeSourceId,
        runtimeSessionKey: params.source.runtimeSessionKey,
        label: params.label ?? 'Runtime binding',
      }
    ));
  }

  if (params.mediaElementKind) {
    const resourceId = `${idBase}:html-media:${params.mediaElementKind}`;
    resources.push(createRenderResourceDescriptorFromDemand(
      createPlannedClipRuntimeDemand(params, 'html-media', resourceId),
      {
        resourceKind: 'html-media',
        mediaElementKind: params.mediaElementKind,
        elementId: `${params.ownerId}:${params.mediaElementKind}`,
        srcKind: params.srcKind,
        label: params.label ?? `${params.mediaElementKind === 'video' ? 'Video' : 'Audio'} media element`,
      }
    ));
  }

  return resources;
}

function reportResource(resource: RenderResourceDescriptor): void {
  timelineRuntimeCoordinator.retainResource(resource);
}

export function reservePlannedClipRuntimeResources(
  params: ReservePlannedClipRuntimeResourcesParams
): PlannedClipRuntimeResourceReservation {
  const retainedResourceIds: string[] = [];
  const release = () => {
    for (const resourceId of retainedResourceIds) {
      timelineRuntimeCoordinator.releaseResource(resourceId);
    }
  };

  for (const resource of createPlannedClipRuntimeResources(params)) {
    const decision = timelineRuntimeCoordinator.canRetainResource(resource);
    if (!decision.admitted) {
      release();
      return {
        admitted: false,
        decision,
        resourceIds: [],
        release: () => undefined,
      };
    }
    timelineRuntimeCoordinator.retainResource(resource);
    retainedResourceIds.push(resource.id);
  }

  return {
    admitted: true,
    resourceIds: retainedResourceIds,
    release,
  };
}

export function reportClipRuntimeResources(params: ReportClipRuntimeResourcesParams): void {
  const source = params.clip.source;
  if (!source) {
    return;
  }

  const idBase = `timeline-runtime:${params.policyId}:${params.ownerId}`;

  if (source.runtimeSourceId && source.runtimeSessionKey) {
    const resourceId = `${idBase}:runtime-binding:${source.runtimeSourceId}:${source.runtimeSessionKey}`;
    reportResource(createRenderResourceDescriptorFromDemand(
      createReportedClipRuntimeDemand(params, source, 'runtime-binding', resourceId),
      {
        resourceKind: 'runtime-binding',
        runtimeSourceId: source.runtimeSourceId,
        runtimeSessionKey: source.runtimeSessionKey,
        label: params.label ?? 'Runtime binding',
      }
    ));
  }

  if (source.videoElement) {
    const element = source.videoElement;
    const status = getMediaProviderStatus(element);
    const resourceId = `${idBase}:html-media:video`;
    reportResource(createRenderResourceDescriptorFromDemand(
      createReportedClipRuntimeDemand(params, source, 'html-media', resourceId),
      {
        resourceKind: 'html-media',
        mediaElementKind: 'video',
        elementId: `${params.ownerId}:video`,
        srcKind: getSrcKind(element),
        diagnostics: {
          status,
          provider: {
            providerId: `${params.ownerId}:video`,
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
        label: params.label ?? 'Video media element',
      }
    ));
  }

  if (source.audioElement) {
    const element = source.audioElement;
    const status = getMediaProviderStatus(element);
    const resourceId = `${idBase}:html-media:audio`;
    reportResource(createRenderResourceDescriptorFromDemand(
      createReportedClipRuntimeDemand(params, source, 'html-media', resourceId),
      {
        resourceKind: 'html-media',
        mediaElementKind: 'audio',
        elementId: `${params.ownerId}:audio`,
        srcKind: getSrcKind(element),
        diagnostics: {
          status,
          provider: {
            providerId: `${params.ownerId}:audio`,
            providerKind: 'html-audio',
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
        label: params.label ?? 'Audio media element',
      }
    ));
  }

  if (source.imageElement) {
    const resourceId = `${idBase}:image-canvas:image`;
    reportResource(createRenderResourceDescriptorFromDemand(
      createReportedClipRuntimeDemand(params, source, 'image-canvas', resourceId),
      {
        resourceKind: 'image-canvas',
        imageKind: 'html-image',
        imageId: `${params.ownerId}:image`,
        label: params.label ?? 'Image element',
      }
    ));
  }

  if (source.textCanvas) {
    const resourceId = `${idBase}:image-canvas:text-canvas`;
    reportResource(createRenderResourceDescriptorFromDemand(
      createReportedClipRuntimeDemand(params, source, 'image-canvas', resourceId),
      {
        resourceKind: 'image-canvas',
        imageKind: 'html-canvas',
        imageId: `${params.ownerId}:text-canvas`,
        label: params.label ?? 'Text canvas',
      }
    ));
  }
}

export function releaseReportedClipRuntimeResources(
  policyId: TimelineRuntimePolicyId,
  ownerId: string
): void {
  timelineRuntimeCoordinator.clearResources({ ownerId, policyId });
}
