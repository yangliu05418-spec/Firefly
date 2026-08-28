import type { ClipAudioStemLayer, TimelineClip } from '../../types';
import { StemAudioSourceResolver } from '../audio/stemSeparation';
import { createCurrentAudioArtifactStore } from '../audio/timelineWaveformPyramidCache';
import { audioRoutingManager } from '../audioRoutingManager';
import { Logger } from '../logger';
import { proxyFrameCache } from '../proxyFrameCache';
import { useMediaStore } from '../../stores/mediaStore';
import {
  createAudioElementFromBuffer,
  createAudioElementFromUrl,
  createAudioProxyInstance,
  hasUsableAudioProxy,
  pauseAudioElement,
} from './audioTrackElementUtils';
import { createStemAudioElementResource } from './audioTrackRuntimeResources';
import { AudioTrackRuntimeElementManager } from './audioTrackRuntimeElements';
import {
  createStemLayerSetKey,
  type StemAudioElementEntry,
  type StemAudioElementSet,
} from './audioTrackStemSyncModel';

const log = Logger.create('CutTransition');

type PauseInactiveStemPreviewElementsParams = { activeClipIds: Set<string>; knownClipIds: Set<string>; shouldDisposeInactive: boolean; onInactiveClip?: (clipId: string) => void };
type StemPreviewAdmission = ReturnType<AudioTrackRuntimeElementManager['canRetainResource']>;

export class AudioTrackStemPreviewElementManager {
  private stemAudioElements = new Map<string, StemAudioElementSet>();
  private runtimeElements: AudioTrackRuntimeElementManager;

  constructor(runtimeElements: AudioTrackRuntimeElementManager) { this.runtimeElements = runtimeElements; }

  hasRuntime(): boolean { return this.stemAudioElements.size > 0; }

  getStemAudioElementEntry(clipId: string, stemId: string): StemAudioElementEntry | undefined { return this.stemAudioElements.get(clipId)?.entries.get(stemId); }

  getStemAudioElements(clip: TimelineClip): Map<string, StemAudioElementEntry> | null {
    const key = createStemLayerSetKey(clip);
    const stemSeparation = clip.audioState?.stemSeparation;
    if (!key || !stemSeparation) {
      this.disposeStemAudioSet(clip.id);
      return null;
    }

    const existing = this.stemAudioElements.get(clip.id);
    if (existing?.key === key) {
      return existing.entries;
    }

    this.disposeStemAudioSet(clip.id);
    const entries = new Map<string, StemAudioElementEntry>();
    this.stemAudioElements.set(clip.id, { key, entries });
    for (const stem of stemSeparation.stems) {
      entries.set(stem.id, { key, element: null, loading: true });
      void this.loadStemAudioElement(clip.id, key, stem);
    }

    return entries;
  }

  async loadStemAudioElement(
    clipId: string,
    key: string,
    stem: ClipAudioStemLayer,
  ): Promise<void> {
    this.ensureStemAudioEntry(clipId, key, stem);

    try {
      const mediaFile = stem.mediaFileId
        ? useMediaStore.getState().files.find(file => file.id === stem.mediaFileId)
        : undefined;
      if (stem.mediaFileId && mediaFile && hasUsableAudioProxy(mediaFile)) {
        const element = await proxyFrameCache.getAudioProxy(stem.mediaFileId);
        const current = this.stemAudioElements.get(clipId);
        if (!current || current.key !== key) return;

        const src = element?.currentSrc || element?.src;
        if (element && src) {
          const resource = createStemAudioElementResource({ clipId, stem, key, src });
          const admission = this.runtimeElements.canRetainResource(resource);
          if (!admission.admitted) {
            this.setStemBudgetDenied(current, stem, key, clipId, admission, 'proxy');
            return;
          }

          const proxyInstance = createAudioProxyInstance(element);
          if (!proxyInstance) return;
          this.disposeStemAudioElementEntry(current.entries.get(stem.id));
          this.runtimeElements.retainElementResource(proxyInstance, resource);
          current.entries.set(stem.id, {
            key,
            element: proxyInstance,
            loading: false,
            resourceId: resource.id,
          });
          return;
        }
      }

      if (mediaFile?.url) {
        const current = this.stemAudioElements.get(clipId);
        if (!current || current.key !== key) return;

        const resource = createStemAudioElementResource({
          clipId,
          stem,
          key,
          src: mediaFile.url,
        });
        const admission = this.runtimeElements.canRetainResource(resource);
        if (!admission.admitted) {
          this.setStemBudgetDenied(current, stem, key, clipId, admission, 'URL');
          return;
        }

        this.disposeStemAudioElementEntry(current.entries.get(stem.id));
        const element = createAudioElementFromUrl(mediaFile.url);
        this.runtimeElements.retainElementResource(element, resource);
        current.entries.set(stem.id, {
          key,
          element,
          loading: false,
          resourceId: resource.id,
        });
        void element.load();
        return;
      }

      const resolver = new StemAudioSourceResolver({
        artifactStore: createCurrentAudioArtifactStore(),
      });
      const buffer = await resolver.resolveStemLayerBuffer(stem);
      if (!buffer) {
        const current = this.stemAudioElements.get(clipId);
        if (current?.key === key) {
          this.setStemAudioError(current, stem, key, `Missing stem artifact: ${stem.label}`);
        }
        return;
      }

      const current = this.stemAudioElements.get(clipId);
      if (!current || current.key !== key) {
        return;
      }
      const resource = createStemAudioElementResource({
        clipId,
        stem,
        key,
        src: 'blob:',
        buffer,
      });
      const admission = this.runtimeElements.canRetainResource(resource);
      if (!admission.admitted) {
        this.setStemBudgetDenied(current, stem, key, clipId, admission, 'buffer');
        return;
      }

      const { element, url } = createAudioElementFromBuffer(buffer);
      this.disposeStemAudioElementEntry(current.entries.get(stem.id));
      this.runtimeElements.retainElementResource(element, resource);
      current.entries.set(stem.id, {
        key,
        element,
        loading: false,
        url,
        resourceId: resource.id,
      });
      void element.load();
    } catch (error) {
      const current = this.stemAudioElements.get(clipId);
      if (current?.key === key) {
        this.setStemAudioError(current, stem, key, error instanceof Error ? error.message : String(error));
      }
      log.warn('Failed to prepare stem preview audio', { clipId, stemId: stem.id, error });
    }
  }

