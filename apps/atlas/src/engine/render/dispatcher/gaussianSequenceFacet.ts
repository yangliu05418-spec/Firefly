import type { SceneSplatLayer } from '../../scene/types';
import { getGaussianSplatSequenceFrameIndex } from '../../../utils/gaussianSplatSequence';

const SPLAT_SEQUENCE_PREVIEW_MAX_SPLATS = 65536;
const SPLAT_SEQUENCE_MAX_BACKGROUND_LOADS = 3;
const SPLAT_SEQUENCE_PLAYBACK_PRELOAD_FRAMES = 72;
const SPLAT_SEQUENCE_PLAYBACK_RETAIN_BEHIND_FRAMES = 12;
const SPLAT_SEQUENCE_PLAYBACK_RETAIN_AHEAD_FRAMES = 72;

export interface GaussianSplatSceneLoadRequest {
  sceneKey: string;
  clipId?: string;
  url?: string;
  fileName: string;
  file?: File;
  showProgress?: boolean;
  maxSplats?: number;
}

interface GaussianSequenceRenderer {
  hasScene(sceneKey: string): boolean;
  releaseScene(sceneKey: string): void;
}

interface SharedSplatSequenceFrame {
  textureView: GPUTextureView;
  sceneKey: string;
  width: number;
  height: number;
}

interface GaussianSequenceFacetDeps {
  resolveSceneKey: (clipId: string, runtimeKey?: string) => string;
  isSplatLoading: (sceneKey: string) => boolean;
  ensureSceneLoaded: (request: GaussianSplatSceneLoadRequest) => Promise<boolean>;
}

export class GaussianSequenceFacet {
  private readonly deps: GaussianSequenceFacetDeps;
  private backgroundSplatSequenceLoads = new Set<string>();
  private lastSharedSplatSequenceFrame: SharedSplatSequenceFrame | null = null;
  private lastRenderedSplatSequenceSceneKey: string | null = null;
  private splatSequenceVisualFrameChanges: number[] = [];

  constructor(deps: GaussianSequenceFacetDeps) {
    this.deps = deps;
  }

  getPreviewMaxSplats(layer: SceneSplatLayer): number | undefined {
    if (layer.gaussianSplatIsSequence !== true) {
      return undefined;
    }

    const requestedMaxSplats = Math.floor(layer.gaussianSplatSettings?.render?.maxSplats ?? 0);
    if (Number.isFinite(requestedMaxSplats) && requestedMaxSplats > 0) {
      return Math.min(requestedMaxSplats, SPLAT_SEQUENCE_PREVIEW_MAX_SPLATS);
    }
    return SPLAT_SEQUENCE_PREVIEW_MAX_SPLATS;
  }

  getRuntimeKey(runtimeKey: string | undefined, maxSplats?: number): string | undefined {
    if (!runtimeKey || !maxSplats || maxSplats <= 0) {
      return runtimeKey;
    }
    return `${runtimeKey}|preview-lod-${maxSplats}`;
  }

  hasLastSharedFrame(): boolean {
    return this.lastSharedSplatSequenceFrame !== null;
  }

  getLastSharedFrame(): SharedSplatSequenceFrame | null {
    return this.lastSharedSplatSequenceFrame;
  }

  setLastSharedFrame(frame: SharedSplatSequenceFrame): void {
    this.lastSharedSplatSequenceFrame = frame;
  }

  clearLastSharedFrame(): void {
    this.lastSharedSplatSequenceFrame = null;
  }

  getBackgroundLoadCount(): number {
    return this.backgroundSplatSequenceLoads.size;
  }

  recordVisualFrame(sceneKey: string | undefined, countAsChange: boolean): number {
    const now = performance.now();
    if (sceneKey && sceneKey !== this.lastRenderedSplatSequenceSceneKey) {
      if (countAsChange && this.lastRenderedSplatSequenceSceneKey !== null) {
        this.splatSequenceVisualFrameChanges.push(now);
      }
      this.lastRenderedSplatSequenceSceneKey = sceneKey;
    }

    const cutoff = now - 1000;
    this.splatSequenceVisualFrameChanges = this.splatSequenceVisualFrameChanges
      .filter((timestamp) => timestamp >= cutoff);
    return this.splatSequenceVisualFrameChanges.length;
  }

