import type { Layer } from "../../../types/layers";
import type { MaskVertex, TextBoundsPath } from "../../../types/masks";
import type { TextClipProperties } from "../../../types/text";
import type { TimelineClip } from "../../../types/timeline";
import {
  cloneTextBoundsPath,
  resolveTextBoundsPath,
  resolveTextBoxRect,
} from '../../../services/textLayout';
import {
  projectLayerUvToCanvas,
  unprojectCanvasToLayerUv,
  type OverlayPoint,
} from '../editModeOverlayMath';
import type { EditorGeometry } from './textPreviewTypes';

export function distance(a: OverlayPoint, b: OverlayPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function atLeast(value: number, minimum: number): number {
  return value < minimum ? minimum : value;
}

export function roundNormalizedToPixel(value: number, dimension: number): number {
  return Math.round(value * Math.max(1, dimension)) / Math.max(1, dimension);
}

export function getSourceDimensions(
  clip: TimelineClip,
  layer: Layer,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  const sourceCanvas = clip.source?.textCanvas ?? layer.source?.textCanvas;
  return {
    width: sourceCanvas?.width || fallback.width,
    height: sourceCanvas?.height || fallback.height,
  };
}

export function buildSvgPath(
  bounds: TextBoundsPath,
  sourceWidth: number,
  sourceHeight: number,
  projectSourcePoint: (sourceX: number, sourceY: number) => OverlayPoint,
): string {
  const vertices = bounds.vertices;
  if (vertices.length === 0) return '';

  const projectVertex = (vertex: MaskVertex, handle?: 'in' | 'out') => {
    const handleOffset = handle === 'in'
      ? vertex.handleIn
      : handle === 'out'
        ? vertex.handleOut
        : { x: 0, y: 0 };
    return projectSourcePoint(
      (vertex.x + bounds.position.x + handleOffset.x) * sourceWidth,
      (vertex.y + bounds.position.y + handleOffset.y) * sourceHeight,
    );
  };

  const first = projectVertex(vertices[0]);
  const commands = [`M ${first.x} ${first.y}`];
  for (let index = 1; index < vertices.length; index += 1) {
    const previous = vertices[index - 1];
    const current = vertices[index];
    const end = projectVertex(current);
    if (
      previous.handleOut.x === 0 &&
      previous.handleOut.y === 0 &&
      current.handleIn.x === 0 &&
      current.handleIn.y === 0
    ) {
      commands.push(`L ${end.x} ${end.y}`);
    } else {
      const cp1 = projectVertex(previous, 'out');
      const cp2 = projectVertex(current, 'in');
      commands.push(`C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${end.x} ${end.y}`);
    }
  }

  if (bounds.closed && vertices.length > 1) {
    const previous = vertices[vertices.length - 1];
    const current = vertices[0];
    if (
      previous.handleOut.x !== 0 ||
      previous.handleOut.y !== 0 ||
      current.handleIn.x !== 0 ||
      current.handleIn.y !== 0
    ) {
      const cp1 = projectVertex(previous, 'out');
      const cp2 = projectVertex(current, 'in');
      commands.push(`C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${first.x} ${first.y}`);
    }
    commands.push('Z');
  }

  return commands.join(' ');
}

export function buildTextEditorGeometry(params: {
  clip: TimelineClip;
  layer: Layer;
  textProperties: TextClipProperties;
  activeTextBounds?: TextBoundsPath;
  effectiveResolution: { width: number; height: number };
  canvasSize: { width: number; height: number };
  canvasInContainer: { x: number; y: number };
  viewZoom: number;
}): EditorGeometry {
  const {
    clip,
    layer,
    textProperties,
    activeTextBounds,
    effectiveResolution,
    canvasSize,
    canvasInContainer,
    viewZoom,
  } = params;
  const { width: sourceWidth, height: sourceHeight } = getSourceDimensions(clip, layer, effectiveResolution);
  const bounds = activeTextBounds
    ? cloneTextBoundsPath(activeTextBounds)
    : resolveTextBoundsPath(textProperties, sourceWidth, sourceHeight);
  const box = resolveTextBoxRect({ ...textProperties, textBounds: bounds }, sourceWidth, sourceHeight);
  const projectionParams = {
    sourceWidth,
    sourceHeight,
    outputWidth: effectiveResolution.width,
    outputHeight: effectiveResolution.height,
    canvasWidth: canvasSize.width,
    canvasHeight: canvasSize.height,
    position: layer.position,
    scale: layer.scale,
    rotation: layer.rotation,
  };
  const toContainer = (point: OverlayPoint): OverlayPoint => ({
    x: canvasInContainer.x + point.x * viewZoom,
    y: canvasInContainer.y + point.y * viewZoom,
  });
  const projectSourcePoint = (sourceX: number, sourceY: number): OverlayPoint => toContainer(projectLayerUvToCanvas({
    x: sourceX / sourceWidth,
    y: sourceY / sourceHeight,
  }, projectionParams));

  const tl = projectSourcePoint(box.x, box.y);
  const tr = projectSourcePoint(box.x + box.width, box.y);
  const bl = projectSourcePoint(box.x, box.y + box.height);
  const width = atLeast(distance(tl, tr), 1);
  const height = atLeast(distance(tl, bl), 1);
  const vertices = bounds.vertices.map(vertex => ({
    vertex,
    point: projectSourcePoint(
      (vertex.x + bounds.position.x) * sourceWidth,
      (vertex.y + bounds.position.y) * sourceHeight,
    ),
  }));
  const edges = vertices.map((current, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return {
      id: `${current.vertex.id}-${next.vertex.id}`,
      fromVertexId: current.vertex.id,
      toVertexId: next.vertex.id,
      pathD: `M ${current.point.x} ${current.point.y} L ${next.point.x} ${next.point.y}`,
      midpoint: {
        x: (current.point.x + next.point.x) / 2,
        y: (current.point.y + next.point.y) / 2,
      },
    };
  });

  return {
    sourceWidth,
    sourceHeight,
    bounds,
    box,
    vertices,
    edges,
    pathD: buildSvgPath(bounds, sourceWidth, sourceHeight, projectSourcePoint),
    corners: { tl, tr, bl },
    width,
    height,
    rotation: Math.atan2(tr.y - tl.y, tr.x - tl.x),
    scaleX: width / Math.max(1, box.width),
    scaleY: height / Math.max(1, box.height),
    projectSourcePoint,
  };
}

export function sourcePointFromContainer(params: {
  point: OverlayPoint;
  geometry: EditorGeometry;
  canvasInContainer: { x: number; y: number };
  canvasSize: { width: number; height: number };
  effectiveResolution: { width: number; height: number };
  layer: Layer;
  viewZoom: number;
}): OverlayPoint {
  const { point, geometry, canvasInContainer, canvasSize, effectiveResolution, layer, viewZoom } = params;
  const canvasPoint = {
    x: (point.x - canvasInContainer.x) / Math.max(0.0001, viewZoom),
    y: (point.y - canvasInContainer.y) / Math.max(0.0001, viewZoom),
  };
  const uv = unprojectCanvasToLayerUv(canvasPoint, {
    sourceWidth: geometry.sourceWidth,
    sourceHeight: geometry.sourceHeight,
    outputWidth: effectiveResolution.width,
    outputHeight: effectiveResolution.height,
    canvasWidth: canvasSize.width,
    canvasHeight: canvasSize.height,
    position: layer.position,
    scale: layer.scale,
    rotation: layer.rotation,
    uvClampMin: -1000,
    uvClampMax: 1001,
  });

  return {
    x: uv.x * geometry.sourceWidth,
    y: uv.y * geometry.sourceHeight,
  };
}
