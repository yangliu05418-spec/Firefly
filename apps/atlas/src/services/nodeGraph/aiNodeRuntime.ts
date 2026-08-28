import type {
  ClipCustomNodeDefinition,
  ClipCustomNodeParamValue,
  LayerSource,
  TextClipProperties,
  TimelineClip,
} from '../../types';
import { Logger } from '../logger';
import { getCanvasVersion, markDynamicCanvasUpdated } from '../canvasVersion';
import { buildClipNodeGraph } from './clipGraphProjection';
import { timelineRuntimeCoordinator } from '../timeline/timelineRuntimeCoordinator';
import type { RenderResourceDescriptor } from '../timeline/runtimeCoordinatorTypes';
import type { RuntimeProviderDemand } from '../../timeline';
import { createRenderResourceDescriptorFromDemand } from '../timeline/runtimeProviderDemandBridge';
import {
  createRuntimeAudioContext,
  createRuntimeAudioOptionsSignature,
  createRuntimeClipAudioSignature,
  resolveRuntimeAudioInput,
  type AINodeRuntimeAudioOptions,
} from './aiNodeRuntimeAudioContext';
import {
  createConnectedNodeInputs,
  createRuntimeClipMetadata,
  createRuntimeMetadata,
  createRuntimeSourceMetadata,
  createRuntimeTextSignal,
  createRuntimeTime,
  createSerializableGraph,
  type AINodeRuntimeInputValue,
} from './aiNodeRuntimeGraphSignals';
import {
  resolveCurrentTextProperties,
  runGeneratedNode,
} from './aiNodeRuntimeGeneratedNode';
import {
  getConnectedRunnableCustomNodes,
  getNodeProcessPixelBudget,
  isPixelSortNode,
  sortPixelsTexture,
} from './aiNodeRuntimeRunnableNodes';

export { sortPixelsTexture } from './aiNodeRuntimeRunnableNodes';

const log = Logger.create('AINodeRuntime');

const AI_NODE_RUNTIME_CACHE_ENTRY_LIMIT = 24;
const AI_NODE_RUNTIME_CACHE_BYTE_LIMIT = 96 * 1024 * 1024;

export interface AINodeRuntimeTexture {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  metadata?: Record<string, unknown>;
  text?: string | Partial<TextClipProperties>;
}

interface RuntimeCacheEntry {
  clipId: string;
  canvas: HTMLCanvasElement;
  sourceCanvas: HTMLCanvasElement;
  resourceIds: readonly [string, string];
  byteSize: number;
  lastSignature?: string;
}

type AINodeParamResolver = (nodeId: string) => Record<string, ClipCustomNodeParamValue>;

const runtimeCache = new Map<string, RuntimeCacheEntry>();
let runtimeCacheBytes = 0;

export function hasRunnableAINodes(clip: TimelineClip): boolean {
  return getConnectedRunnableCustomNodes(clip).length > 0;
}

function getCanvasSourceDimensions(source: LayerSource): { width: number; height: number } | null {
  const image = source.imageElement;
  if (image) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    return width > 0 && height > 0 ? { width, height } : null;
  }

  const canvas = source.textCanvas;
  if (canvas) {
    return canvas.width > 0 && canvas.height > 0 ? { width: canvas.width, height: canvas.height } : null;
  }

  const frame = source.videoFrame ?? source.webCodecsPlayer?.getCurrentFrame?.();
  if (frame) {
    const width = frame.displayWidth || frame.codedWidth;
    const height = frame.displayHeight || frame.codedHeight;
    return width > 0 && height > 0 ? { width, height } : null;
  }

  const video = source.videoElement;
  if (video) {
    const width = video.videoWidth || video.clientWidth || video.width;
    const height = video.videoHeight || video.clientHeight || video.height;
    return width > 0 && height > 0 ? { width, height } : null;
  }

  return null;
}

function getCanvasSource(source: LayerSource): CanvasImageSource | null {
  if (source.imageElement) return source.imageElement;
  if (source.textCanvas) return source.textCanvas;

  const frame = source.videoFrame ?? source.webCodecsPlayer?.getCurrentFrame?.();
  if (frame) return frame;

  if (source.videoElement && source.videoElement.readyState >= 2) {
    return source.videoElement;
  }

  return null;
}

