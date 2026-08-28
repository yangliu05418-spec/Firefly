import type { ClipAudioStemLayer } from '../../types';
import { StemAudioSourceResolver } from '../audio/stemSeparation';
import { createCurrentAudioArtifactStore } from '../audio/timelineWaveformPyramidCache';
import { Logger } from '../logger';
import {
  createStemLayerBufferResource,
  getStemLayerBufferResourceId,
} from './audioTrackRuntimeResources';
import { AudioTrackRuntimeElementManager } from './audioTrackRuntimeElements';
import {
  STEM_LAYER_BUFFER_CACHE_MAX_BYTES,
  STEM_LAYER_BUFFER_CACHE_MAX_ENTRIES,
  createStemBufferCacheKey,
  estimateAudioBufferBytes,
} from './audioTrackStemSyncModel';

const log = Logger.create('CutTransition');

export class AudioTrackStemLayerBufferCache {
  private stemLayerBufferCache = new Map<string, AudioBuffer>();
  private stemLayerBufferLoading = new Map<string, Promise<AudioBuffer | null>>();
  private stemLayerBufferGeneration = 0;
  private runtimeElements: AudioTrackRuntimeElementManager;

  constructor(runtimeElements: AudioTrackRuntimeElementManager) {
    this.runtimeElements = runtimeElements;
  }

  hasRuntime(): boolean {
    return this.stemLayerBufferCache.size > 0 || this.stemLayerBufferLoading.size > 0;
  }

  has(key: string): boolean {
    return this.stemLayerBufferCache.has(key);
  }

  getCached(layer: ClipAudioStemLayer): AudioBuffer | null {
    const key = createStemBufferCacheKey(layer);
    const cached = this.stemLayerBufferCache.get(key) ?? null;
    if (cached) {
      this.touchStemLayerBufferCacheEntry(key, cached);
    }
    return cached;
  }

  async ensure(layer: ClipAudioStemLayer): Promise<AudioBuffer | null> {
    const key = createStemBufferCacheKey(layer);
    const cached = this.stemLayerBufferCache.get(key);
    if (cached) {
      this.touchStemLayerBufferCacheEntry(key, cached);
      return cached;
    }

    const loading = this.stemLayerBufferLoading.get(key);
    if (loading) {
      return loading;
    }

    const generation = this.stemLayerBufferGeneration;
    const promise = this.loadStemLayerBuffer(layer, key, generation);
    this.stemLayerBufferLoading.set(key, promise);
    void promise.finally(() => {
      if (this.stemLayerBufferLoading.get(key) === promise) {
        this.stemLayerBufferLoading.delete(key);
      }
    });
    return promise;
  }

  cacheStemLayerBuffer(layer: ClipAudioStemLayer, key: string, buffer: AudioBuffer): boolean {
    const resource = createStemLayerBufferResource(layer, key, buffer);
    const admission = this.runtimeElements.canRetainResource(resource);
    if (!admission.admitted) {
      log.debug('Skipped stem layer buffer cache retention due to runtime budget', {
        stemId: layer.id,
        policyId: admission.policyId,
        reason: admission.reason,
        rejectedUnits: admission.rejectedUnits,
      });
      return false;
    }

    this.touchStemLayerBufferCacheEntry(key, buffer);
    this.runtimeElements.retainResource(resource);
    this.enforceStemLayerBufferCacheLimit();
    return true;
  }

  clear(): void {
    if (!this.hasRuntime()) {
      return;
    }

    this.stemLayerBufferGeneration += 1;
    for (const key of this.stemLayerBufferCache.keys()) {
      this.releaseStemLayerBufferResource(key);
    }
    this.stemLayerBufferCache.clear();
    this.stemLayerBufferLoading.clear();
  }

  private async loadStemLayerBuffer(
    layer: ClipAudioStemLayer,
    key: string,
    generation: number,
  ): Promise<AudioBuffer | null> {
    try {
      const resolver = new StemAudioSourceResolver({
        artifactStore: createCurrentAudioArtifactStore(),
      });
      const buffer = await resolver.resolveStemLayerBuffer(layer);
      if (generation !== this.stemLayerBufferGeneration) {
        return null;
      }
      if (buffer) {
        this.cacheStemLayerBuffer(layer, key, buffer);
      }
      return buffer;
    } catch (error) {
      log.warn('Failed to decode stem mixer buffer', { stemId: layer.id, error });
      return null;
    }
  }

  private touchStemLayerBufferCacheEntry(key: string, buffer: AudioBuffer): void {
    this.stemLayerBufferCache.delete(key);
    this.stemLayerBufferCache.set(key, buffer);
  }

  private releaseStemLayerBufferResource(key: string): void {
    this.runtimeElements.releaseResource(getStemLayerBufferResourceId(key));
  }

  private enforceStemLayerBufferCacheLimit(): void {
    let totalBytes = 0;
    for (const buffer of this.stemLayerBufferCache.values()) {
      totalBytes += estimateAudioBufferBytes(buffer);
    }

    while (
      this.stemLayerBufferCache.size > 1 &&
      (
        this.stemLayerBufferCache.size > STEM_LAYER_BUFFER_CACHE_MAX_ENTRIES ||
        totalBytes > STEM_LAYER_BUFFER_CACHE_MAX_BYTES
      )
    ) {
      const oldest = this.stemLayerBufferCache.entries().next().value as [string, AudioBuffer] | undefined;
      if (!oldest) break;
      this.stemLayerBufferCache.delete(oldest[0]);
      this.releaseStemLayerBufferResource(oldest[0]);
      totalBytes -= estimateAudioBufferBytes(oldest[1]);
    }
  }
}
