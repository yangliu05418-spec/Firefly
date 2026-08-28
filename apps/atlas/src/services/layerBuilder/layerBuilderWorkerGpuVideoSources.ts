import type { MediaFile } from '../../stores/mediaStore/types';
import type { LayerSource } from '../../types/layers';
import type { TimelineClip } from '../../types/timeline';
import { renderHostPort } from '../render/renderHostPort';

interface WorkerGpuFileVideoSource {
  readonly file: File;
  readonly mediaFileId?: string;
  readonly width?: number;
  readonly height?: number;
}

export interface WorkerGpuLayerVideoSourceResolution {
  source: LayerSource;
  intrinsicSize?: {
    width?: number;
    height?: number;
  };
}

export function isWorkerGpuOnlyRenderHost(): boolean {
  return renderHostPort.getTelemetry().mode === 'worker-gpu-only';
}

function resolveWorkerGpuFileVideoSource(
  clip: TimelineClip,
  mediaFile?: Pick<MediaFile, 'id' | 'file' | 'width' | 'height'>,
): WorkerGpuFileVideoSource | null {
  const file = mediaFile?.file ?? clip.source?.file ?? clip.file;
  if (!file) return null;
  return {
    file,
    mediaFileId: mediaFile?.id ?? clip.mediaFileId ?? clip.source?.mediaFileId,
    width: mediaFile?.width,
    height: mediaFile?.height,
  };
}

export function resolveWorkerGpuLayerVideoSource(params: {
  readonly clip: TimelineClip;
  readonly targetTime: number;
  readonly mediaFile?: Pick<MediaFile, 'id' | 'file' | 'width' | 'height'>;
}): WorkerGpuLayerVideoSourceResolution | null {
  const workerGpuFileSource = resolveWorkerGpuFileVideoSource(params.clip, params.mediaFile);
  if (!workerGpuFileSource) return null;
  return {
    source: {
      type: 'video',
      file: workerGpuFileSource.file,
      mediaTime: params.targetTime,
      targetMediaTime: params.targetTime,
      mediaFileId: workerGpuFileSource.mediaFileId,
      runtimeSourceId: params.clip.source?.runtimeSourceId,
      runtimeSessionKey: params.clip.source?.runtimeSessionKey,
    },
    intrinsicSize: {
      width: workerGpuFileSource.width,
      height: workerGpuFileSource.height,
    },
  };
}

export function hasWorkerGpuLayerVideoSource(
  clip: TimelineClip,
  mediaFile?: Pick<MediaFile, 'id' | 'file' | 'width' | 'height'>,
): boolean {
  return !!resolveWorkerGpuFileVideoSource(clip, mediaFile);
}
