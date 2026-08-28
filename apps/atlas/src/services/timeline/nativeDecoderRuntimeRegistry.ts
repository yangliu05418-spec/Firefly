import type { TimelineClip } from '../../types';
import type { NativeDecoder } from '../nativeHelper/NativeDecoder';
import {
  reserveRuntimeProviderDemandResource,
  type RuntimeProviderDemandResourceReservation,
} from './runtimeProviderDemandBridge';
import type { RuntimeProviderDemand } from '../../timeline';

interface NativeDecoderRuntimeRecord {
  clipId: string;
  mediaFileId?: string;
  filePath: string;
  decoder: NativeDecoder;
  release: () => void;
}

const nativeDecoderRecords = new Map<string, NativeDecoderRuntimeRecord>();

function getNativeDecoderResourceId(clipId: string, filePath: string): string {
  return `native-decoder:${clipId}:${hashString(filePath)}`;
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function getContainerFromPath(filePath: string): string | undefined {
  const match = /\.([a-z0-9]+)$/i.exec(filePath);
  return match?.[1]?.toLowerCase();
}

function releaseRecord(record: NativeDecoderRuntimeRecord): void {
  record.release();
  void record.decoder.close().catch(() => undefined);
}

export function registerNativeDecoderForTimelineClip(params: {
  clipId: string;
  mediaFileId?: string;
  filePath: string;
  decoder: NativeDecoder;
}): boolean {
  releaseNativeDecoderForTimelineClip(params.clipId);

  const resourceId = getNativeDecoderResourceId(params.clipId, params.filePath);
  const demand: RuntimeProviderDemand = {
    id: resourceId,
    facetId: `${resourceId}:facet`,
    resourceKind: 'native-decoder',
    policyId: 'interactive',
    leasePolicy: 'lease-visible',
    owner: {
      ownerId: `native-decoder:${params.clipId}`,
      ownerType: 'clip',
      clipId: params.clipId,
      mediaFileId: params.mediaFileId,
    },
    source: {
      sourceId: params.mediaFileId ?? params.clipId,
      mediaFileId: params.mediaFileId,
      clipId: params.clipId,
      projectPath: params.filePath,
    },
    priority: 'visible',
    tags: ['native-decoder', 'timeline-video'],
  };

  const reservation: RuntimeProviderDemandResourceReservation =
    reserveRuntimeProviderDemandResource(demand, {
      resourceKind: 'native-decoder',
      decoderId: resourceId,
      container: getContainerFromPath(params.filePath),
      label: 'Timeline native decoder',
      diagnostics: {
        status: 'ok',
        provider: {
          providerId: resourceId,
          providerKind: 'native-decoder',
          status: 'ok',
        },
      },
    });

  if (!reservation.admitted) {
    return false;
  }

  nativeDecoderRecords.set(params.clipId, {
    clipId: params.clipId,
    mediaFileId: params.mediaFileId,
    filePath: params.filePath,
    decoder: params.decoder,
    release: reservation.release,
  });
  return true;
}

export function getNativeDecoderForTimelineClip(
  clip: Pick<TimelineClip, 'id'> | null | undefined,
): NativeDecoder | null {
  if (!clip) return null;
  return nativeDecoderRecords.get(clip.id)?.decoder ?? null;
}

export function hasNativeDecoderForTimelineClip(
  clip: Pick<TimelineClip, 'id'> | null | undefined,
): boolean {
  return !!getNativeDecoderForTimelineClip(clip);
}

export function releaseNativeDecoderForTimelineClip(clipId: string): void {
  const record = nativeDecoderRecords.get(clipId);
  if (!record) return;
  nativeDecoderRecords.delete(clipId);
  releaseRecord(record);
}

export function releaseAllNativeDecoderRuntimeRecords(): void {
  for (const record of nativeDecoderRecords.values()) {
    releaseRecord(record);
  }
  nativeDecoderRecords.clear();
}

export function getNativeDecoderRuntimeRecordCount(): number {
  return nativeDecoderRecords.size;
}
