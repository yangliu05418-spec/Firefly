import type { LayerSource, TimelineClip } from '../../types';
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

const RAM_PREVIEW_POLICY_ID = 'ram-preview' as const;

export interface RamPreviewRunJobReport {
  runId: string;
  start: number;
  end: number;
  centerTime: number;
  frameCount?: number;
  label?: string;
  startedAtMs?: number;
}

export interface RamPreviewClipSourceReport {
  runId: string;
  clip: Pick<TimelineClip, 'id' | 'trackId' | 'mediaFileId' | 'duration'>;
  source: LayerSource | NonNullable<TimelineClip['source']>;
  layerId?: string;
  sourceTime?: number;
  nestedCompositionId?: string;
}

export interface RamPreviewImageElementAdmissionReport {
  runId: string;
  clip: Pick<TimelineClip, 'id' | 'trackId' | 'mediaFileId' | 'duration'>;
  layerId?: string;
  nestedCompositionId?: string;
  previewPath?: string;
}

export interface RamPreviewCompositeCacheReport {
  frameCount: number;
  maxFrames: number;
  heapBytes: number;
  width?: number;
  height?: number;
}

export interface RamPreviewGpuFrameReport {
  frameKey: number;
  time: number;
  width?: number;
  height?: number;
  format?: string;
  gpuBytes?: number;
}

export type RamPreviewSourceReservation =
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

function retain(resource: RenderResourceDescriptor): void {
  timelineRuntimeCoordinator.retainResource(resource);
}

function canRetain(resource: RenderResourceDescriptor): TimelineRuntimeAdmissionDecision {
  return timelineRuntimeCoordinator.canRetainResource(resource);
}

export function createRamPreviewRunId(now = Date.now()): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getRamPreviewRunOwnerId(runId: string): string {
  return `ram-preview:run:${runId}`;
}

function getRunResourceId(runId: string, suffix: string): string {
  return `ram-preview:${runId}:${suffix}`;
}

function getClipSourceId(report: RamPreviewClipSourceReport, suffix: string): string {
  const layerId = report.layerId ?? report.clip.id;
  return getRunResourceId(report.runId, `clip:${layerId}:${suffix}`);
}

