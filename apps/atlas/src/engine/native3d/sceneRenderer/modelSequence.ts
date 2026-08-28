import type { SceneModelLayer } from '../../scene/types';
import type { ModelRuntimeCache, ModelRuntimePreloadOptions } from '../assets/ModelRuntimeCache';
import type { SceneNativeMeshLayer } from '../passes/MeshPass';

const MODEL_SEQUENCE_CPU_PRELOAD_AHEAD = 4;
const MODEL_SEQUENCE_CPU_PRELOAD_BEHIND = 1;
const MODEL_SEQUENCE_MAX_NEW_PRELOADS_PER_FRAME = 1;
const MODEL_SEQUENCE_MAX_REALTIME_LOADS = 1;
const MODEL_SEQUENCE_GPU_RETAIN_AHEAD = 8;
const MODEL_SEQUENCE_GPU_RETAIN_BEHIND = 3;

type ModelSequence = SceneModelLayer['modelSequence'];
type ModelSequenceFrame = NonNullable<ModelSequence>['frames'][number];

export function getModelPreloadOptions(layer: SceneModelLayer): ModelRuntimePreloadOptions {
  return getModelSequencePreloadOptions(layer.modelSequence);
}

export function getModelSequencePreloadOptions(
  sequence: ModelSequence | undefined,
): ModelRuntimePreloadOptions {
  if (!sequence || sequence.frames.length <= 1) {
    return {};
  }

  const anchorFrame = sequence.frames.find((frame) => !!frame.modelUrl);
  if (!anchorFrame?.modelUrl) {
    return {};
  }

  const sequenceKey = [
    sequence.sequenceName ?? 'model-sequence',
    sequence.frameCount,
    sequence.fps,
    anchorFrame.name,
    anchorFrame.modelUrl,
  ].join('|');

  return {
    normalizationKey: sequenceKey,
    anchorUrl: anchorFrame.modelUrl,
    anchorFileName: anchorFrame.name,
  };
}

export function prepareModelLayerForRender(
  layer: SceneModelLayer,
  realtimePlayback: boolean,
  modelRuntimeCache: ModelRuntimeCache,
  lastRenderableModelSequenceUrls: Map<string, string>,
): SceneModelLayer {
  if (!layer.modelUrl) {
    return layer;
  }

  const options = getModelPreloadOptions(layer);
  modelRuntimeCache.touch(layer.modelUrl, layer.modelFileName);
  if (!modelRuntimeCache.isLoaded(layer.modelUrl, options)) {
    scheduleModelRuntimePreload(
      layer.modelUrl,
      layer.modelFileName,
      options,
      realtimePlayback && !!layer.modelSequence,
      modelRuntimeCache,
    );
  }
  preloadNearbyModelSequenceFrames(layer, realtimePlayback, options, modelRuntimeCache);

  const sequence = layer.modelSequence;
  if (!sequence || sequence.frames.length <= 1) {
    return layer;
  }

  if (modelRuntimeCache.isLoaded(layer.modelUrl, options)) {
    lastRenderableModelSequenceUrls.set(layer.clipId, layer.modelUrl);
    return layer;
  }

  if (!realtimePlayback) {
    return layer;
  }

  const fallbackFrame = findRenderableModelSequenceFrame(
    layer,
    options,
    modelRuntimeCache,
    lastRenderableModelSequenceUrls,
  );
  if (!fallbackFrame?.modelUrl || fallbackFrame.modelUrl === layer.modelUrl) {
    return layer;
  }

  return {
    ...layer,
    modelUrl: fallbackFrame.modelUrl,
    modelFileName: fallbackFrame.name,
  };
}

