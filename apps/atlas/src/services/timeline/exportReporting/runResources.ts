import type {
  RenderResourceDescriptor,
  TimelineRuntimeAdmissionDecision,
} from '../runtimeCoordinatorTypes';
import { createRenderResourceDescriptorFromDemand } from '../runtimeProviderDemandBridge';
import {
  EXPORT_POLICY_ID,
  canRetainExportResource,
  createExportDemand,
  getRunOwner,
  getRunResourceId,
  retainExportResource,
} from './core';
import type { ExportOutputSurfaceReport, ExportRunReport } from './types';

function createExportRunJobResource(report: ExportRunReport): RenderResourceDescriptor {
  const resourceId = getRunResourceId(report.runId, 'job:render');
  return createRenderResourceDescriptorFromDemand(createExportDemand({
    id: resourceId,
    resourceKind: 'job',
    owner: getRunOwner(report.runId),
    dimensions: {
      width: report.settings.width,
      height: report.settings.stackedAlpha ? report.settings.height * 2 : report.settings.height,
      fps: report.settings.fps,
      durationSeconds: Math.max(0, report.settings.endTime - report.settings.startTime),
    },
    source: {
      previewPath: `${report.settings.startTime.toFixed(3)}-${report.settings.endTime.toFixed(3)}`,
    },
    tags: [
      'export',
      report.exportMode ?? report.settings.exportMode ?? 'unknown',
      report.requestedAudio ? 'audio-requested' : 'video-only',
      report.effectiveAudio ? 'audio-effective' : 'no-audio',
    ],
  }), {
    resourceKind: 'job',
    jobId: report.runId,
    jobKind: 'export-render',
    startedAtMs: report.startedAtMs,
    diagnostics: {
      status: 'ok',
      messages: [
        {
          severity: 'info',
          code: 'export.render-job',
          message: `Export ${report.exportMode ?? report.settings.exportMode ?? 'unknown'} render started.`,
          policyId: EXPORT_POLICY_ID,
        },
      ],
    },
    label: 'Export render job',
  });
}

export function canRetainExportRunJob(report: ExportRunReport): TimelineRuntimeAdmissionDecision {
  return canRetainExportResource(createExportRunJobResource(report));
}

export function reportExportRunJob(report: ExportRunReport): void {
  retainExportResource(createExportRunJobResource(report));
}

function createExportOutputSurfaceResource(
  report: ExportOutputSurfaceReport
): RenderResourceDescriptor {
  const height = report.stackedAlpha ? report.height * 2 : report.height;
  const resourceId = getRunResourceId(report.runId, 'output-surface');
  const demand = createExportDemand({
    id: resourceId,
    resourceKind: report.zeroCopy ? 'gpu-texture' : 'image-canvas',
    owner: getRunOwner(report.runId),
    dimensions: {
      width: report.width,
      height,
    },
    tags: ['export', report.zeroCopy ? 'zero-copy' : 'readback', 'output-surface'],
  });

  if (report.zeroCopy) {
    return createRenderResourceDescriptorFromDemand(demand, {
      resourceKind: 'gpu-texture',
      textureId: resourceId,
      textureKind: 'export-frame',
      format: 'rgba8unorm',
      memoryCost: {
        gpuBytes: report.width * height * 4,
      },
      label: 'Export zero-copy output surface',
    });
  }

  return createRenderResourceDescriptorFromDemand(demand, {
    resourceKind: 'image-canvas',
    imageKind: 'offscreen-canvas',
    imageId: resourceId,
    memoryCost: {
      heapBytes: report.width * height * 4,
    },
    label: 'Export readback output surface',
  });
}

export function canRetainExportOutputSurface(
  report: ExportOutputSurfaceReport
): TimelineRuntimeAdmissionDecision {
  return canRetainExportResource(createExportOutputSurfaceResource(report));
}

export function reportExportOutputSurface(report: ExportOutputSurfaceReport): void {
  retainExportResource(createExportOutputSurfaceResource(report));
}
