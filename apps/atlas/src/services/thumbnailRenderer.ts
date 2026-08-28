// ThumbnailRendererService - Generates WebGPU-rendered thumbnails for nested compositions
// Shows all layers with effects, not just the first video

import { compositionRenderer } from './compositionRenderer';
import { Logger } from './logger';
import { buildThumbnailLayerFromClip } from './thumbnailRender/clipLayer';
import { renderThumbnailLayerData } from './thumbnailRender/compositeFrame';
import {
  DEFAULT_OPTIONS,
  type ThumbnailClip,
  type ThumbnailClipRenderInput,
  type ThumbnailOptions,
  type ThumbnailRenderTarget,
  type ThumbnailResources,
} from './thumbnailRender/contracts';
import { createBlackThumbnail } from './thumbnailRender/frameCapture';
import { collectThumbnailLayerData } from './thumbnailRender/layerSources';
import { ThumbnailRenderTargets } from './thumbnailRender/renderTargets';
import { createThumbnailResources, disposeThumbnailResources } from './thumbnailRender/resources';
import { getContentAwareSampleTimes, getSegmentSampleTimes } from './thumbnailRender/sampling';
import type { Layer } from '../types/layers';

const log = Logger.create('ThumbnailRenderer');

class ThumbnailRendererService {
  private resources: ThumbnailResources | null = null;
  private isInitialized = false;
  private initPromise: Promise<boolean> | null = null;
  private readonly renderTargets = new ThumbnailRenderTargets();

  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<boolean> {
    try {
      const resources = await createThumbnailResources();
      if (!resources) {
        return false;
      }

      this.resources = resources;
      this.isInitialized = true;
      log.info('ThumbnailRenderer initialized');
      return true;
    } catch (e) {
      log.error('Failed to initialize ThumbnailRenderer', e);
      this.initPromise = null;
      return false;
    }
  }

  async generateCompositionThumbnails(
    compositionId: string,
    duration: number,
    options?: ThumbnailOptions
  ): Promise<string[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const { count, width, height, boundaries } = opts;

    if (!await this.initialize()) {
      log.warn('ThumbnailRenderer not available, returning empty thumbnails');
      return [];
    }

    log.info(`Preparing composition for thumbnails: ${compositionId}`);
    const prepared = await compositionRenderer.prepareComposition(compositionId);
    if (!prepared) {
      log.warn(`Failed to prepare composition ${compositionId}`);
      return [];
    }
    log.info(`Composition prepared: ${compositionId}`);

    const target = this.ensureRenderTarget(width, height);
    if (!target) {
      return [];
    }

    log.info(`Thumbnail generation - boundaries provided: ${boundaries?.length ?? 0}, duration: ${duration}`);
    if (boundaries && boundaries.length > 0) {
      log.info(`Using segment-based sampling with boundaries: ${boundaries.map(b => (b * 100).toFixed(1) + '%').join(', ')}`);
    }
    const sampleTimes = boundaries && boundaries.length > 0
      ? getSegmentSampleTimes(boundaries, duration, count)
      : getContentAwareSampleTimes(compositionId, duration, count);

    const thumbnails: string[] = [];

    for (const time of sampleTimes) {
      const clampedTime = Math.min(time, duration - 0.01);

      try {
        const dataUrl = await this.renderFrameAt(compositionId, clampedTime, width, height, target);
        if (dataUrl) {
          thumbnails.push(dataUrl);
        }
      } catch (e) {
        log.warn(`Failed to render thumbnail at ${clampedTime}s`, e);
      }

      await new Promise(resolve => setTimeout(resolve, 0));
    }

    log.debug(`Generated ${thumbnails.length} thumbnails for composition ${compositionId}`);
    return thumbnails;
  }

