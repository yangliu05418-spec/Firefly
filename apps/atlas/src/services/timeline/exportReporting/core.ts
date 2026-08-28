import type {
  RuntimeProviderDemand,
  TimelineRuntimeResourceKind,
} from '../../../timeline';
import type {
  RenderResourceDescriptor,
  RuntimeHealthStatus,
  TimelineRuntimeAdmissionDecision,
} from '../runtimeCoordinatorTypes';
import { timelineRuntimeCoordinator } from '../timelineRuntimeCoordinator';

export const EXPORT_POLICY_ID = 'export' as const;

export function retainExportResource(resource: RenderResourceDescriptor): void {
  timelineRuntimeCoordinator.retainResource(resource);
}

export function canRetainExportResource(
  resource: RenderResourceDescriptor
): TimelineRuntimeAdmissionDecision {
  return timelineRuntimeCoordinator.canRetainResource(resource);
}

export function releaseExportResource(resourceId: string): void {
  timelineRuntimeCoordinator.releaseResource(resourceId);
}

export function createExportRunId(now = Date.now()): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getExportRunOwnerId(runId: string): string {
  return `export:run:${runId}`;
}

export function getRunResourceId(runId: string, suffix: string): string {
  return `export:${runId}:${suffix}`;
}

export function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function hasDefinedEntries(value: object): boolean {
  return Object.keys(value).length > 0;
}

export function getRunOwner(
  runId: string,
  clipId?: string,
  mediaFileId?: string
): RuntimeProviderDemand['owner'] {
  return removeUndefinedValues({
    ownerId: getExportRunOwnerId(runId),
    ownerType: 'export' as const,
    clipId,
    mediaFileId,
  });
}

export function createExportDemand(params: {
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
    policyId: EXPORT_POLICY_ID,
    leasePolicy: 'retain-until-release',
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

export function getMediaStatus(video: HTMLMediaElement): RuntimeHealthStatus {
  if (video.error) return 'warning';
  return video.readyState >= HTMLMediaElement.HAVE_METADATA ? 'ok' : 'unknown';
}

export function getSrcKind(
  src: string | undefined
): 'blob-url' | 'remote-url' | 'project-path' | 'unknown' {
  if (!src) return 'unknown';
  if (src.startsWith('blob:')) return 'blob-url';
  if (src.startsWith('http')) return 'remote-url';
  return 'project-path';
}
