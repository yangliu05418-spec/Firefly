import { useMediaStore } from '../../../stores/mediaStore';
import type { ClipAudioStemState } from '../../../types/audio';
import type { ClipStemSeparationRunnerRequest } from '../../../stores/timeline/types';
import { AudioArtifactStore } from '../AudioArtifactStore';
import { Logger } from '../../logger';
import { prepareClipAudioAnalysisInput } from '../ClipAudioAnalysisOrchestrator';
import { createCurrentAudioArtifactStore } from '../timelineWaveformPyramidCache';
import {
  DEFAULT_STEM_MODEL_ID,
  requireStemModel,
} from './modelCatalog';
import { getStemModelManager } from './StemModelManager';
import { StemSeparationWorkerClient, type StemSeparationWorkerClientLike } from './StemSeparationWorkerClient';
import type {
  StemModelCacheStatus,
  StemModelCatalogEntry,
  StemModelFileBuffer,
  StemSeparationWorkerStemResult,
} from './types';
import { storeStemSeparationResults, type StemMediaLibraryStore } from './stemSeparationArtifacts';
import {
  createStemSeparationState,
  createStemSeparationWorkerInput,
  getModelOrderedStemResults,
  getPrimaryStemModelUrl,
  type StemModelLoadSource,
} from './stemSeparationJob';
import {
  DOWNLOAD_PROGRESS_END,
  DOWNLOAD_PROGRESS_START,
  LOAD_PROGRESS_END,
  SEPARATION_PROGRESS_END,
  SOURCE_PREPARATION_PROGRESS,
  STORING_PROGRESS,
  getStemSeparationErrorMessage,
  mapStemSeparationProgress,
  throwIfStemSeparationAborted,
} from './stemSeparationProgress';

const log = Logger.create('StemSeparationService');

interface StemModelManagerLike {
  getCacheStatus?: (modelId?: string) => Promise<StemModelCacheStatus>;
  ensureModelCached?: (
    modelId?: string,
    options?: {
      signal?: AbortSignal;
      onProgress?: (progress: {
        progress: number;
        fileName: string;
        downloadedBytes: number;
        totalFileBytes: number;
        overallDownloadedBytes: number;
        overallTotalBytes: number;
      }) => void;
    },
  ) => Promise<StemModelCacheStatus>;
  loadModelBuffers: (modelId?: string) => Promise<StemModelFileBuffer[]>;
  clearModelCache?: (modelId?: string) => Promise<void>;
}

export interface StemSeparationServiceOptions {
  modelManager?: StemModelManagerLike;
  artifactStore?: AudioArtifactStore;
  createArtifactStore?: () => AudioArtifactStore;
  workerClient?: StemSeparationWorkerClientLike;
  createWorkerClient?: () => StemSeparationWorkerClientLike;
  prepareInput?: typeof prepareClipAudioAnalysisInput;
  getMediaLibraryStore?: () => StemMediaLibraryStore;
  publishStemFilesToMediaLibrary?: boolean;
  now?: () => number;
}

export class StemSeparationService {
  private readonly modelManager: StemModelManagerLike;
  private readonly artifactStore: AudioArtifactStore | null;
  private readonly createArtifactStore: () => AudioArtifactStore;
  private readonly createWorkerClient: () => StemSeparationWorkerClientLike;
  private readonly prepareInput: typeof prepareClipAudioAnalysisInput;
  private readonly getMediaLibraryStore: () => StemMediaLibraryStore;
  private readonly publishStemFilesToMediaLibrary: boolean;
  private readonly now: () => number;
  private workerClient: StemSeparationWorkerClientLike | null;

  constructor(options: StemSeparationServiceOptions = {}) {
    this.modelManager = options.modelManager ?? getStemModelManager();
    this.artifactStore = options.artifactStore ?? null;
    this.createArtifactStore = options.createArtifactStore ?? createCurrentAudioArtifactStore;
    this.workerClient = options.workerClient ?? null;
    this.createWorkerClient = options.createWorkerClient ?? (() => new StemSeparationWorkerClient());
    this.prepareInput = options.prepareInput ?? prepareClipAudioAnalysisInput;
    this.getMediaLibraryStore = options.getMediaLibraryStore ?? (() => useMediaStore.getState() as StemMediaLibraryStore);
    this.publishStemFilesToMediaLibrary = options.publishStemFilesToMediaLibrary ?? true;
    this.now = options.now ?? Date.now;
  }