  /**
   * Generate thumbnails for a single clip with its effects applied.
   * This renders the clip through WebGPU so effects are visible in thumbnails.
   */
  async generateClipThumbnails(
    clip: ThumbnailClip,
    options?: ThumbnailOptions
  ): Promise<string[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const { count, width, height } = opts;

    if (!clip.source) {
      log.warn('No source for clip thumbnail generation');
      return [];
    }

    if (!await this.initialize()) {
      log.warn('ThumbnailRenderer not available');
      return [];
    }

    const target = this.ensureRenderTarget(width, height);
    if (!target) {
      return [];
    }

    const clipDuration = (clip.outPoint - clip.inPoint) || clip.source.naturalDuration || 5;
    const thumbnails: string[] = [];

    log.info(`Generating ${count} thumbnails for clip ${clip.name} with effects`);

    for (let i = 0; i < count; i++) {
      const progress = count > 1 ? i / (count - 1) : 0;
      const clipTime = clip.inPoint + progress * clipDuration;

      try {
        const dataUrl = await this.renderClipFrameAt(clip, clipTime, width, height, target);
        if (dataUrl) {
          thumbnails.push(dataUrl);
        }
      } catch (e) {
        log.warn(`Failed to render clip thumbnail at ${clipTime.toFixed(2)}s`, e);
      }

      await new Promise(resolve => setTimeout(resolve, 0));
    }

    log.debug(`Generated ${thumbnails.length} thumbnails for clip ${clip.name}`);
    return thumbnails;
  }

  private ensureRenderTarget(width: number, height: number): ThumbnailRenderTarget | null {
    if (!this.resources) return null;
    return this.renderTargets.ensure(this.resources, width, height);
  }

  private async renderFrameAt(
    compositionId: string,
    time: number,
    width: number,
    height: number,
    target: ThumbnailRenderTarget
  ): Promise<string | null> {
    if (!this.resources) {
      return null;
    }

    const layers = compositionRenderer.evaluateAtTime(compositionId, time);
    log.debug(`evaluateAtTime result for ${compositionId} at ${time.toFixed(2)}s: ${layers.length} layers`);

    if (layers.length === 0) {
      log.debug(`No layers at time ${time.toFixed(2)}s - returning black thumbnail`);
      return createBlackThumbnail(width, height);
    }

    await this.seekAndWaitForLayers(layers, time);

    const layerData = collectThumbnailLayerData(this.resources, layers);
    if (layerData.length === 0) {
      return createBlackThumbnail(width, height);
    }

    return renderThumbnailLayerData(
      this.resources,
      target,
      layerData,
      width,
      height,
      {
        uniformId: layer => `thumb-${layer.id}`,
        maskLookupId: layer => layer.maskClipId || layer.id,
        conversionErrorMessage: 'Failed to convert thumbnail to data URL',
      }
    );
  }

  /**
   * Render a single clip frame with effects applied.
   */
  private async renderClipFrameAt(
    clip: ThumbnailClipRenderInput,
    time: number,
    width: number,
    height: number,
    target: ThumbnailRenderTarget
  ): Promise<string | null> {
    if (!this.resources || !clip.source) {
      return null;
    }

    const layer = buildThumbnailLayerFromClip(clip);
    if (!layer) {
      return null;
    }

    if (clip.source.videoElement) {
      await this.seekVideoAndWait(clip.source.videoElement, time);
    }

    const layerData = collectThumbnailLayerData(this.resources, [layer]);
    if (layerData.length === 0) {
      return createBlackThumbnail(width, height);
    }

    return renderThumbnailLayerData(
      this.resources,
      target,
      layerData,
      width,
      height,
      {
        uniformId: dataLayer => `clip-thumb-${dataLayer.id}`,
        maskLookupId: dataLayer => dataLayer.id,
        conversionErrorMessage: 'Failed to convert clip thumbnail to data URL',
      }
    );
  }

  private async seekAndWaitForLayers(layers: Layer[], time: number): Promise<void> {
    const seekPromises: Promise<void>[] = [];

    for (const layer of layers) {
      if (layer.source?.videoElement) {
        const video = layer.source.videoElement;
        seekPromises.push(this.seekVideoAndWait(video, time));
      }
    }

    await Promise.all(seekPromises);
  }

  private seekVideoAndWait(video: HTMLVideoElement, time: number): Promise<void> {
    return new Promise((resolve) => {
      if (Math.abs(video.currentTime - time) < 0.05 && video.readyState >= 2) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        resolve();
      }, 1000);

      const onSeeked = () => {
        clearTimeout(timeout);
        video.removeEventListener('seeked', onSeeked);
        requestAnimationFrame(() => resolve());
      };

      video.addEventListener('seeked', onSeeked);
      video.currentTime = time;
    });
  }

  dispose(): void {
    this.renderTargets.dispose();

    if (this.resources) {
      disposeThumbnailResources(this.resources);
      this.resources = null;
    }

    this.isInitialized = false;
    this.initPromise = null;
    log.debug('ThumbnailRenderer disposed');
  }
}

// Singleton instance
export const thumbnailRenderer = new ThumbnailRendererService();
