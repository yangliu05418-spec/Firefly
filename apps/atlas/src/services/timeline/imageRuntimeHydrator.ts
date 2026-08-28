import type {
  ImageCanvasResourceDescriptor,
  RenderResourceSourceDescriptor,
  RuntimeResourceOwnerDescriptor,
  TimelineRuntimeAdmissionDecision,
  TimelineRuntimePolicyId,
} from './runtimeCoordinatorTypes';
import type { RuntimeProviderDemand } from '../../timeline';
import { createRenderResourceDescriptorFromDemand } from './runtimeProviderDemandBridge';
import { timelineRuntimeCoordinator } from './timelineRuntimeCoordinator';

interface TimelineImageHydrationDescriptorResourceOptions {
  id: string;
  policyId: TimelineRuntimePolicyId;
  owner: RuntimeResourceOwnerDescriptor;
  source?: RenderResourceSourceDescriptor;
  imageId?: string;
  label?: string;
  tags?: readonly string[];
}

interface TimelineImageHydrationDemandResourceOptions {
  demand: RuntimeProviderDemand;
  imageId?: string;
  label?: string;
  tags?: readonly string[];
}

export type TimelineImageHydrationResourceOptions =
  | TimelineImageHydrationDescriptorResourceOptions
  | TimelineImageHydrationDemandResourceOptions;

export interface TimelineImageHydrationOptions {
  url: string;
  crossOrigin?: HTMLImageElement['crossOrigin'];
  isCurrent?: () => boolean;
  resource?: TimelineImageHydrationResourceOptions;
  onReady: (image: HTMLImageElement) => void;
  onError: (event: Event, image: HTMLImageElement) => void;
  onStale?: (image: HTMLImageElement) => void;
  onAdmissionDenied?: (decision: TimelineRuntimeAdmissionDecision) => void;
}

export interface TimelineImageHydrationHandle {
  image?: HTMLImageElement;
  admitted: boolean;
  admissionDecision?: TimelineRuntimeAdmissionDecision;
  cancel: () => void;
}

function detachImageSource(image: HTMLImageElement): void {
  image.removeAttribute('src');
  image.src = '';
}

function isDemandResourceOptions(
  resource: TimelineImageHydrationResourceOptions
): resource is TimelineImageHydrationDemandResourceOptions {
  return 'demand' in resource;
}

function createImageResourceDescriptor(
  options: TimelineImageHydrationOptions
): ImageCanvasResourceDescriptor | null {
  if (!options.resource) {
    return null;
  }

  if (isDemandResourceOptions(options.resource)) {
    const demand: RuntimeProviderDemand = {
      ...options.resource.demand,
      source: {
        ...(options.resource.demand.source ?? {}),
        previewPath: options.resource.demand.source?.previewPath ?? options.url,
      },
    };
    return createRenderResourceDescriptorFromDemand(demand, {
      resourceKind: 'image-canvas',
      diagnostics: {
        status: 'unknown',
      },
      imageKind: 'html-image',
      imageId: options.resource.imageId ?? `${demand.id}:image`,
      label: options.resource.label ?? 'Runtime image hydration',
      tags: options.resource.tags,
    }) as ImageCanvasResourceDescriptor;
  }

  return {
    id: options.resource.id,
    kind: 'image-canvas',
    policyId: options.resource.policyId,
    owner: options.resource.owner,
    source: {
      ...options.resource.source,
      previewPath: options.resource.source?.previewPath ?? options.url,
    },
    diagnostics: {
      status: 'unknown',
    },
    imageKind: 'html-image',
    imageId: options.resource.imageId ?? options.resource.id,
    label: options.resource.label ?? 'Runtime image hydration',
    tags: options.resource.tags ?? ['image-hydration'],
  };
}

export function startTimelineImageHydration(
  options: TimelineImageHydrationOptions
): TimelineImageHydrationHandle {
  const resource = createImageResourceDescriptor(options);
  const admissionDecision = resource
    ? timelineRuntimeCoordinator.canRetainResource(resource)
    : undefined;
  if (admissionDecision && !admissionDecision.admitted) {
    options.onAdmissionDenied?.(admissionDecision);
    return {
      admitted: false,
      admissionDecision,
      cancel: () => undefined,
    };
  }

  if (resource) {
    timelineRuntimeCoordinator.retainResource(resource);
  }

  const image = new Image();
  let cancelled = false;

  const releaseReservedResource = () => {
    if (resource) {
      timelineRuntimeCoordinator.releaseResource(resource.id);
    }
  };

  const cleanupListeners = () => {
    image.removeEventListener('load', onLoad);
    image.removeEventListener('error', onError);
  };

  const cancel = () => {
    if (cancelled) {
      return;
    }

    cancelled = true;
    cleanupListeners();
    detachImageSource(image);
    releaseReservedResource();
  };

  const onLoad = () => {
    if (cancelled) {
      return;
    }

    if (options.isCurrent && !options.isCurrent()) {
      cancelled = true;
      cleanupListeners();
      detachImageSource(image);
      releaseReservedResource();
      options.onStale?.(image);
      return;
    }

    cleanupListeners();
    options.onReady(image);
  };

  const onError = (event: Event) => {
    if (cancelled) {
      return;
    }

    cleanupListeners();
    detachImageSource(image);
    releaseReservedResource();
    options.onError(event, image);
  };

  image.crossOrigin = options.crossOrigin ?? 'anonymous';
  image.addEventListener('load', onLoad);
  image.addEventListener('error', onError);
  image.src = options.url;

  return { image, admitted: true, admissionDecision, cancel };
}
