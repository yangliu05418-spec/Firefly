import type { TimelineClip } from "../../types/timeline";
import type { ClipCustomNodeDefinition } from "../../types/nodeGraph";
import { extractAINodeGeneratedCode } from './aiNodeDefinition';
import { buildClipNodeGraph } from './clipGraphProjection';
import type { AINodeRuntimeTexture } from './aiNodeRuntime';

const PIXEL_SORT_MAX_PIXELS = 320 * 180;
const GENERATED_NODE_MAX_PIXELS = 96 * 54;

function isRunnableCustomNode(definition: ClipCustomNodeDefinition): boolean {
  return definition.bypassed !== true &&
    definition.status === 'ready' &&
    !!extractAINodeGeneratedCode(definition.ai.generatedCode ?? '');
}

export function getConnectedRunnableCustomNodes(clip: TimelineClip): ClipCustomNodeDefinition[] {
  const runnableById = new Map(
    (clip.nodeGraph?.customNodes ?? [])
      .filter(isRunnableCustomNode)
      .map((definition) => [definition.id, definition]),
  );

  if (runnableById.size === 0) {
    return [];
  }

  const graph = buildClipNodeGraph(clip);
  const incomingEdges = new Map(graph.edges.map((edge) => [`${edge.toNodeId}:${edge.toPortId}`, edge]));
  const chain: ClipCustomNodeDefinition[] = [];
  const visitedNodes = new Set<string>();
  let incomingEdge = incomingEdges.get('output:input');

  while (incomingEdge && incomingEdge.type === 'texture' && incomingEdge.fromNodeId !== 'source') {
    if (visitedNodes.has(incomingEdge.fromNodeId)) {
      return [];
    }
    visitedNodes.add(incomingEdge.fromNodeId);

    const customNode = runnableById.get(incomingEdge.fromNodeId);
    if (customNode) {
      chain.unshift(customNode);
    }

    incomingEdge = incomingEdges.get(`${incomingEdge.fromNodeId}:input`);
  }

  return incomingEdge?.fromNodeId === 'source' && incomingEdge.type === 'texture' ? chain : [];
}

function copyTexture(texture: AINodeRuntimeTexture): AINodeRuntimeTexture {
  return {
    data: new Uint8ClampedArray(texture.data),
    width: texture.width,
    height: texture.height,
  };
}

export function sortPixelsTexture(texture: AINodeRuntimeTexture): AINodeRuntimeTexture {
  const output = copyTexture(texture);
  const pixelCount = texture.width * texture.height;
  const pixels = new Array<number>(pixelCount);

  for (let i = 0; i < pixelCount; i += 1) {
    const base = i * 4;
    pixels[i] = (
      (texture.data[base] << 24) |
      (texture.data[base + 1] << 16) |
      (texture.data[base + 2] << 8) |
      texture.data[base + 3]
    ) >>> 0;
  }

  pixels.sort((a, b) => a - b);

  for (let i = 0; i < pixelCount; i += 1) {
    const base = i * 4;
    const value = pixels[i];
    output.data[base] = (value >>> 24) & 0xff;
    output.data[base + 1] = (value >>> 16) & 0xff;
    output.data[base + 2] = (value >>> 8) & 0xff;
    output.data[base + 3] = value & 0xff;
  }

  return output;
}

export function isPixelSortNode(definition: ClipCustomNodeDefinition): boolean {
  const haystack = `${definition.ai.prompt}\n${definition.ai.generatedCode ?? ''}`;
  return /sort(?:ing)?\s+(?:all\s+)?pixels|pixels?\s+sort/i.test(haystack);
}

export function getNodeProcessPixelBudget(
  clip: TimelineClip,
  sourceSize: { width: number; height: number },
  hasPixelSortNode: boolean,
): number {
  if (clip.textProperties) {
    return sourceSize.width * sourceSize.height;
  }
  return hasPixelSortNode ? PIXEL_SORT_MAX_PIXELS : GENERATED_NODE_MAX_PIXELS;
}
