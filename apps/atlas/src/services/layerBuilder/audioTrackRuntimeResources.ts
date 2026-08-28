import type { ClipAudioStemLayer } from '../../types';
import type { RuntimeProviderDemand } from '../../timeline';
import type { RenderResourceDescriptor } from '../timeline/runtimeCoordinatorTypes';
import { createRenderResourceDescriptorFromDemand } from '../timeline/runtimeProviderDemandBridge';
import {
  getAudioElementSrcKind,
  removeUndefinedValues,
} from './audioTrackElementUtils';
import {
  estimateAudioBufferBytes,
  hashString,
} from './audioTrackStemSyncModel';

export function getActiveAudioProxyResourceId(clipId: string, mediaFileId: string): string {
  return `audio-track-sync:active-audio-proxy:${clipId}:${hashString(mediaFileId)}`;
}

export function getStemAudioElementResourceId(clipId: string, stemId: string, key: string): string {
  return `audio-track-sync:stem-audio-element:${clipId}:${stemId}:${hashString(key)}`;
}

export function createActiveAudioProxyResource(params: {
  clipId: string;
  mediaFileId: string;
  src?: string;
}): RenderResourceDescriptor {
  const resourceId = getActiveAudioProxyResourceId(params.clipId, params.mediaFileId);
  const demand: RuntimeProviderDemand = {
    id: resourceId,
    facetId: `${resourceId}:facet`,
    resourceKind: 'html-media',
    policyId: 'interactive',
    leasePolicy: 'lease-visible',
    owner: {
      ownerId: `audio-track-sync:active-audio-proxy:${params.clipId}`,
      ownerType: 'clip',
      clipId: params.clipId,
      mediaFileId: params.mediaFileId,
    },
    source: {
      sourceId: params.mediaFileId,
      mediaFileId: params.mediaFileId,
    },
    priority: 'visible',
    tags: ['audio-track-sync', 'active-audio-proxy'],
  };
  return createRenderResourceDescriptorFromDemand(demand, {
    resourceKind: 'html-media',
    mediaElementKind: 'audio',
    elementId: resourceId,
    srcKind: getAudioElementSrcKind(params.src),
    diagnostics: {
      status: 'ok',
      provider: {
        providerId: resourceId,
        providerKind: 'html-audio',
        status: 'ok',
      },
    },
    label: 'Active audio proxy element',
  });
}

export function createStemAudioElementResource(params: {
  clipId: string;
  stem: ClipAudioStemLayer;
  key: string;
  src?: string;
  buffer?: AudioBuffer;
}): RenderResourceDescriptor {
  const resourceId = getStemAudioElementResourceId(params.clipId, params.stem.id, params.key);
  const demand: RuntimeProviderDemand = {
    id: resourceId,
    facetId: `${resourceId}:facet`,
    resourceKind: 'html-media',
    policyId: 'interactive',
    leasePolicy: 'lease-visible',
    owner: removeUndefinedValues({
      ownerId: `audio-track-sync:stem-audio-element:${params.clipId}`,
      ownerType: 'clip' as const,
      clipId: params.clipId,
      mediaFileId: params.stem.mediaFileId,
    }),
    source: removeUndefinedValues({
      sourceId: params.stem.id,
      mediaFileId: params.stem.mediaFileId,
      fileHash: params.stem.payloadRef.hash,
    }),
    priority: 'visible',
    tags: ['audio-track-sync', 'stem-audio-element'],
  };
  if (params.buffer) {
    demand.dimensions = {
      durationSeconds: params.buffer.duration,
      sampleRate: params.buffer.sampleRate,
      channelCount: params.buffer.numberOfChannels,
    };
  }
  return createRenderResourceDescriptorFromDemand(demand, {
    resourceKind: 'html-media',
    mediaElementKind: 'audio',
    elementId: resourceId,
    srcKind: getAudioElementSrcKind(params.src),
    diagnostics: {
      status: 'ok',
      provider: {
        providerId: resourceId,
        providerKind: 'html-audio',
        status: 'ok',
      },
    },
    label: 'Stem preview audio element',
  });
}

export function getStemLayerBufferResourceId(key: string): string {
  return `audio-track-sync:stem-layer-buffer:${hashString(key)}`;
}

export function createStemLayerBufferResource(
  layer: ClipAudioStemLayer,
  key: string,
  buffer: AudioBuffer,
): RenderResourceDescriptor {
  const resourceId = getStemLayerBufferResourceId(key);
  const demand: RuntimeProviderDemand = {
    id: resourceId,
    facetId: `${resourceId}:facet`,
    resourceKind: 'audio-source-clock',
    policyId: 'interactive',
    leasePolicy: 'lease-visible',
    owner: removeUndefinedValues({
      ownerId: 'audio-track-sync:stem-layer-buffer-cache',
      ownerType: 'timeline' as const,
      mediaFileId: layer.mediaFileId,
    }),
    source: removeUndefinedValues({
      sourceId: layer.id,
      mediaFileId: layer.mediaFileId,
      fileHash: layer.payloadRef.hash,
    }),
    dimensions: {
      durationSeconds: buffer.duration,
      sampleRate: buffer.sampleRate,
      channelCount: buffer.numberOfChannels,
    },
    priority: 'background',
    tags: ['audio-track-sync', 'stem-layer-buffer', 'stem-mixer'],
  };
  return createRenderResourceDescriptorFromDemand(demand, {
    resourceKind: 'audio-source-clock',
    memoryCost: {
      heapBytes: estimateAudioBufferBytes(buffer),
    },
    audioSourceId: `stem-layer:${hashString(key)}`,
    clockId: resourceId,
    label: 'Stem layer mixer buffer',
  });
}