function getMediaStatus(element: HTMLMediaElement): RuntimeHealthStatus {
  if (element.error) return 'warning';
  return element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? 'ok' : 'unknown';
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

function hasDefinedEntries(value: object): boolean {
  return Object.keys(value).length > 0;
}

function getRunOwner(
  runId: string,
  report?: Pick<RamPreviewClipSourceReport, 'clip'>
): RuntimeProviderDemand['owner'] {
  return removeUndefinedValues({
    ownerId: getRamPreviewRunOwnerId(runId),
    ownerType: 'ram-preview' as const,
    clipId: report?.clip.id,
    trackId: report?.clip.trackId,
    mediaFileId: report?.clip.mediaFileId,
  });
}

function getSourceDescriptor(report: RamPreviewClipSourceReport): RuntimeProviderDemand['source'] {
  return removeUndefinedValues({
    sourceId: report.source.runtimeSourceId,
    mediaFileId: report.source.mediaFileId ?? report.clip.mediaFileId,
    clipId: report.clip.id,
    trackId: report.clip.trackId,
    compositionId: report.nestedCompositionId,
  });
}

function createRamPreviewDemand(params: {
  id: string;
  resourceKind: TimelineRuntimeResourceKind;
  owner: RuntimeProviderDemand['owner'];
  source?: RuntimeProviderDemand['source'];
  dimensions?: RuntimeProviderDemand['dimensions'];
  priority?: RuntimeProviderDemand['priority'];
  cacheKey?: string;
  tags: readonly string[];
}): RuntimeProviderDemand {
  const demand: RuntimeProviderDemand = {
    id: params.id,
    facetId: `${params.id}:facet`,
    resourceKind: params.resourceKind,
    policyId: RAM_PREVIEW_POLICY_ID,
    leasePolicy: 'background-cache',
    owner: params.owner,
    priority: params.priority ?? 'background',
    tags: params.tags,
  };
  if (params.source && hasDefinedEntries(params.source)) {
    demand.source = params.source;
  }
  if (params.dimensions && hasDefinedEntries(params.dimensions)) {
    demand.dimensions = params.dimensions;
  }
  if (params.cacheKey) {
    demand.cacheKey = params.cacheKey;
  }
  return demand;
}

function createRamPreviewSourceDemand(
  report: RamPreviewClipSourceReport,
  resourceKind: TimelineRuntimeResourceKind,
  resourceId: string
): RuntimeProviderDemand {
  return createRamPreviewDemand({
    id: resourceId,
    resourceKind,
    owner: getRunOwner(report.runId, report),
    source: getSourceDescriptor(report),
    dimensions: {
      durationSeconds: report.clip.duration,
    },
    tags: ['ram-preview', report.source.type],
  });
}

function createRamPreviewRunJobResource(report: RamPreviewRunJobReport): RenderResourceDescriptor {
  const resourceId = getRunResourceId(report.runId, 'job:render');
  return createRenderResourceDescriptorFromDemand(createRamPreviewDemand({
    id: resourceId,
    resourceKind: 'job',
    owner: getRunOwner(report.runId),
    source: {
      previewPath: `${report.start.toFixed(3)}-${report.end.toFixed(3)}`,
    },
    dimensions: removeUndefinedValues({
      durationSeconds: Math.max(0, report.end - report.start),
      fps: report.frameCount,
    }),
    tags: ['ram-preview', 'render-job'],
  }), {
    resourceKind: 'job',
    jobId: report.runId,
    jobKind: 'ram-preview-render',
    startedAtMs: report.startedAtMs,
    label: report.label ?? 'RAM preview render',
  });
}

export function canRetainRamPreviewRunJob(
  report: RamPreviewRunJobReport
): TimelineRuntimeAdmissionDecision {
  return canRetain(createRamPreviewRunJobResource(report));
}

export function reportRamPreviewRunJob(report: RamPreviewRunJobReport): void {
  retain(createRamPreviewRunJobResource(report));
}

function getRamPreviewImageElementSourceReport(
  report: RamPreviewImageElementAdmissionReport
): RamPreviewClipSourceReport {
  return {
    runId: report.runId,
    clip: report.clip,
    layerId: report.layerId,
    nestedCompositionId: report.nestedCompositionId,
    source: {
      type: 'image',
      mediaFileId: report.clip.mediaFileId,
    } as LayerSource,
  };
}

function getRamPreviewImageElementResourceId(
  report: RamPreviewImageElementAdmissionReport
): string {
  return getClipSourceId(getRamPreviewImageElementSourceReport(report), 'image-canvas:image');
}

function createRamPreviewImageElementResource(
  report: RamPreviewImageElementAdmissionReport
): RenderResourceDescriptor {
  return createRenderResourceDescriptorFromDemand(createRamPreviewDemand({
    id: getRamPreviewImageElementResourceId(report),
    resourceKind: 'image-canvas',
    owner: getRunOwner(report.runId, report),
    source: removeUndefinedValues({
      sourceId: report.clip.mediaFileId,
      mediaFileId: report.clip.mediaFileId,
      clipId: report.clip.id,
      trackId: report.clip.trackId,
      compositionId: report.nestedCompositionId,
      previewPath: report.previewPath,
    }),
    dimensions: {
      durationSeconds: report.clip.duration,
    },
    tags: ['ram-preview', 'image'],
  }), {
    resourceKind: 'image-canvas',
    imageKind: 'html-image',
    imageId: `${getRamPreviewRunOwnerId(report.runId)}:${report.layerId ?? report.clip.id}:image`,
    label: 'RAM preview image element',
  });
}

export function canRetainRamPreviewImageElement(
  report: RamPreviewImageElementAdmissionReport
): TimelineRuntimeAdmissionDecision {
  return canRetain(createRamPreviewImageElementResource(report));
}

export function reserveRamPreviewImageElement(
  report: RamPreviewImageElementAdmissionReport
): TimelineRuntimeAdmissionDecision {
  const resource = createRamPreviewImageElementResource(report);
  const decision = canRetain(resource);
  if (decision.admitted) {
    retain(resource);
  }
  return decision;
}

export function releaseReservedRamPreviewImageElement(
  report: RamPreviewImageElementAdmissionReport
): void {
  timelineRuntimeCoordinator.releaseResource(getRamPreviewImageElementResourceId(report));
}

export function reportRamPreviewClipSource(report: RamPreviewClipSourceReport): void {
  if (report.source.runtimeSourceId && report.source.runtimeSessionKey) {
    const resourceId = getClipSourceId(
      report,
      `runtime-binding:${report.source.runtimeSourceId}:${report.source.runtimeSessionKey}`
    );
    retain(createRenderResourceDescriptorFromDemand(
      createRamPreviewSourceDemand(report, 'runtime-binding', resourceId),
      {
        resourceKind: 'runtime-binding',
        runtimeSourceId: report.source.runtimeSourceId,
        runtimeSessionKey: report.source.runtimeSessionKey,
        label: 'RAM preview runtime binding',
      }
    ));
  }

  if (report.source.webCodecsPlayer) {
    const provider = report.source.webCodecsPlayer;
    const status: RuntimeHealthStatus = provider.isFullMode() ? 'ok' : 'warning';
    const providerId = `${getRamPreviewRunOwnerId(report.runId)}:${report.layerId ?? report.clip.id}:provider`;
    const resourceId = getClipSourceId(report, 'video-frame-provider');
    retain(createRenderResourceDescriptorFromDemand(
      createRamPreviewSourceDemand(report, 'video-frame-provider', resourceId),
      {
        resourceKind: 'video-frame-provider',
        providerId,
        providerKind: 'runtime-frame-provider',
        canSeek: true,
        canProvideStaleFrame: true,
        frameFormat: 'video-frame',
        runtimeSourceId: report.source.runtimeSourceId,
        runtimeSessionKey: report.source.runtimeSessionKey,
        diagnostics: {
          status,
          provider: {
            providerId,
            providerKind: 'webcodecs',
            status,
            isReady: provider.isFullMode(),
            isPlaying: provider.isPlaying,
            isSeeking: provider.isSeeking?.(),
            isDecodePending: provider.isDecodePending?.(),
            currentTimeSeconds: provider.currentTime,
            targetTimeSeconds: report.sourceTime,
            pendingSeekTimeSeconds: provider.getPendingSeekTime?.() ?? null,
          },
        },
        label: 'RAM preview frame provider',
      }
    ));
  }

  if (report.source.videoElement) {
    const video = report.source.videoElement;
    const src = video.currentSrc || video.src;
    const status = getMediaStatus(video);
    const elementId = `${getRamPreviewRunOwnerId(report.runId)}:${report.layerId ?? report.clip.id}:video`;
    const resourceId = getClipSourceId(report, 'html-media:video');
    retain(createRenderResourceDescriptorFromDemand(
      createRamPreviewSourceDemand(report, 'html-media', resourceId),
      {
        resourceKind: 'html-media',
        mediaElementKind: 'video',
        elementId,
        srcKind: getSrcKind(src),
        diagnostics: {
          status,
          provider: {
            providerId: elementId,
            providerKind: 'html-video',
            status,
            isReady: video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
            isPlaying: !video.paused,
            isSeeking: video.seeking,
            currentTimeSeconds: video.currentTime,
            targetTimeSeconds: report.sourceTime,
            readyState: video.readyState,
            networkState: video.networkState,
            errorCode: video.error ? String(video.error.code) : undefined,
          },
        },
        label: 'RAM preview video element',
      }
    ));
  }

  if (report.source.imageElement) {
    const resourceId = getClipSourceId(report, 'image-canvas:image');
    retain(createRenderResourceDescriptorFromDemand(
      createRamPreviewSourceDemand(report, 'image-canvas', resourceId),
      {
        resourceKind: 'image-canvas',
        imageKind: 'html-image',
        imageId: `${getRamPreviewRunOwnerId(report.runId)}:${report.layerId ?? report.clip.id}:image`,
        label: 'RAM preview image element',
      }
    ));
  }

  if (report.source.textCanvas) {
    const resourceId = getClipSourceId(report, 'image-canvas:text-canvas');
    retain(createRenderResourceDescriptorFromDemand(
      createRamPreviewSourceDemand(report, 'image-canvas', resourceId),
      {
        resourceKind: 'image-canvas',
        imageKind: 'html-canvas',
        imageId: `${getRamPreviewRunOwnerId(report.runId)}:${report.layerId ?? report.clip.id}:text-canvas`,
        label: 'RAM preview text canvas',
      }
    ));
  }
}

function createRamPreviewVideoSourceAdmissionResources(
  report: RamPreviewClipSourceReport
): RenderResourceDescriptor[] {
  const resources: RenderResourceDescriptor[] = [];

  if (report.source.runtimeSourceId && report.source.runtimeSessionKey) {
    const resourceId = getClipSourceId(
      report,
      `runtime-binding:${report.source.runtimeSourceId}:${report.source.runtimeSessionKey}`
    );
    resources.push(createRenderResourceDescriptorFromDemand(
      createRamPreviewSourceDemand(report, 'runtime-binding', resourceId),
      {
        resourceKind: 'runtime-binding',
        runtimeSourceId: report.source.runtimeSourceId,
        runtimeSessionKey: report.source.runtimeSessionKey,
        label: 'RAM preview runtime binding',
      }
    ));
  }

  if (report.source.webCodecsPlayer) {
    const resourceId = getClipSourceId(report, 'video-frame-provider');
    resources.push(createRenderResourceDescriptorFromDemand(
      createRamPreviewSourceDemand(report, 'video-frame-provider', resourceId),
      {
        resourceKind: 'video-frame-provider',
        providerId: `${getRamPreviewRunOwnerId(report.runId)}:${report.layerId ?? report.clip.id}:provider`,
        providerKind: 'runtime-frame-provider',
        canSeek: true,
        canProvideStaleFrame: true,
        frameFormat: 'video-frame',
        runtimeSourceId: report.source.runtimeSourceId,
        runtimeSessionKey: report.source.runtimeSessionKey,
        label: 'RAM preview frame provider',
      }
    ));
  }

  if (report.source.videoElement) {
    const video = report.source.videoElement;
    const src = video.currentSrc || video.src;
    const resourceId = getClipSourceId(report, 'html-media:video');
    resources.push(createRenderResourceDescriptorFromDemand(
      createRamPreviewSourceDemand(report, 'html-media', resourceId),
      {
        resourceKind: 'html-media',
        mediaElementKind: 'video',
        elementId: `${getRamPreviewRunOwnerId(report.runId)}:${report.layerId ?? report.clip.id}:video`,
        srcKind: getSrcKind(src),
        label: 'RAM preview video element',
      }
    ));
  }

  return resources;
}

export function reserveRamPreviewVideoSource(
  report: RamPreviewClipSourceReport
): RamPreviewSourceReservation {
  const retainedResourceIds: string[] = [];
  const release = () => {
    for (const resourceId of retainedResourceIds) {
      timelineRuntimeCoordinator.releaseResource(resourceId);
    }
  };

  for (const resource of createRamPreviewVideoSourceAdmissionResources(report)) {
    const decision = canRetain(resource);
    if (!decision.admitted) {
      release();
      return {
        admitted: false,
        decision,
        resourceIds: [],
        release: () => undefined,
      };
    }
    retain(resource);
    retainedResourceIds.push(resource.id);
  }

  return {
    admitted: true,
    resourceIds: retainedResourceIds,
    release,
  };
}

export function releaseRamPreviewRunResources(runId: string): void {
  timelineRuntimeCoordinator.clearResources({
    ownerId: getRamPreviewRunOwnerId(runId),
    policyId: RAM_PREVIEW_POLICY_ID,
  });
}

const RAM_PREVIEW_COMPOSITE_CACHE_OWNER_ID = 'ram-preview:composite-cache';
const RAM_PREVIEW_GPU_FRAME_CACHE_OWNER_ID = 'ram-preview:gpu-frame-cache';

function createRamPreviewCompositeCacheResource(
  report: RamPreviewCompositeCacheReport
): RenderResourceDescriptor {
  const resourceId = 'ram-preview:composite-cache:image-data';
  return createRenderResourceDescriptorFromDemand(createRamPreviewDemand({
    id: resourceId,
    resourceKind: 'image-canvas',
    owner: {
      ownerId: RAM_PREVIEW_COMPOSITE_CACHE_OWNER_ID,
      ownerType: 'ram-preview',
    },
    dimensions: removeUndefinedValues({
      width: report.width,
      height: report.height,
    }),
    tags: ['ram-preview', 'composite-cache', 'cpu'],
  }), {
    resourceKind: 'image-canvas',
    imageKind: 'offscreen-canvas',
    imageId: 'ram-preview:composite-cache',
    memoryCost: {
      heapBytes: report.heapBytes,
    },
    diagnostics: {
      status: 'ok',
      messages: [
        {
          severity: 'info',
          code: 'ram-preview.composite-cache',
          message: `${report.frameCount}/${report.maxFrames} CPU composite frames retained.`,
          policyId: RAM_PREVIEW_POLICY_ID,
        },
      ],
    },
    label: 'RAM preview CPU composite cache',
  });
}

export function canRetainRamPreviewCompositeCache(
  report: RamPreviewCompositeCacheReport
): TimelineRuntimeAdmissionDecision {
  return canRetain(createRamPreviewCompositeCacheResource(report));
}

export function reportRamPreviewCompositeCache(report: RamPreviewCompositeCacheReport): void {
  if (report.frameCount <= 0 || report.heapBytes <= 0) {
    releaseRamPreviewCompositeCacheResource();
    return;
  }

  retain(createRamPreviewCompositeCacheResource(report));
}

export function releaseRamPreviewCompositeCacheResource(): void {
  timelineRuntimeCoordinator.clearResources({
    ownerId: RAM_PREVIEW_COMPOSITE_CACHE_OWNER_ID,
    policyId: RAM_PREVIEW_POLICY_ID,
  });
}

function getGpuFrameResourceId(frameKey: number): string {
  return `ram-preview:gpu-frame-cache:${frameKey.toFixed(3)}`;
}

function createRamPreviewGpuFrameResource(report: RamPreviewGpuFrameReport): RenderResourceDescriptor {
  const resourceId = getGpuFrameResourceId(report.frameKey);
  return createRenderResourceDescriptorFromDemand(createRamPreviewDemand({
    id: resourceId,
    resourceKind: 'gpu-texture',
    owner: {
      ownerId: RAM_PREVIEW_GPU_FRAME_CACHE_OWNER_ID,
      ownerType: 'ram-preview',
    },
    source: {
      previewPath: report.time.toFixed(3),
    },
    dimensions: removeUndefinedValues({
      width: report.width,
      height: report.height,
    }),
    tags: ['ram-preview', 'gpu-frame-cache'],
  }), {
    resourceKind: 'gpu-texture',
    textureId: resourceId,
    textureKind: 'ram-preview-frame',
    format: report.format,
    memoryCost: report.gpuBytes === undefined
      ? undefined
      : {
          gpuBytes: report.gpuBytes,
        },
    label: 'RAM preview GPU cached frame',
  });
}

export function canRetainRamPreviewGpuFrame(
  report: RamPreviewGpuFrameReport
): TimelineRuntimeAdmissionDecision {
  return canRetain(createRamPreviewGpuFrameResource(report));
}

export function reportRamPreviewGpuFrame(report: RamPreviewGpuFrameReport): void {
  retain(createRamPreviewGpuFrameResource(report));
}

export function releaseRamPreviewGpuFrameResource(frameKey: number): void {
  timelineRuntimeCoordinator.releaseResource(getGpuFrameResourceId(frameKey));
}

export function releaseRamPreviewGpuFrameCacheResources(): void {
  timelineRuntimeCoordinator.clearResources({
    ownerId: RAM_PREVIEW_GPU_FRAME_CACHE_OWNER_ID,
    policyId: RAM_PREVIEW_POLICY_ID,
  });
}