  pauseStemAudioElements(clipId: string): void {
    const set = this.stemAudioElements.get(clipId);
    if (!set) return;
    for (const entry of set.entries.values()) {
      pauseAudioElement(entry.element);
      if (entry.element) {
        audioRoutingManager.removeRoute(entry.element);
      }
    }
  }

  pauseAllStemAudioElements(): void {
    for (const set of this.stemAudioElements.values()) {
      for (const entry of set.entries.values()) {
        pauseAudioElement(entry.element);
      }
    }
  }

  pauseInactiveStemAudioElements(params: PauseInactiveStemPreviewElementsParams): void {
    const { activeClipIds, knownClipIds, shouldDisposeInactive, onInactiveClip } = params;
    for (const [clipId, set] of Array.from(this.stemAudioElements.entries())) {
      if (!knownClipIds.has(clipId)) {
        this.disposeStemAudioSet(clipId);
        onInactiveClip?.(clipId);
        continue;
      }
      if (!activeClipIds.has(clipId)) {
        if (shouldDisposeInactive) {
          this.disposeStemAudioSet(clipId);
        } else {
          for (const entry of set.entries.values()) {
            pauseAudioElement(entry.element);
          }
        }
        onInactiveClip?.(clipId);
      }
    }
  }

  disposeStemAudioSet(clipId: string): void {
    const set = this.stemAudioElements.get(clipId);
    if (!set) return;

    for (const entry of set.entries.values()) {
      this.disposeStemAudioElementEntry(entry);
    }
    this.stemAudioElements.delete(clipId);
  }

  disposeAllStemAudioSets(): void {
    for (const clipId of Array.from(this.stemAudioElements.keys())) {
      this.disposeStemAudioSet(clipId);
    }
  }

  private ensureStemAudioEntry(clipId: string, key: string, stem: ClipAudioStemLayer): void {
    let current = this.stemAudioElements.get(clipId);
    if (!current || current.key !== key) {
      current = {
        key,
        entries: new Map(),
      };
      this.stemAudioElements.set(clipId, current);
    }
    if (!current.entries.has(stem.id)) {
      current.entries.set(stem.id, { key, element: null, loading: true });
    }
  }

  private setStemBudgetDenied(
    current: StemAudioElementSet,
    stem: ClipAudioStemLayer,
    key: string,
    clipId: string,
    admission: StemPreviewAdmission,
    sourceKind: 'buffer' | 'proxy' | 'URL',
  ): void {
    log.debug(`Skipped stem ${sourceKind} preview audio due to runtime budget`, {
      clipId,
      stemId: stem.id,
      policyId: admission.policyId,
      reason: admission.reason,
      rejectedUnits: admission.rejectedUnits,
    });
    this.setStemAudioError(current, stem, key, `Stem preview audio budget denied: ${stem.label}`);
  }

  private setStemAudioError(
    current: StemAudioElementSet,
    stem: ClipAudioStemLayer,
    key: string,
    error: string,
  ): void {
    current.entries.set(stem.id, {
      key,
      element: null,
      loading: false,
      error,
    });
  }

  private disposeStemAudioElementEntry(entry: StemAudioElementEntry | undefined): void {
    if (!entry) return;

    pauseAudioElement(entry.element);
    if (entry.element) {
      this.runtimeElements.releaseElementResource(entry.element);
      audioRoutingManager.disposeRoute(entry.element);
      entry.element.removeAttribute('src');
      entry.element.load();
    } else if (entry.resourceId) {
      this.runtimeElements.releaseResource(entry.resourceId);
    }
    if (entry.url) {
      URL.revokeObjectURL(entry.url);
    }
  }
}
