import type {
  RenderResourceDescriptor,
  TimelineRuntimeAdmissionDecision,
} from '../runtimeCoordinatorTypes';
import { createRenderResourceDescriptorFromDemand } from '../runtimeProviderDemandBridge';
import {
  canRetainExportResource,
  createExportDemand,
  getRunOwner,
  getRunResourceId,
  releaseExportResource,
  removeUndefinedValues,
  retainExportResource,
} from './core';
import type { ExportClipElementAdmissionReport } from './types';

function getClipElementMediaFileId(report: ExportClipElementAdmissionReport): string | undefined {
  return report.mediaFileId ?? report.clip.mediaFileId;
}

function createExportPreciseVideoElementResource(
  report: ExportClipElementAdmissionReport
): RenderResourceDescriptor {
  const mediaFileId = getClipElementMediaFileId(report);
  const resourceId = getRunResourceId(report.runId, `clip:${report.clip.id}:html-media:video`);
  return createRenderResourceDescriptorFromDemand(createExportDemand({
    id: resourceId,
    resourceKind: 'html-media',
    owner: getRunOwner(report.runId, report.clip.id, mediaFileId),
    source: removeUndefinedValues({
      mediaFileId,
      clipId: report.clip.id,
      trackId: report.clip.trackId,
      previewPath: report.previewPath,
    }),
    dimensions: removeUndefinedValues({
      durationSeconds: report.clip.duration,
    }),
    tags: ['export', 'clip-state', 'html-video'],
  }), {
    resourceKind: 'html-media',
    mediaElementKind: 'video',
    elementId: getRunResourceId(report.runId, `clip:${report.clip.id}:video`),
    srcKind: report.srcKind ?? 'unknown',
    label: report.dedicated === false
      ? 'Export shared precise video element'
      : 'Export dedicated precise video element',
  });
}

export function canRetainExportPreciseVideoElement(
  report: ExportClipElementAdmissionReport
): TimelineRuntimeAdmissionDecision {
  return canRetainExportResource(createExportPreciseVideoElementResource(report));
}

export function reserveExportPreciseVideoElement(
  report: ExportClipElementAdmissionReport
): TimelineRuntimeAdmissionDecision {
  const resource = createExportPreciseVideoElementResource(report);
  const decision = canRetainExportResource(resource);
  if (decision.admitted) {
    retainExportResource(resource);
  }
  return decision;
}

export function releaseReservedExportPreciseVideoElement(
  report: ExportClipElementAdmissionReport
): void {
  releaseExportResource(getRunResourceId(report.runId, `clip:${report.clip.id}:html-media:video`));
}

function createExportImageElementResource(
  report: ExportClipElementAdmissionReport
): RenderResourceDescriptor {
  const mediaFileId = getClipElementMediaFileId(report);
  const resourceId = getRunResourceId(report.runId, `clip:${report.clip.id}:image:html-image`);
  return createRenderResourceDescriptorFromDemand(createExportDemand({
    id: resourceId,
    resourceKind: 'image-canvas',
    owner: getRunOwner(report.runId, report.clip.id, mediaFileId),
    source: removeUndefinedValues({
      mediaFileId,
      clipId: report.clip.id,
      trackId: report.clip.trackId,
      previewPath: report.previewPath,
    }),
    dimensions: removeUndefinedValues({
      durationSeconds: report.clip.duration,
    }),
    tags: ['export', 'clip-state', 'html-image', report.srcKind ?? 'unknown'],
  }), {
    resourceKind: 'image-canvas',
    imageKind: 'html-image',
    imageId: getRunResourceId(report.runId, `clip:${report.clip.id}:image`),
    label: report.dedicated === false ? 'Export shared image element' : 'Export dedicated image element',
  });
}

export function canRetainExportImageElement(
  report: ExportClipElementAdmissionReport
): TimelineRuntimeAdmissionDecision {
  return canRetainExportResource(createExportImageElementResource(report));
}

export function reserveExportImageElement(
  report: ExportClipElementAdmissionReport
): TimelineRuntimeAdmissionDecision {
  const resource = createExportImageElementResource(report);
  const decision = canRetainExportResource(resource);
  if (decision.admitted) {
    retainExportResource(resource);
  }
  return decision;
}

export function releaseReservedExportImageElement(
  report: ExportClipElementAdmissionReport
): void {
  releaseExportResource(getRunResourceId(report.runId, `clip:${report.clip.id}:image:html-image`));
}
