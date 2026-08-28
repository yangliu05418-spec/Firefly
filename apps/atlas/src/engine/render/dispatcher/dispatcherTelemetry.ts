import type { Layer, LayerRenderData } from '../../core/types';
import { vfPipelineMonitor } from '../../../services/vfPipelineMonitor';

export interface PreviewFrameFallback {
  clipId?: string;
  targetTimeMs?: number;
  displayedTimeMs?: number;
}

export type PreviewFrameRecorder = (
  mode: string,
  layerData?: LayerRenderData[],
  fallback?: PreviewFrameFallback,
) => void;

export class DispatcherTelemetry {
  private lastPreviewSignature = '';
  // Settable from outside (dispatcher accessors) so instrumentation/tests
  // can seed the hold/jump detection state.
  lastPreviewTargetTimeMs?: number;
  lastPreviewDisplayedTimeMs?: number;

  getLastPreviewDisplayedTimeMs(): number | undefined {
    return this.lastPreviewDisplayedTimeMs;
  }

  toMediaTimeMs(time?: number): number | undefined {
    if (typeof time !== 'number' || !Number.isFinite(time)) {
      return undefined;
    }
    return Math.round(time * 1000);
  }

  getPreviewFallbackFromLayers(
    layers: Layer[],
  ): { clipId?: string; targetTimeMs?: number } {
    const primary =
      layers.find((layer) => layer?.visible && layer.opacity !== 0 && layer.source?.type === 'video') ??
      layers.find((layer) => layer?.visible && layer.opacity !== 0 && !!layer.source);

    return {
      clipId: primary?.sourceClipId ?? primary?.id,
      targetTimeMs: this.toMediaTimeMs(primary?.source?.mediaTime),
    };
  }

  hasVisiblePreviewInputLayer(layers: Layer[]): boolean {
    return layers.some((layer) =>
      layer?.visible !== false &&
      layer.opacity !== 0 &&
      !!layer.source
    );
  }

  shouldHoldLastFrameOnEmptyPlayback(
    lastRenderHadContent: boolean,
    targetTimeMs?: number,
  ): boolean {
    if (!lastRenderHadContent) {
      return false;
    }

    if (
      typeof targetTimeMs === 'number' &&
      typeof this.lastPreviewTargetTimeMs === 'number' &&
      Math.abs(targetTimeMs - this.lastPreviewTargetTimeMs) >= 250
    ) {
      return false;
    }

    return true;
  }

  recordMainPreviewFrame(
    mode: string,
    layerData?: LayerRenderData[],
    fallback?: PreviewFrameFallback,
  ): void {
    const primary = layerData?.find((data) => data.layer.source?.type === 'video') ?? layerData?.[0];
    const clipId = fallback?.clipId ?? primary?.layer.sourceClipId ?? primary?.layer.id;
    const targetTimeMs =
      fallback?.targetTimeMs ??
      this.toMediaTimeMs(primary?.targetMediaTime);
    const displayedTimeMs =
      fallback?.displayedTimeMs ??
      this.toMediaTimeMs(primary?.displayedMediaTime ?? primary?.targetMediaTime);
    const previewPath =
      primary?.previewPath ??
      primary?.layer.source?.type ??
      mode;
    const signature = layerData && layerData.length > 0
      ? layerData
        .slice(0, 4)
        .map((data) => {
          const id = data.layer.sourceClipId ?? data.layer.id;
          const mediaTimeMs = this.toMediaTimeMs(data.displayedMediaTime ?? data.targetMediaTime) ?? -1;
          return `${id}:${data.previewPath ?? data.layer.source?.type ?? 'layer'}:${mediaTimeMs}`;
        })
        .join('|')
      : `${mode}:${clipId ?? 'none'}:${displayedTimeMs ?? -1}`;
    const changed = signature !== this.lastPreviewSignature;
    const targetMoved =
      targetTimeMs !== undefined &&
      this.lastPreviewTargetTimeMs !== undefined &&
      Math.abs(targetTimeMs - this.lastPreviewTargetTimeMs) >= 12;
    const driftMs =
      targetTimeMs !== undefined && displayedTimeMs !== undefined
        ? Math.abs(targetTimeMs - displayedTimeMs)
        : undefined;

    vfPipelineMonitor.record('vf_preview_frame', {
      mode,
      changed: changed ? 'true' : 'false',
      targetMoved: targetMoved ? 'true' : 'false',
      previewPath,
      ...(clipId ? { clipId } : {}),
      ...(targetTimeMs !== undefined ? { targetTimeMs } : {}),
      ...(displayedTimeMs !== undefined ? { displayedTimeMs } : {}),
      ...(driftMs !== undefined ? { driftMs } : {}),
    });

    this.lastPreviewSignature = signature;
    this.lastPreviewTargetTimeMs = targetTimeMs;
    this.lastPreviewDisplayedTimeMs = displayedTimeMs;
  }
}
