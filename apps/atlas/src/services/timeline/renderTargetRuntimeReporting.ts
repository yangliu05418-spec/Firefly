import type { RenderTarget, RenderSource } from '../../types/renderTarget';
import { useMediaStore } from '../../stores/mediaStore';
import type { RuntimeProviderDemand } from '../../timeline';
import { createRenderResourceDescriptorFromDemand } from './runtimeProviderDemandBridge';
import { timelineRuntimeCoordinator } from './timelineRuntimeCoordinator';

function getRenderTargetResourceId(targetId: string): string {
  return `render-target:${targetId}:canvas`;
}

function getSourceCompositionId(source: RenderSource): string | undefined {
  switch (source.type) {
    case 'activeComp':
    case 'program':
      return useMediaStore.getState().activeCompositionId ?? undefined;
    case 'composition':
      return source.compositionId;
    case 'layer':
      return source.compositionId;
    case 'layer-index':
      return source.compositionId ?? useMediaStore.getState().activeCompositionId ?? undefined;
    case 'slot':
      return useMediaStore.getState().activeLayerSlots?.[source.slotIndex] ?? undefined;
    default:
      return undefined;
  }
}

function getSourceTags(source: RenderSource): string[] {
  const tags = [`source:${source.type}`];
  if (source.type === 'slot') {
    tags.push(`slot:${source.slotIndex}`);
  }
  if (source.type === 'layer-index') {
    tags.push(`layer-index:${source.layerIndex}`);
  }
  return tags;
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

export function reportRenderTargetResource(target: RenderTarget): void {
  if (!target.canvas || !target.context) {
    releaseRenderTargetResource(target.id);
    return;
  }

  const compositionId = getSourceCompositionId(target.source);
  const tags = [
    'render-target',
    `destination:${target.destinationType}`,
    target.enabled ? 'enabled' : 'disabled',
    ...getSourceTags(target.source),
  ];
  const width = target.canvas.width || target.canvas.clientWidth || undefined;
  const height = target.canvas.height || target.canvas.clientHeight || undefined;
  const resourceId = getRenderTargetResourceId(target.id);
  const demand: RuntimeProviderDemand = {
    id: resourceId,
    facetId: `${resourceId}:facet`,
    resourceKind: 'image-canvas',
    policyId: 'render-target',
    leasePolicy: 'retain-until-release',
    owner: removeUndefinedValues({
      ownerId: target.id,
      ownerType: 'render-target' as const,
      compositionId,
    }),
    source: removeUndefinedValues({
      sourceId: target.source.type,
      compositionId,
    }),
    dimensions: {
      width,
      height,
    },
    priority: target.enabled ? 'visible' : 'background',
    tags,
  };
  const resource = createRenderResourceDescriptorFromDemand(demand, {
    resourceKind: 'image-canvas',
    imageKind: 'html-canvas',
    imageId: target.id,
    memoryCost: width && height
      ? {
          gpuBytes: width * height * 4,
        }
      : undefined,
    diagnostics: {
      status: target.enabled ? 'ok' : 'warning',
      messages: target.enabled
        ? []
        : [
            {
              severity: 'info',
              code: 'render-target.disabled',
              message: 'Render target canvas is retained while the target is disabled.',
              policyId: 'render-target',
              ownerId: target.id,
              resourceId: getRenderTargetResourceId(target.id),
            },
          ],
    },
    label: target.name,
  });

  timelineRuntimeCoordinator.retainResource(resource);
}

export function releaseRenderTargetResource(targetId: string): void {
  timelineRuntimeCoordinator.clearResources({
    ownerId: targetId,
    policyId: 'render-target',
  });
}
