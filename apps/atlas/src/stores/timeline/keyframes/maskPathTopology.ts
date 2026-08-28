import type { MaskPathKeyframeValue } from '../../../types';

type MaskPathVertex = MaskPathKeyframeValue['vertices'][number];

function cloneMaskVertex(vertex: MaskPathVertex): MaskPathVertex {
  return {
    ...vertex,
    handleIn: { ...vertex.handleIn },
    handleOut: { ...vertex.handleOut },
  };
}

export function maskPathsHaveMatchingTopology(
  from: MaskPathKeyframeValue,
  to: MaskPathKeyframeValue,
): boolean {
  if (from.vertices.length !== to.vertices.length) return false;
  return from.vertices.every((vertex, index) => vertex.id === to.vertices[index]?.id);
}

function collapseMaskVertexToAnchor(vertex: MaskPathVertex, anchor: MaskPathVertex): MaskPathVertex {
  return {
    ...vertex,
    x: anchor.x,
    y: anchor.y,
    handleIn: { x: 0, y: 0 },
    handleOut: { x: 0, y: 0 },
    handleMode: 'none',
  };
}

function getWrappedTopologyIndex(index: number, count: number): number {
  return ((index % count) + count) % count;
}

function getTopologyRunIndices(startIndex: number, endIndex: number, count: number): number[] {
  const indices: number[] = [];
  let index = getWrappedTopologyIndex(startIndex + 1, count);
  while (index !== endIndex) {
    indices.push(index);
    index = getWrappedTopologyIndex(index + 1, count);
  }
  return indices;
}

function getPointDistance(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

function getTopologyRatios(topologyVertices: MaskPathVertex[], segmentIndices: number[]): number[] {
  if (segmentIndices.length < 3) return [];

  const distances: number[] = [];
  let total = 0;
  for (let index = 1; index < segmentIndices.length; index += 1) {
    const prev = topologyVertices[segmentIndices[index - 1]];
    const next = topologyVertices[segmentIndices[index]];
    const distance = getPointDistance(prev, next);
    distances.push(distance);
    total += distance;
  }

  if (total <= 1e-9) {
    return segmentIndices.slice(1, -1).map((_, index) => (index + 1) / (segmentIndices.length - 1));
  }

  let cumulative = 0;
  return distances.slice(0, -1).map(distance => {
    cumulative += distance;
    return cumulative / total;
  });
}

function cubicPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
  };
}

function cubicDerivative(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const mt = 1 - t;
  return {
    x: 3 * mt * mt * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * mt * mt * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  };
}

function getSourceSegmentControls(fromVertex: MaskPathVertex, toVertex: MaskPathVertex) {
  return {
    p0: { x: fromVertex.x, y: fromVertex.y },
    p1: { x: fromVertex.x + fromVertex.handleOut.x, y: fromVertex.y + fromVertex.handleOut.y },
    p2: { x: toVertex.x + toVertex.handleIn.x, y: toVertex.y + toVertex.handleIn.y },
    p3: { x: toVertex.x, y: toVertex.y },
  };
}