export function collectRetainedModelUrls(
  nativeMeshLayers: SceneNativeMeshLayer[],
  lastRenderableModelSequenceUrls: Map<string, string>,
): Set<string> {
  const activeModelUrls = new Set<string>();
  for (const layer of nativeMeshLayers) {
    if (layer.kind !== 'model' || !layer.modelUrl) {
      continue;
    }

    activeModelUrls.add(layer.modelUrl);
    const lastUrl = lastRenderableModelSequenceUrls.get(layer.clipId);
    if (lastUrl) {
      activeModelUrls.add(lastUrl);
    }

    const sequence = layer.modelSequence;
    if (!sequence || sequence.frames.length <= 1) {
      continue;
    }

    const currentIndex = sequence.frames.findIndex((frame) => frame.modelUrl === layer.modelUrl);
    if (currentIndex < 0) {
      continue;
    }

    const start = Math.max(0, currentIndex - MODEL_SEQUENCE_GPU_RETAIN_BEHIND);
    const end = Math.min(sequence.frames.length - 1, currentIndex + MODEL_SEQUENCE_GPU_RETAIN_AHEAD);
    for (let index = start; index <= end; index += 1) {
      const frameUrl = sequence.frames[index]?.modelUrl;
      if (frameUrl) {
        activeModelUrls.add(frameUrl);
      }
    }
  }
  return activeModelUrls;
}

function findRenderableModelSequenceFrame(
  layer: SceneModelLayer,
  options: ModelRuntimePreloadOptions,
  modelRuntimeCache: ModelRuntimeCache,
  lastRenderableModelSequenceUrls: Map<string, string>,
): ModelSequenceFrame | null {
  const sequence = layer.modelSequence;
  if (!sequence || sequence.frames.length === 0) {
    return null;
  }

  const lastUrl = lastRenderableModelSequenceUrls.get(layer.clipId);
  if (lastUrl && modelRuntimeCache.isLoaded(lastUrl, options)) {
    return sequence.frames.find((frame) => frame.modelUrl === lastUrl) ?? null;
  }

  const currentIndex = layer.modelUrl
    ? sequence.frames.findIndex((frame) => frame.modelUrl === layer.modelUrl)
    : -1;
  if (currentIndex < 0) {
    return null;
  }

  for (let offset = 1; offset < sequence.frames.length; offset += 1) {
    const previous = sequence.frames[currentIndex - offset];
    if (previous?.modelUrl && modelRuntimeCache.isLoaded(previous.modelUrl, options)) {
      return previous;
    }
    const next = sequence.frames[currentIndex + offset];
    if (next?.modelUrl && modelRuntimeCache.isLoaded(next.modelUrl, options)) {
      return next;
    }
  }

  return null;
}

function preloadNearbyModelSequenceFrames(
  layer: SceneModelLayer,
  realtimePlayback: boolean,
  options: ModelRuntimePreloadOptions,
  modelRuntimeCache: ModelRuntimeCache,
): void {
  const sequence = layer.modelSequence;
  if (!realtimePlayback || !sequence || sequence.frames.length <= 1 || !layer.modelUrl) {
    return;
  }

  const currentIndex = sequence.frames.findIndex((frame) => frame.modelUrl === layer.modelUrl);
  if (currentIndex < 0) {
    return;
  }

  const offsets = [
    ...Array.from({ length: MODEL_SEQUENCE_CPU_PRELOAD_AHEAD }, (_, index) => index + 1),
    ...Array.from({ length: MODEL_SEQUENCE_CPU_PRELOAD_BEHIND }, (_, index) => -(index + 1)),
  ];
  let scheduled = 0;
  for (const offset of offsets) {
    if (scheduled >= MODEL_SEQUENCE_MAX_NEW_PRELOADS_PER_FRAME) {
      break;
    }
    const frame = sequence.frames[currentIndex + offset];
    if (
      !frame?.modelUrl ||
      modelRuntimeCache.isLoaded(frame.modelUrl, options) ||
      modelRuntimeCache.isLoading(frame.modelUrl)
    ) {
      continue;
    }
    if (scheduleModelRuntimePreload(frame.modelUrl, frame.name, options, true, modelRuntimeCache)) {
      scheduled += 1;
    }
  }
}

function scheduleModelRuntimePreload(
  url: string,
  fileName: string | undefined,
  options: ModelRuntimePreloadOptions,
  realtimeSequence: boolean,
  modelRuntimeCache: ModelRuntimeCache,
): boolean {
  if (modelRuntimeCache.isLoaded(url, options) || modelRuntimeCache.isLoading(url)) {
    return false;
  }
  if (realtimeSequence && modelRuntimeCache.loadingCount() >= MODEL_SEQUENCE_MAX_REALTIME_LOADS) {
    return false;
  }
  void modelRuntimeCache.preload(url, fileName, options);
  return true;
}