  async separateClip(request: ClipStemSeparationRunnerRequest): Promise<ClipAudioStemState | null> {
    if (request.options.range) {
      throw new Error('Region-only stem separation is not supported yet.');
    }

    const model = requireStemModel(request.options.modelId ?? DEFAULT_STEM_MODEL_ID);
    request.updateProgress({
      phase: 'preparing',
      progress: 0,
      message: 'Preparing stem separation.',
    });

    const modelSource = await this.prepareModelSource(model, request);
    const loadResult = await this.loadWorkerModelWithRecovery(model, modelSource, request);
    request.updateProgress({
      phase: 'loading-model',
      backend: loadResult.backend,
      progress: LOAD_PROGRESS_END,
      message: `Stem model loaded with ${loadResult.backend.toUpperCase()}.`,
    });

    request.updateProgress({
      phase: 'preparing',
      backend: loadResult.backend,
      progress: LOAD_PROGRESS_END,
      message: 'Preparing source audio for stem separation.',
    });

    const prepared = await this.prepareInput({
      clip: request.clip,
      needsProcessed: false,
      signal: request.signal,
    });
    throwIfStemSeparationAborted(request.signal);
    if (!prepared) {
      throw new Error('Clip has no source audio available for stem separation.');
    }

    request.updateProgress({
      phase: 'preparing',
      backend: loadResult.backend,
      progress: Math.max(LOAD_PROGRESS_END, SOURCE_PREPARATION_PROGRESS),
      message: 'Source audio ready for stem separation.',
    });

    const workerInput = createStemSeparationWorkerInput(prepared, model.id);
    const worker = this.getWorkerClient();
    let stems: StemSeparationWorkerStemResult[];
    try {
      stems = await worker.separate(request.jobId, workerInput, {
        signal: request.signal,
        onProgress: (progress) => {
          request.updateProgress({
            phase: 'separating',
            progress: mapStemSeparationProgress(progress.progress, LOAD_PROGRESS_END, SEPARATION_PROGRESS_END),
            message: progress.message,
          });
        },
      });
    } finally {
      this.disposeWorkerClient();
    }
    throwIfStemSeparationAborted(request.signal);

    request.updateProgress({
      phase: 'storing',
      progress: STORING_PROGRESS,
      message: 'Storing separated stems.',
    });

    const orderedStems = getModelOrderedStemResults(model, stems);
    const storedLayers = await storeStemSeparationResults({
      request,
      model,
      prepared,
      stems: orderedStems,
      artifactStore: this.getArtifactStore(),
      getMediaLibraryStore: this.getMediaLibraryStore,
      publishStemFilesToMediaLibrary: this.publishStemFilesToMediaLibrary,
      now: this.now,
    });

    if (storedLayers.length === 0) {
      return null;
    }

    return createStemSeparationState({
      request,
      model,
      prepared,
      storedLayers,
      createdAt: this.now(),
    });
  }

  dispose(): void {
    this.disposeWorkerClient();
  }

  private getWorkerClient(): StemSeparationWorkerClientLike {
    this.workerClient ??= this.createWorkerClient();
    return this.workerClient;
  }

  private disposeWorkerClient(): void {
    this.workerClient?.dispose();
    this.workerClient = null;
  }

  private getArtifactStore(): AudioArtifactStore {
    return this.artifactStore ?? this.createArtifactStore();
  }

