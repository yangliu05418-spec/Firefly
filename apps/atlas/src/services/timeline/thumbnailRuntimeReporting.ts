import type {
  RuntimeProviderDemand,
  TimelineRuntimeResourceKind,
} from '../../timeline';
import type {
  RenderResourceDescriptor,
  RuntimeHealthStatus,
  TimelineRuntimeAdmissionDecision,
} from './runtimeCoordinatorTypes';
import { createRenderResourceDescriptorFromDemand } from './runtimeProviderDemandBridge';
import { timelineRuntimeCoordinator } from './timelineRuntimeCoordinator';

type ThumbnailJobKind =
  | 'thumbnail-db-load'
  | 'thumbnail-generation'
  | 'thumbnail-bitmap-decode';

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getThumbnailOwner(params: {
  mediaFileId?: string;
  thumbnailUrl?: string;
}) {
  const mediaFileId = params.mediaFileId;
  const thumbnailHash = params.thumbnailUrl ? hashString(params.thumbnailUrl) : undefined;
  return removeUndefinedValues({
    ownerId: mediaFileId ? `thumbnail:${mediaFileId}` : `thumbnail-url:${thumbnailHash ?? 'unknown'}`,
    ownerType: 'thumbnail' as const,
    mediaFileId,
  });
}

function getStatus(status?: RuntimeHealthStatus): RuntimeHealthStatus {
  return status ?? 'unknown';
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function createThumbnailDemand(params: {
  id: string;
  resourceKind: TimelineRuntimeResourceKind;
  mediaFileId?: string;
  thumbnailUrl?: string;
  fileHash?: string;
  sourceUrl?: string;
  tags: readonly string[];
  dimensions?: RuntimeProviderDemand['dimensions'];
}): RuntimeProviderDemand {
  const demand: RuntimeProviderDemand = {
    id: params.id,
    facetId: `${params.id}:facet`,
    resourceKind: params.resourceKind,
    policyId: 'thumbnail',
    leasePolicy: 'background-cache',
    owner: getThumbnailOwner(params),
    source: removeUndefinedValues({
      mediaFileId: params.mediaFileId,
      fileHash: params.fileHash,
      previewPath: params.thumbnailUrl,
      projectPath: params.sourceUrl,
    }),
    priority: 'background',
    tags: params.tags,
  };
  if (params.dimensions) {
    demand.dimensions = params.dimensions;
  }
  return demand;
}

export function getThumbnailDbLoadJobId(mediaFileId: string, fileHash?: string): string {
  return `timeline-thumbnail:db-load:${mediaFileId}:${fileHash ?? 'no-hash'}`;
}

export function getThumbnailGenerationJobId(mediaFileId: string): string {
  return `timeline-thumbnail:generation:${mediaFileId}`;
}

export function getThumbnailGenerationVideoResourceId(mediaFileId: string): string {
  return `timeline-thumbnail:generation-video:${mediaFileId}`;
}

export function getThumbnailGenerationCanvasResourceId(mediaFileId: string): string {
  return `timeline-thumbnail:generation-canvas:${mediaFileId}`;
}

export function getThumbnailBitmapDecodeJobId(url: string): string {
  return `timeline-thumbnail:bitmap-decode:${hashString(url)}`;
}

export function getThumbnailBitmapResourceId(url: string): string {
  return `timeline-thumbnail:bitmap:${hashString(url)}`;
}

export function createThumbnailJobDescriptor(params: {
  jobId: string;
  jobKind: ThumbnailJobKind;
  mediaFileId?: string;
  fileHash?: string;
  thumbnailUrl?: string;
  sourceUrl?: string;
  status?: RuntimeHealthStatus;
}): RenderResourceDescriptor {
  const status = getStatus(params.status);
  return createRenderResourceDescriptorFromDemand(createThumbnailDemand({
    id: params.jobId,
    resourceKind: 'job',
    mediaFileId: params.mediaFileId,
    fileHash: params.fileHash,
    thumbnailUrl: params.thumbnailUrl,
    sourceUrl: params.sourceUrl,
    tags: ['thumbnail', params.jobKind],
  }), {
    resourceKind: 'job',
    jobId: params.jobId,
    jobKind: params.jobKind,
    diagnostics: {
      status,
      messages: [
        {
          severity: status === 'warning' ? 'warning' : 'info',
          code: `thumbnail.${params.jobKind}`,
          message: `${params.jobKind} is retained by the thumbnail runtime policy.`,
          policyId: 'thumbnail',
          resourceId: params.jobId,
        },
      ],
    },
    label: params.jobKind,
  });
}

export function canRetainThumbnailJob(params: {
  jobId: string;
  jobKind: ThumbnailJobKind;
  mediaFileId?: string;
  fileHash?: string;
  thumbnailUrl?: string;
  sourceUrl?: string;
  status?: RuntimeHealthStatus;
}): TimelineRuntimeAdmissionDecision {
  return timelineRuntimeCoordinator.canRetainResource(createThumbnailJobDescriptor(params));
}

export function reportThumbnailJob(params: {
  jobId: string;
  jobKind: ThumbnailJobKind;
  mediaFileId?: string;
  fileHash?: string;
  thumbnailUrl?: string;
  sourceUrl?: string;
  status?: RuntimeHealthStatus;
}): void {
  timelineRuntimeCoordinator.retainResource(createThumbnailJobDescriptor(params));
}

export function reportThumbnailGenerationVideo(params: {
  mediaFileId: string;
  sourceUrl: string;
  element: HTMLVideoElement;
}): void {
  timelineRuntimeCoordinator.retainResource(createThumbnailGenerationVideoDescriptor(params));
}

export function createThumbnailGenerationVideoDescriptor(params: {
  mediaFileId: string;
  sourceUrl: string;
  element?: HTMLVideoElement;
}): RenderResourceDescriptor {
  const status: RuntimeHealthStatus = params.element?.error
    ? 'warning'
    : (params.element?.readyState ?? 0) >= HTMLMediaElement.HAVE_METADATA
      ? 'ok'
      : 'unknown';
  const resourceId = getThumbnailGenerationVideoResourceId(params.mediaFileId);
  return createRenderResourceDescriptorFromDemand(createThumbnailDemand({
    id: resourceId,
    resourceKind: 'html-media',
    mediaFileId: params.mediaFileId,
    sourceUrl: params.sourceUrl,
    tags: ['thumbnail', 'thumbnail-generation', 'detached-video'],
  }), {
    resourceKind: 'html-media',
    mediaElementKind: 'video',
    elementId: `thumbnail-generation-video:${params.mediaFileId}`,
    srcKind: params.sourceUrl.startsWith('blob:')
      ? 'blob-url'
      : params.sourceUrl.startsWith('http')
        ? 'remote-url'
        : 'unknown',
    diagnostics: {
      status,
      provider: {
        providerId: `thumbnail-generation-video:${params.mediaFileId}`,
        providerKind: 'html-video',
        status,
        isReady: (params.element?.readyState ?? 0) >= HTMLMediaElement.HAVE_METADATA,
        isPlaying: params.element ? !params.element.paused : false,
        isSeeking: params.element?.seeking ?? false,
        currentTimeSeconds: params.element?.currentTime ?? 0,
        readyState: params.element?.readyState ?? 0,
        networkState: params.element?.networkState ?? 0,
        errorCode: params.element?.error ? String(params.element.error.code) : undefined,
      },
    },
    label: 'Thumbnail generation video',
  });
}

export function canRetainThumbnailGenerationVideo(params: {
  mediaFileId: string;
  sourceUrl: string;
  element?: HTMLVideoElement;
}): TimelineRuntimeAdmissionDecision {
  return timelineRuntimeCoordinator.canRetainResource(createThumbnailGenerationVideoDescriptor(params));
}

export function createThumbnailGenerationCanvasDescriptor(mediaFileId: string): RenderResourceDescriptor {
  const resourceId = getThumbnailGenerationCanvasResourceId(mediaFileId);
  return createRenderResourceDescriptorFromDemand(createThumbnailDemand({
    id: resourceId,
    resourceKind: 'image-canvas',
    mediaFileId,
    dimensions: {
      width: 160,
      height: 90,
    },
    tags: ['thumbnail', 'thumbnail-generation', 'canvas'],
  }), {
    resourceKind: 'image-canvas',
    imageKind: 'html-canvas',
    imageId: `thumbnail-generation-canvas:${mediaFileId}`,
    diagnostics: {
      status: 'ok',
    },
    label: 'Thumbnail generation canvas',
  });
}

export function canRetainThumbnailGenerationCanvas(mediaFileId: string): TimelineRuntimeAdmissionDecision {
  return timelineRuntimeCoordinator.canRetainResource(createThumbnailGenerationCanvasDescriptor(mediaFileId));
}

export function reportThumbnailGenerationCanvas(mediaFileId: string): void {
  timelineRuntimeCoordinator.retainResource(createThumbnailGenerationCanvasDescriptor(mediaFileId));
}

export function reportThumbnailBitmapDecodeJob(url: string, mediaFileId?: string): void {
  reportThumbnailJob({
    jobId: getThumbnailBitmapDecodeJobId(url),
    jobKind: 'thumbnail-bitmap-decode',
    mediaFileId,
    thumbnailUrl: url,
  });
}

export function createThumbnailBitmapResourceDescriptor(
  url: string,
  mediaFileId?: string,
): RenderResourceDescriptor {
  const resourceId = getThumbnailBitmapResourceId(url);
  return createRenderResourceDescriptorFromDemand(createThumbnailDemand({
    id: resourceId,
    resourceKind: 'image-canvas',
    mediaFileId,
    thumbnailUrl: url,
    tags: ['thumbnail', 'bitmap-decode', 'image-bitmap'],
  }), {
    resourceKind: 'image-canvas',
    imageKind: 'image-bitmap',
    imageId: `thumbnail-bitmap:${hashString(url)}`,
    diagnostics: {
      status: 'ok',
    },
    label: 'Decoded thumbnail bitmap',
  });
}

export function reportThumbnailBitmapResource(url: string, mediaFileId?: string): void {
  const resource = createThumbnailBitmapResourceDescriptor(url, mediaFileId);
  timelineRuntimeCoordinator.retainResource(resource);
}

export function releaseThumbnailRuntimeResource(resourceId: string): void {
  timelineRuntimeCoordinator.releaseResource(resourceId);
}
