import type { Layer, LayerRenderData } from '../../core/types';
import { Logger } from '../../../services/logger';
import { vfPipelineMonitor } from '../../../services/vfPipelineMonitor';
import { useTimelineStore } from '../../../stores/timeline';
import type { LayerCollectorDeps } from '../LayerCollector';
import { HTML_HOLD_RECOVERY_MS } from './constants';
import { getLayerReuseKey } from './collectionPredicates';
import type { LayerCollectorMutationSink } from './collectorStatus';
import { collectNotReadyHtmlVideo } from './htmlVideoNotReadyCollector';
import { collectReadyHtmlVideo } from './htmlVideoReadyCollector';

const log = Logger.create('LayerCollector');

export interface HtmlVideoCollectOptions {
  playbackFallback?: boolean;
}

export interface HtmlVideoCollectRequest {
  layer: Layer;
  video: HTMLVideoElement;
  deps: LayerCollectorDeps;
  options: HtmlVideoCollectOptions;
  videoKey: string;
  layerReuseKey: string;
  controller: HtmlVideoCollectorController;
}

export interface HtmlVideoHoldOptions {
  hasHoldFrame: boolean;
  isDragging: boolean;
  isSettling: boolean;
  awaitingPausedTargetFrame: boolean;
  hasFreshPresentedFrame: boolean;
}

export interface HtmlVideoCollectorController extends LayerCollectorMutationSink {
  armHtmlHold(layerId: string): void;
  clearHtmlHold(layerId: string): void;
  shouldPreferHtmlHold(layerId: string, options: HtmlVideoHoldOptions): boolean;
  traceScrubPath(
    layer: Layer,
    path: string,
    video: HTMLVideoElement,
    targetTime: number,
    lastPresentedTime?: number
  ): void;
  isVideoGpuReady(video: HTMLVideoElement): boolean;
  markVideoGpuReady(video: HTMLVideoElement): void;
}

export class HtmlVideoCollector implements HtmlVideoCollectorController {
  private videoIds = new WeakMap<HTMLVideoElement, number>();
  private nextVideoId = 1;
  private lastScrubTrace = new Map<string, string>();
  private htmlHoldUntil = new Map<string, number>();
  private videoGpuReady = new WeakSet<HTMLVideoElement>();
  private readonly status: LayerCollectorMutationSink;

  constructor(status: LayerCollectorMutationSink) {
    this.status = status;
  }

  collect(
    layer: Layer,
    video: HTMLVideoElement,
    deps: LayerCollectorDeps,
    options: HtmlVideoCollectOptions = {}
  ): LayerRenderData | null {
    const videoKey = `video:${this.getVideoObjectId(video)}`;
    const layerReuseKey = getLayerReuseKey(layer);

    log.debug(`tryHTMLVideo: readyState=${video.readyState}, seeking=${video.seeking}, videoWidth=${video.videoWidth}, videoHeight=${video.videoHeight}`);

    const request: HtmlVideoCollectRequest = {
      layer,
      video,
      deps,
      options,
      videoKey,
      layerReuseKey,
      controller: this,
    };
    return video.readyState >= 2
      ? collectReadyHtmlVideo(request)
      : collectNotReadyHtmlVideo(request);
  }

  setDecoder(decoder: Parameters<LayerCollectorMutationSink['setDecoder']>[0]): void {
    this.status.setDecoder(decoder);
  }

  setWebCodecsInfo(info: Parameters<LayerCollectorMutationSink['setWebCodecsInfo']>[0]): void {
    this.status.setWebCodecsInfo(info);
  }

  markHasVideo(): void {
    this.status.markHasVideo();
  }

  armHtmlHold(layerId: string): void {
    this.htmlHoldUntil.set(
      layerId,
      performance.now() + HTML_HOLD_RECOVERY_MS
    );
  }

  clearHtmlHold(layerId: string): void {
    this.htmlHoldUntil.delete(layerId);
  }

  shouldPreferHtmlHold(layerId: string, options: HtmlVideoHoldOptions): boolean {
    if (!options.hasHoldFrame) {
      this.clearHtmlHold(layerId);
      return false;
    }

    if (
      !options.isDragging &&
      !options.isSettling &&
      !options.awaitingPausedTargetFrame &&
      options.hasFreshPresentedFrame
    ) {
      this.clearHtmlHold(layerId);
      return false;
    }

    return (this.htmlHoldUntil.get(layerId) ?? 0) > performance.now();
  }

  traceScrubPath(
    layer: Layer,
    path: string,
    video: HTMLVideoElement,
    targetTime: number,
    lastPresentedTime?: number
  ): void {
    if (!useTimelineStore.getState().isDraggingPlayhead) {
      return;
    }
    const traceKey = getLayerReuseKey(layer);
    const signature = [
      path,
      Math.round(targetTime * 1000),
      Math.round(video.currentTime * 1000),
      Math.round((lastPresentedTime ?? -1) * 1000),
      video.seeking ? '1' : '0',
    ].join(':');
    if (this.lastScrubTrace.get(traceKey) === signature) {
      return;
    }
    this.lastScrubTrace.set(traceKey, signature);
    vfPipelineMonitor.record('vf_scrub_path', {
      clipId: layer.sourceClipId ?? layer.id,
      path,
      targetTimeMs: Math.round(targetTime * 1000),
      currentTimeMs: Math.round(video.currentTime * 1000),
      presentedTimeMs: Math.round((lastPresentedTime ?? -1) * 1000),
      seeking: video.seeking ? 'true' : 'false',
      readyState: video.readyState,
    });
  }

  isVideoGpuReady(video: HTMLVideoElement): boolean {
    return this.videoGpuReady.has(video);
  }

  markVideoGpuReady(video: HTMLVideoElement): void {
    this.videoGpuReady.add(video);
  }

  resetVideoGpuReady(video: HTMLVideoElement): void {
    this.videoGpuReady.delete(video);
  }

  private getVideoObjectId(video: HTMLVideoElement): number {
    const existing = this.videoIds.get(video);
    if (existing !== undefined) {
      return existing;
    }
    const next = this.nextVideoId++;
    this.videoIds.set(video, next);
    return next;
  }
}