  private async prepareModelSource(
    model: StemModelCatalogEntry,
    request: ClipStemSeparationRunnerRequest,
  ): Promise<StemModelLoadSource> {
    request.updateProgress({
      phase: 'downloading-model',
      progress: DOWNLOAD_PROGRESS_START,
      message: `Checking ${model.label} cache.`,
    });

    let cached = !this.modelManager.getCacheStatus;
    if (this.modelManager.getCacheStatus) {
      try {
        cached = (await this.modelManager.getCacheStatus(model.id)).cached;
      } catch (error) {
        log.warn('Stem model cache status could not be read; loading model directly in the worker', {
          modelId: model.id,
          error: getStemSeparationErrorMessage(error),
        });
      }
    }

    throwIfStemSeparationAborted(request.signal);
    if (cached) {
      request.updateProgress({
        phase: 'loading-model',
        progress: DOWNLOAD_PROGRESS_END,
        message: 'Loading cached stem separation model.',
      });
      return this.loadCachedModelSource(model, request);
    }

    if (this.modelManager.ensureModelCached) {
      try {
        request.updateProgress({
          phase: 'downloading-model',
          progress: DOWNLOAD_PROGRESS_START,
          message: `Downloading ${model.label}.`,
        });
        await this.modelManager.ensureModelCached(model.id, {
          signal: request.signal,
          onProgress: (progress) => {
            request.updateProgress({
              phase: 'downloading-model',
              progress: mapStemSeparationProgress(progress.progress, DOWNLOAD_PROGRESS_START, DOWNLOAD_PROGRESS_END),
              message: `Downloading ${progress.fileName}.`,
            });
          },
        });
        throwIfStemSeparationAborted(request.signal);
        request.updateProgress({
          phase: 'loading-model',
          progress: DOWNLOAD_PROGRESS_END,
          message: 'Loading cached stem separation model.',
        });
        return this.loadCachedModelSource(model, request);
      } catch (error) {
        throwIfStemSeparationAborted(request.signal);
        log.warn('Stem model could not be cached; loading model directly in the worker', {
          modelId: model.id,
          error: getStemSeparationErrorMessage(error),
        });
      }
    }

    request.updateProgress({
      phase: 'loading-model',
      progress: DOWNLOAD_PROGRESS_END,
      message: 'Loading stem model directly in the worker.',
    });
    return { kind: 'url', url: getPrimaryStemModelUrl(model) };
  }

  private async loadCachedModelSource(
    model: StemModelCatalogEntry,
    request: ClipStemSeparationRunnerRequest,
  ): Promise<StemModelLoadSource> {
    try {
      return {
        kind: 'buffers',
        buffers: await this.modelManager.loadModelBuffers(model.id),
      };
    } catch (error) {
      throwIfStemSeparationAborted(request.signal);
      log.warn('Cached stem model could not be read; loading model directly in the worker', {
        modelId: model.id,
        error: getStemSeparationErrorMessage(error),
      });
      await this.modelManager.clearModelCache?.(model.id);
      request.updateProgress({
        phase: 'loading-model',
        progress: DOWNLOAD_PROGRESS_END,
        message: 'Cached stem model could not be read. Loading directly in the worker.',
      });
      return { kind: 'url', url: getPrimaryStemModelUrl(model) };
    }
  }

  private async loadWorkerModelWithRecovery(
    model: StemModelCatalogEntry,
    source: StemModelLoadSource,
    request: ClipStemSeparationRunnerRequest,
  ): Promise<Awaited<ReturnType<StemSeparationWorkerClientLike['loadModel']>>> {
    try {
      return await this.loadWorkerModelSource(model, source, request);
    } catch (error) {
      throwIfStemSeparationAborted(request.signal);
      log.warn('Stem worker could not load model; retrying with a fresh worker and direct model URL', {
        modelId: model.id,
        error: getStemSeparationErrorMessage(error),
      });
      request.updateProgress({
        phase: 'loading-model',
        progress: DOWNLOAD_PROGRESS_END,
        message: 'Stem model loader failed. Retrying with a fresh worker.',
      });

      this.disposeWorkerClient();
      return this.loadWorkerModelSource(model, { kind: 'url', url: getPrimaryStemModelUrl(model) }, request);
    }
  }

  private async loadWorkerModelSource(
    model: StemModelCatalogEntry,
    source: StemModelLoadSource,
    request: ClipStemSeparationRunnerRequest,
  ): Promise<Awaited<ReturnType<StemSeparationWorkerClientLike['loadModel']>>> {
    const worker = this.getWorkerClient();
    const onProgress = (progress: { progress: number; message?: string }) => {
      request.updateProgress({
        phase: 'loading-model',
        progress: mapStemSeparationProgress(progress.progress, DOWNLOAD_PROGRESS_END, LOAD_PROGRESS_END),
        message: progress.message,
      });
    };
    return source.kind === 'url'
      ? worker.loadModelFromUrl(model, source.url, { signal: request.signal, onProgress, backendPreference: 'wasm' })
      : worker.loadModel(model, source.buffers, { signal: request.signal, onProgress, backendPreference: 'wasm' });
  }
}

let instance: StemSeparationService | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    instance?.dispose();
    instance = null;
  });
}

export function getStemSeparationService(): StemSeparationService {
  instance ??= new StemSeparationService();
  return instance;
}