function applySplitSourceSegment(
  outputVertices: MaskPathVertex[],
  topologyVertices: MaskPathVertex[],
  sourceVerticesById: Map<string, MaskPathVertex>,
  segmentIndices: number[],
): void {
  if (segmentIndices.length < 3) return;

  const startVertex = sourceVerticesById.get(topologyVertices[segmentIndices[0]].id);
  const endVertex = sourceVerticesById.get(topologyVertices[segmentIndices[segmentIndices.length - 1]].id);
  if (!startVertex || !endVertex) return;

  const controls = getSourceSegmentControls(startVertex, endVertex);
  const ratios = getTopologyRatios(topologyVertices, segmentIndices);
  const breakpoints = [0, ...ratios, 1];

  for (let index = 1; index < segmentIndices.length - 1; index += 1) {
    const point = cubicPoint(controls.p0, controls.p1, controls.p2, controls.p3, breakpoints[index]);
    const vertexIndex = segmentIndices[index];
    outputVertices[vertexIndex] = {
      ...outputVertices[vertexIndex],
      x: point.x,
      y: point.y,
      handleIn: { x: 0, y: 0 },
      handleOut: { x: 0, y: 0 },
      handleMode: 'split',
    };
  }

  for (let index = 0; index < segmentIndices.length - 1; index += 1) {
    const fromIndex = segmentIndices[index];
    const toIndex = segmentIndices[index + 1];
    const t0 = breakpoints[index];
    const t1 = breakpoints[index + 1];
    const dt = t1 - t0;
    const fromPoint = cubicPoint(controls.p0, controls.p1, controls.p2, controls.p3, t0);
    const toPoint = cubicPoint(controls.p0, controls.p1, controls.p2, controls.p3, t1);
    const fromDerivative = cubicDerivative(controls.p0, controls.p1, controls.p2, controls.p3, t0);
    const toDerivative = cubicDerivative(controls.p0, controls.p1, controls.p2, controls.p3, t1);

    outputVertices[fromIndex] = {
      ...outputVertices[fromIndex],
      handleOut: {
        x: (fromDerivative.x * dt) / 3,
        y: (fromDerivative.y * dt) / 3,
      },
    };
    outputVertices[toIndex] = {
      ...outputVertices[toIndex],
      handleIn: {
        x: -(toDerivative.x * dt) / 3,
        y: -(toDerivative.y * dt) / 3,
      },
      x: toPoint.x,
      y: toPoint.y,
    };

    if (index === 0) {
      outputVertices[fromIndex] = {
        ...outputVertices[fromIndex],
        x: fromPoint.x,
        y: fromPoint.y,
      };
    }
  }
}

function applyCollapsedTopologyRuns(
  outputVertices: MaskPathVertex[],
  topologyVertices: MaskPathVertex[],
  sourceVerticesById: Map<string, MaskPathVertex>,
  closed: boolean,
): void {
  const existingIndices = topologyVertices
    .map((vertex, index) => sourceVerticesById.has(vertex.id) ? index : -1)
    .filter(index => index >= 0);

  if (existingIndices.length === 0) return;
  if (existingIndices.length === 1) {
    const anchor = sourceVerticesById.get(topologyVertices[existingIndices[0]].id);
    if (!anchor) return;
    outputVertices.forEach((vertex, index) => {
      if (!sourceVerticesById.has(vertex.id)) {
        outputVertices[index] = collapseMaskVertexToAnchor(vertex, anchor);
      }
    });
    return;
  }

  for (let index = 0; index < existingIndices.length - 1; index += 1) {
    const segmentIndices = [existingIndices[index], ...getTopologyRunIndices(existingIndices[index], existingIndices[index + 1], topologyVertices.length), existingIndices[index + 1]];
    applySplitSourceSegment(outputVertices, topologyVertices, sourceVerticesById, segmentIndices);
  }

  if (closed) {
    const firstIndex = existingIndices[0];
    const lastIndex = existingIndices[existingIndices.length - 1];
    const segmentIndices = [lastIndex, ...getTopologyRunIndices(lastIndex, firstIndex, topologyVertices.length), firstIndex];
    applySplitSourceSegment(outputVertices, topologyVertices, sourceVerticesById, segmentIndices);
  }
}

function buildMaskPathForTopology(
  source: MaskPathKeyframeValue,
  topology: MaskPathKeyframeValue,
): MaskPathKeyframeValue {
  const sourceVerticesById = new Map(source.vertices.map(vertex => [vertex.id, vertex]));
  const fallbackAnchor = source.vertices[0] ?? topology.vertices[0];
  const vertices = topology.vertices.map((topologyVertex) => {
    const sourceVertex = sourceVerticesById.get(topologyVertex.id);
    return sourceVertex
      ? cloneMaskVertex(sourceVertex)
      : collapseMaskVertexToAnchor(topologyVertex, fallbackAnchor ?? topologyVertex);
  });

  applyCollapsedTopologyRuns(vertices, topology.vertices, sourceVerticesById, source.closed);

  return {
    closed: source.closed,
    vertices,
  };
}

export function buildMorphableMaskPaths(
  from: MaskPathKeyframeValue,
  to: MaskPathKeyframeValue,
): { from: MaskPathKeyframeValue; to: MaskPathKeyframeValue } {
  const topology = to.vertices.length >= from.vertices.length ? to : from;
  return {
    from: buildMaskPathForTopology(from, topology),
    to: buildMaskPathForTopology(to, topology),
  };
}