function getProcessSize(width: number, height: number, maxPixels: number): { width: number; height: number } {
  const pixels = width * height;
  if (pixels <= maxPixels) {
    return { width, height };
  }

  const scale = Math.sqrt(maxPixels / pixels);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getCanvasByteSize(width: number, height: number): number {
  return Math.max(0, Math.round(width) * Math.round(height) * 4);
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function getAINodeRuntimeCacheResourceIds(key: string): readonly [string, string] {
  const hash = hashString(key);
  return [
    `timeline:ai-node-runtime:${hash}:source-canvas`,
    `timeline:ai-node-runtime:${hash}:output-canvas`,
  ];
}

function getAINodeRuntimeOwner(clip: TimelineClip, source: LayerSource): RuntimeProviderDemand['owner'] {
  return removeUndefinedValues({
    ownerId: `timeline:ai-node-runtime:${clip.id}`,
    ownerType: 'clip' as const,
    clipId: clip.id,
    trackId: clip.trackId,
    compositionId: clip.compositionId,
    mediaFileId: source.mediaFileId ?? clip.source?.mediaFileId ?? clip.mediaFileId,
  });
}

function createAINodeRuntimeCanvasResource(params: {
  id: string;
  imageId: string;
  label: string;
  clip: TimelineClip;
  source: LayerSource;
  layerId: string;
  width: number;
  height: number;
}): RenderResourceDescriptor {
  const owner = getAINodeRuntimeOwner(params.clip, params.source);
  const demand: RuntimeProviderDemand = {
    id: params.id,
    facetId: `${params.id}:facet`,
    resourceKind: 'image-canvas',
    policyId: 'interactive',
    leasePolicy: 'lease-visible',
    owner,
    source: removeUndefinedValues({
      sourceId: params.source.runtimeSourceId ?? params.source.mediaFileId ?? params.clip.mediaFileId,
      mediaFileId: params.source.mediaFileId ?? params.clip.mediaFileId,
      clipId: params.clip.id,
      trackId: params.clip.trackId,
      compositionId: owner.compositionId,
      projectPath: params.source.filePath,
      previewPath: params.source.previewPath,
    }),
    dimensions: {
      width: params.width,
      height: params.height,
      durationSeconds: params.clip.duration,
    },
    priority: 'visible',
    tags: ['timeline', 'node-graph', 'ai-node-runtime', params.layerId],
  };

  return createRenderResourceDescriptorFromDemand(demand, {
    resourceKind: 'image-canvas',
    imageKind: 'html-canvas',
    imageId: params.imageId,
    runtimeSourceId: params.source.runtimeSourceId,
    runtimeSessionKey: params.source.runtimeSessionKey,
    memoryCost: {
      heapBytes: getCanvasByteSize(params.width, params.height),
    },
    diagnostics: {
      status: 'ok',
      provider: {
        providerId: params.imageId,
        providerKind: 'canvas',
        status: 'ok',
      },
    },
    label: params.label,
  });
}

function createAINodeRuntimeCanvasResources(params: {
  key: string;
  clip: TimelineClip;
  source: LayerSource;
  layerId: string;
  width: number;
  height: number;
}): readonly [RenderResourceDescriptor, RenderResourceDescriptor] {
  const [sourceResourceId, outputResourceId] = getAINodeRuntimeCacheResourceIds(params.key);
  return [
    createAINodeRuntimeCanvasResource({
      id: sourceResourceId,
      imageId: `${sourceResourceId}:image`,
      label: 'AI node source canvas',
      clip: params.clip,
      source: params.source,
      layerId: params.layerId,
      width: params.width,
      height: params.height,
    }),
    createAINodeRuntimeCanvasResource({
      id: outputResourceId,
      imageId: `${outputResourceId}:image`,
      label: 'AI node output canvas',
      clip: params.clip,
      source: params.source,
      layerId: params.layerId,
      width: params.width,
      height: params.height,
    }),
  ];
}

function reserveAINodeRuntimeCanvasResources(
  resources: readonly RenderResourceDescriptor[],
): boolean {
  const retained: string[] = [];
  for (const resource of resources) {
    const admission = timelineRuntimeCoordinator.canRetainResource(resource);
    if (!admission.admitted) {
      for (const resourceId of retained) {
        timelineRuntimeCoordinator.releaseResource(resourceId);
      }
      return false;
    }
    timelineRuntimeCoordinator.retainResource(resource);
    retained.push(resource.id);
  }
  return true;
}

function getAINodeRuntimeCanvasResourceByteSize(resources: readonly RenderResourceDescriptor[]): number {
  return resources.reduce((sum, resource) => sum + (resource.memoryCost?.heapBytes ?? 0), 0);
}

function releaseRuntimeCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function releaseRuntimeCacheEntry(entry: RuntimeCacheEntry): void {
  runtimeCacheBytes -= entry.byteSize;
  for (const resourceId of entry.resourceIds) {
    timelineRuntimeCoordinator.releaseResource(resourceId);
  }
  releaseRuntimeCanvas(entry.canvas);
  releaseRuntimeCanvas(entry.sourceCanvas);
}

function releaseRuntimeCacheEntryByKey(key: string): void {
  const entry = runtimeCache.get(key);
  if (!entry) {
    return;
  }
  releaseRuntimeCacheEntry(entry);
  runtimeCache.delete(key);
}

function updateRuntimeCacheEntryResources(
  entry: RuntimeCacheEntry,
  key: string,
  clip: TimelineClip,
  source: LayerSource,
  layerId: string,
  outputSize?: { width: number; height: number },
): boolean {
  const [sourceResource, outputResource] = createAINodeRuntimeCanvasResources({
    key,
    clip,
    source,
    layerId,
    width: Math.max(1, entry.sourceCanvas.width),
    height: Math.max(1, entry.sourceCanvas.height),
  });
  const outputWidth = Math.max(1, Math.round(outputSize?.width ?? entry.canvas.width));
  const outputHeight = Math.max(1, Math.round(outputSize?.height ?? entry.canvas.height));
  const outputDescriptor = {
    ...outputResource,
    dimensions: {
      ...outputResource.dimensions,
      width: outputWidth,
      height: outputHeight,
    },
    memoryCost: {
      heapBytes: getCanvasByteSize(outputWidth, outputHeight),
    },
  } satisfies RenderResourceDescriptor;
  if (!reserveAINodeRuntimeCanvasResources([sourceResource, outputDescriptor])) {
    releaseRuntimeCacheEntryByKey(key);
    return false;
  }

  const nextByteSize = (sourceResource.memoryCost?.heapBytes ?? 0) + (outputDescriptor.memoryCost?.heapBytes ?? 0);
  runtimeCacheBytes += nextByteSize - entry.byteSize;
  entry.byteSize = nextByteSize;
  return true;
}

function enforceAINodeRuntimeCacheLimits(protectedKey?: string): void {
  while (
    runtimeCache.size > AI_NODE_RUNTIME_CACHE_ENTRY_LIMIT ||
    runtimeCacheBytes > AI_NODE_RUNTIME_CACHE_BYTE_LIMIT
  ) {
    const oldestKey = runtimeCache.keys().next().value;
    if (!oldestKey || (oldestKey === protectedKey && runtimeCache.size === 1)) break;
    const oldest = runtimeCache.get(oldestKey);
    if (oldest) {
      releaseRuntimeCacheEntry(oldest);
    }
    runtimeCache.delete(oldestKey);
  }
}

export function clearAINodeRuntimeCache(): void {
  for (const entry of runtimeCache.values()) {
    releaseRuntimeCacheEntry(entry);
  }
  runtimeCache.clear();
  runtimeCacheBytes = 0;
}

export function clearAINodeRuntimeCacheForClip(clipId: string): void {
  for (const [key, entry] of runtimeCache.entries()) {
    if (entry.clipId !== clipId) {
      continue;
    }
    releaseRuntimeCacheEntry(entry);
    runtimeCache.delete(key);
  }
}

function ensureCacheEntry(
  key: string,
  clip: TimelineClip,
  source: LayerSource,
  layerId: string,
  processSize: { width: number; height: number },
): RuntimeCacheEntry | null {
  const existing = runtimeCache.get(key);
  const resources = createAINodeRuntimeCanvasResources({
    key,
    clip,
    source,
    layerId,
    width: processSize.width,
    height: processSize.height,
  });
  const nextByteSize = getAINodeRuntimeCanvasResourceByteSize(resources);
  if (existing) {
    if (!reserveAINodeRuntimeCanvasResources(resources)) {
      releaseRuntimeCacheEntryByKey(key);
      return null;
    }
    runtimeCacheBytes += nextByteSize - existing.byteSize;
    existing.byteSize = nextByteSize;
    runtimeCache.delete(key);
    runtimeCache.set(key, existing);
    enforceAINodeRuntimeCacheLimits(key);
    return existing;
  }

  if (!reserveAINodeRuntimeCanvasResources(resources)) {
    return null;
  }

  const entry = {
    clipId: clip.id,
    canvas: document.createElement('canvas'),
    sourceCanvas: document.createElement('canvas'),
    resourceIds: [resources[0].id, resources[1].id] as const,
    byteSize: nextByteSize,
  };
  entry.canvas.dataset.masterselectsDynamic = 'true';
  runtimeCache.set(key, entry);
  runtimeCacheBytes += entry.byteSize;
  enforceAINodeRuntimeCacheLimits(key);
  return entry;
}

function stableStringifyParams(params: Record<string, ClipCustomNodeParamValue>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${String(params[key])}`)
    .join(',');
}

function createSourceContentSignature(source: LayerSource): string {
  const canvas = source.textCanvas;
  if (canvas) {
    return [
      source.type,
      canvas.width,
      canvas.height,
      getCanvasVersion(canvas),
    ].join(':');
  }

  const image = source.imageElement;
  if (image) {
    return [
      source.type,
      image.currentSrc || image.src || '',
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
    ].join(':');
  }

  return [
    source.type,
    source.mediaTime ?? '',
    source.targetMediaTime ?? '',
    source.previewPath ?? '',
  ].join(':');
}

function processTexture(
  definitions: ClipCustomNodeDefinition[],
  clip: TimelineClip,
  source: LayerSource,
  texture: AINodeRuntimeTexture,
  clipLocalTime: number,
  resolveParams: AINodeParamResolver,
  audioOptions: AINodeRuntimeAudioOptions = {},
): AINodeRuntimeTexture {
  const graph = buildClipNodeGraph(clip, audioOptions.track, {
    linkedClip: audioOptions.linkedClip,
    linkedTrack: audioOptions.linkedTrack,
  });
  const graphSignal = createSerializableGraph(graph);
  const clipSignal = createRuntimeClipMetadata(clip);
  const sourceSignal = createRuntimeSourceMetadata(source);
  const runtimeAudioInput = resolveRuntimeAudioInput(clip, audioOptions);
  const audioSignal = createRuntimeAudioContext(
    runtimeAudioInput.clip,
    runtimeAudioInput.track,
    audioOptions.masterAudioState,
  );

  return definitions.reduce((current, definition) => {
    const params = resolveParams(definition.id);
    if (isPixelSortNode(definition)) {
      return sortPixelsTexture(current);
    }
    const currentText = resolveCurrentTextProperties(clip.textProperties, current);
    const currentDimensions = { width: current.width, height: current.height };
    const textSignal = createRuntimeTextSignal(currentText, currentDimensions);
    const metadata = {
      ...(current.metadata ?? {}),
      ...createRuntimeMetadata(clip, source, currentText, currentDimensions, audioSignal),
    };
    const timeSignal = createRuntimeTime({
      clipId: clip.id,
      clipLocalTime,
      mediaTime: source.mediaTime,
      params,
      metadata,
      clip: clipSignal,
      source: sourceSignal,
      graph: graphSignal,
      node: { id: definition.id, label: definition.label },
      signals: {},
      audio: audioSignal,
      text: textSignal,
    });
    const baseSignals: Record<string, AINodeRuntimeInputValue> = {
      texture: current,
      time: timeSignal,
      params,
      metadata,
      clip: clipSignal,
      source: sourceSignal,
      graph: graphSignal,
      node: { id: definition.id, label: definition.label },
      audio: audioSignal,
      audioAnalysis: audioSignal?.analysis,
      frequencyBands: audioSignal?.analysis.effective.frequencyBands,
      beats: audioSignal?.analysis.effective.beats,
      onsets: audioSignal?.analysis.effective.onsets,
      audioMetadata: audioSignal?.metadata,
      audioRepairSuggestions: audioSignal?.repairSuggestions,
      text: textSignal,
    };
    const connectedInputs = createConnectedNodeInputs(graph, definition.id, baseSignals, audioSignal);
    const signals = {
      ...baseSignals,
      connectedInputs,
    };

    return runGeneratedNode(definition, current, {
      clipId: clip.id,
      clipLocalTime,
      mediaTime: source.mediaTime,
      params,
      metadata,
      clip: clipSignal,
      source: sourceSignal,
      graph: graphSignal,
      node: {
        id: definition.id,
        label: definition.label,
        inputs: definition.inputs,
        outputs: definition.outputs,
        status: definition.status,
      },
      audio: audioSignal,
      signals,
      text: textSignal,
    }, connectedInputs);
  }, texture);
}

export function renderClipAINodesToCanvas(
  clip: TimelineClip,
  source: LayerSource,
  layerId: string,
  clipLocalTime: number,
  resolveParams: AINodeParamResolver = () => ({}),
  audioOptions: AINodeRuntimeAudioOptions = {},
): HTMLCanvasElement | null {
  const cacheKey = `${layerId}:${clip.id}`;
  const runnableNodes = getConnectedRunnableCustomNodes(clip);
  if (runnableNodes.length === 0 || typeof document === 'undefined') {
    releaseRuntimeCacheEntryByKey(cacheKey);
    return null;
  }

  const canvasSource = getCanvasSource(source);
  const sourceSize = getCanvasSourceDimensions(source);
  if (!canvasSource || !sourceSize) {
    releaseRuntimeCacheEntryByKey(cacheKey);
    return null;
  }

  const hasPixelSortNode = runnableNodes.some(isPixelSortNode);
  const processSize = getProcessSize(
    sourceSize.width,
    sourceSize.height,
    getNodeProcessPixelBudget(clip, sourceSize, hasPixelSortNode),
  );
  const signature = [
    source.mediaTime ?? source.targetMediaTime ?? clipLocalTime,
    createSourceContentSignature(source),
    processSize.width,
    processSize.height,
    createRuntimeClipAudioSignature(clip),
    createRuntimeAudioOptionsSignature(audioOptions),
    runnableNodes
      .map((definition) => {
        const params = resolveParams(definition.id);
        return `${definition.id}:${definition.ai.prompt}:${definition.ai.generatedCode}:${stableStringifyParams(params)}`;
      })
      .join('|'),
  ].join(':');

  const entry = ensureCacheEntry(cacheKey, clip, source, layerId, processSize);
  if (!entry) {
    return null;
  }

  if (entry.lastSignature === signature) {
    return entry.canvas;
  }

  entry.sourceCanvas.width = processSize.width;
  entry.sourceCanvas.height = processSize.height;
  const context = entry.sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    releaseRuntimeCacheEntryByKey(cacheKey);
    return null;
  }

  try {
    context.drawImage(canvasSource, 0, 0, processSize.width, processSize.height);
    const imageData = context.getImageData(0, 0, processSize.width, processSize.height);
    const output = processTexture(
      runnableNodes,
      clip,
      source,
      {
        data: imageData.data,
        width: imageData.width,
        height: imageData.height,
      },
      clipLocalTime,
      resolveParams,
      audioOptions,
    );

    if (!updateRuntimeCacheEntryResources(entry, cacheKey, clip, source, layerId, {
      width: output.width,
      height: output.height,
    })) {
      return null;
    }

    entry.canvas.width = output.width;
    entry.canvas.height = output.height;
    const outputContext = entry.canvas.getContext('2d');
    if (!outputContext) {
      releaseRuntimeCacheEntryByKey(cacheKey);
      return null;
    }
    const outputImageData = outputContext.createImageData(output.width, output.height);
    outputImageData.data.set(output.data);
    outputContext.putImageData(outputImageData, 0, 0);
    markDynamicCanvasUpdated(entry.canvas, 'ai-node');
    entry.lastSignature = signature;
    enforceAINodeRuntimeCacheLimits(cacheKey);
    return entry.canvas;
  } catch (error) {
    releaseRuntimeCacheEntryByKey(cacheKey);
    log.warn('Failed to render AI node canvas; passing source through', error);
    return null;
  }
}