  preloadNearbyFrames(
    layer: SceneSplatLayer,
    renderer: GaussianSequenceRenderer,
    realtimePlayback: boolean,
    draggingPlayhead: boolean,
    maxSplats?: number,
  ): void {
    const sequence = layer.gaussianSplatSequence;
    if (!sequence || sequence.frames.length <= 1 || layer.mediaTime == null) {
      return;
    }
    const currentIndex = getGaussianSplatSequenceFrameIndex(sequence, layer.mediaTime);
    const usePlaybackPreloadWindow = realtimePlayback || !draggingPlayhead;
    const offsets = usePlaybackPreloadWindow
      ? Array.from({ length: SPLAT_SEQUENCE_PLAYBACK_PRELOAD_FRAMES + 1 }, (_, index) => index)
      : [0, -1, 1, -2, 2];
    let scheduled = 0;
    const maxSchedulePerPass = usePlaybackPreloadWindow ? SPLAT_SEQUENCE_MAX_BACKGROUND_LOADS : 1;

    for (const offset of offsets) {
      if (
        scheduled >= maxSchedulePerPass ||
        this.backgroundSplatSequenceLoads.size >= SPLAT_SEQUENCE_MAX_BACKGROUND_LOADS
      ) {
        continue;
      }

      const frameIndex = currentIndex + offset;
      if (frameIndex < 0 || frameIndex >= sequence.frames.length) {
        continue;
      }

      const frameInfo = this.getFrameSceneKey(layer, frameIndex, maxSplats);
      if (!frameInfo) {
        continue;
      }
      const frame = frameInfo.frame;
      if (!frame?.file && !frame?.splatUrl) {
        continue;
      }

      const sceneKey = frameInfo.sceneKey;
      if (renderer.hasScene(sceneKey) || this.deps.isSplatLoading(sceneKey)) {
        continue;
      }

      scheduled += 1;
      this.scheduleBackgroundLoad({
        sceneKey,
        clipId: layer.clipId,
        url: frame.splatUrl,
        fileName: frame.name || layer.gaussianSplatFileName || layer.layerId,
        file: frame.file,
        showProgress: false,
        maxSplats,
      });
    }
  }

  scheduleBackgroundLoad(
    request: GaussianSplatSceneLoadRequest,
    priority = false,
  ): void {
    if (
      this.backgroundSplatSequenceLoads.has(request.sceneKey) ||
      this.deps.isSplatLoading(request.sceneKey) ||
      (!priority && this.backgroundSplatSequenceLoads.size >= SPLAT_SEQUENCE_MAX_BACKGROUND_LOADS)
    ) {
      return;
    }

    this.backgroundSplatSequenceLoads.add(request.sceneKey);
    void this.deps.ensureSceneLoaded({
      ...request,
      showProgress: false,
    }).finally(() => {
      this.backgroundSplatSequenceLoads.delete(request.sceneKey);
    });
  }

  prunePreviewScenes(
    layer: SceneSplatLayer,
    renderer: GaussianSequenceRenderer,
    maxSplats: number | undefined,
  ): void {
    const sequence = layer.gaussianSplatSequence;
    if (!sequence || !maxSplats || maxSplats <= 0 || layer.mediaTime == null) {
      return;
    }

    const currentIndex = getGaussianSplatSequenceFrameIndex(sequence, layer.mediaTime);
    const retainStart = Math.max(0, currentIndex - SPLAT_SEQUENCE_PLAYBACK_RETAIN_BEHIND_FRAMES);
    const retainEnd = Math.min(sequence.frames.length - 1, currentIndex + SPLAT_SEQUENCE_PLAYBACK_RETAIN_AHEAD_FRAMES);

    for (let frameIndex = 0; frameIndex < sequence.frames.length; frameIndex += 1) {
      if (frameIndex >= retainStart && frameIndex <= retainEnd) {
        continue;
      }

      const frameInfo = this.getFrameSceneKey(layer, frameIndex, maxSplats);
      if (!frameInfo || this.backgroundSplatSequenceLoads.has(frameInfo.sceneKey)) {
        continue;
      }
      if (this.lastSharedSplatSequenceFrame?.sceneKey === frameInfo.sceneKey) {
        continue;
      }

      renderer.releaseScene(frameInfo.sceneKey);
    }
  }

  private getFrameRuntimeKey(
    frame: NonNullable<SceneSplatLayer['gaussianSplatSequence']>['frames'][number] | undefined,
    fallbackKey: string,
  ): string {
    return frame?.projectPath || frame?.absolutePath || frame?.sourcePath || frame?.name || fallbackKey;
  }

  private getFrameSceneKey(
    layer: SceneSplatLayer,
    frameIndex: number,
    maxSplats?: number,
  ): { sceneKey: string; runtimeKey: string; frame?: NonNullable<SceneSplatLayer['gaussianSplatSequence']>['frames'][number] } | null {
    const sequence = layer.gaussianSplatSequence;
    const frame = sequence?.frames[frameIndex];
    if (!sequence || !frame) {
      return null;
    }

    const fallbackKey = `${layer.clipId}:sequence:${frameIndex}`;
    const runtimeKey = this.getRuntimeKey(
      this.getFrameRuntimeKey(frame, fallbackKey),
      maxSplats,
    ) ?? fallbackKey;

    return {
      sceneKey: this.deps.resolveSceneKey(layer.clipId, runtimeKey),
      runtimeKey,
      frame,
    };
  }
}
