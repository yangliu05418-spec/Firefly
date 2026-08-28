import { createRenderResourceDescriptorFromDemand } from '../../../services/timeline/runtimeProviderDemandBridge';
import type {
  RenderResourceDescriptor,
  TimelineRuntimeAdmissionDecision,
} from '../../../services/timeline/runtimeCoordinatorTypes';
import { timelineRuntimeCoordinator } from '../../../services/timeline/timelineRuntimeCoordinator';
import type { RuntimeProviderDemand } from '../../../timeline/resources/TimelineVisualResourceDemand';
import { getFiniteDuration } from './backgroundVideoOps';

export function canRetainBackgroundPreloadVideo(videoSrc: string): TimelineRuntimeAdmissionDecision {
  return timelineRuntimeCoordinator.canRetainResource(createBackgroundPreloadVideoResource(videoSrc));
}

export function reportBackgroundPreloadVideo(videoSrc: string, element: HTMLVideoElement): void {
  timelineRuntimeCoordinator.retainResource(createBackgroundPreloadVideoResource(videoSrc, element));
}

export function releaseBackgroundPreloadVideo(videoSrc: string): void {
  timelineRuntimeCoordinator.releaseResource(getBackgroundPreloadVideoResourceId(videoSrc));
}

function getBackgroundPreloadVideoResourceId(videoSrc: string): string {
  return `scrubbing-cache:background-preload-video:${hashString(videoSrc)}`;
}

function createBackgroundPreloadVideoResource(
  videoSrc: string,
  element?: HTMLVideoElement
): RenderResourceDescriptor {
  const resourceId = getBackgroundPreloadVideoResourceId(videoSrc);
  const readyState = element?.readyState ?? 0;
  const networkState = element?.networkState ?? 0;
  const status = element?.error
    ? 'warning'
    : readyState >= HTMLMediaElement.HAVE_METADATA
      ? 'ok'
      : 'unknown';
  const demand: RuntimeProviderDemand = {
    id: resourceId,
    facetId: `${resourceId}:facet`,
    resourceKind: 'html-media',
    policyId: 'background',
    leasePolicy: 'background-cache',
    owner: {
      ownerId: `scrubbing-cache:background-preload:${hashString(videoSrc)}`,
      ownerType: 'timeline',
    },
    source: {
      sourceId: videoSrc,
      previewPath: videoSrc,
    },
    dimensions: removeUndefinedValues({
      width: element?.videoWidth,
      height: element?.videoHeight,
      durationSeconds: getFiniteDuration(element?.duration ?? 0),
    }),
    priority: 'background',
    tags: ['scrubbing-cache', 'background-preload', 'html-video'],
  };

  return createRenderResourceDescriptorFromDemand(demand, {
    resourceKind: 'html-media',
    mediaElementKind: 'video',
    elementId: resourceId,
    srcKind: getVideoSrcKind(videoSrc),
    diagnostics: {
      status,
      provider: {
        providerId: resourceId,
        providerKind: 'html-video',
        status,
        isReady: readyState >= HTMLMediaElement.HAVE_METADATA,
        isPlaying: element ? !element.paused : false,
        isSeeking: element?.seeking ?? false,
        currentTimeSeconds: element?.currentTime ?? 0,
        readyState,
        networkState,
        errorCode: element?.error ? String(element.error.code) : undefined,
      },
    },
    label: 'Background scrub preload video',
  });
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function getVideoSrcKind(src: string | undefined): 'blob-url' | 'file-path' | 'project-path' | 'remote-url' | 'media-source' | 'unknown' {
  if (!src) return 'unknown';
  if (src.startsWith('blob:')) return 'blob-url';
  if (src.startsWith('file:')) return 'file-path';
  if (/^https?:\/\//i.test(src)) return 'remote-url';
  if (src.startsWith('mediastream:')) return 'media-source';
  return 'project-path';
}
