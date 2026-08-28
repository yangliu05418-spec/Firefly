import type { MaskPathKeyframeValue, TextBoundsPath } from '../../types/masks';
import type { TextClipProperties } from '../../types/text';
import {
  DEFAULT_BOX_HEIGHT_RATIO,
  DEFAULT_BOX_WIDTH_RATIO,
  MIN_BOX_HEIGHT,
  MIN_BOX_WIDTH,
  TEXT_BOUNDS_ID,
} from './textLayoutConstants';
import { clamp, finiteNumber } from './textLayoutMath';
import type { TextBoxRect } from './textLayoutTypes';

export function isAreaTextEnabled(props: Pick<TextClipProperties, 'boxEnabled'>): boolean {
  return props.boxEnabled === true;
}

function resolveLegacyTextBoxRect(
  props: Pick<TextClipProperties, 'boxX' | 'boxY' | 'boxWidth' | 'boxHeight'>,
  canvasWidth: number,
  canvasHeight: number,
): TextBoxRect {
  const safeWidth = Math.max(MIN_BOX_WIDTH, canvasWidth || 1920);
  const safeHeight = Math.max(MIN_BOX_HEIGHT, canvasHeight || 1080);
  const defaultWidth = safeWidth * DEFAULT_BOX_WIDTH_RATIO;
  const defaultHeight = safeHeight * DEFAULT_BOX_HEIGHT_RATIO;
  const defaultX = (safeWidth - defaultWidth) / 2;
  const defaultY = (safeHeight - defaultHeight) / 2;

  const x = clamp(finiteNumber(props.boxX, defaultX), 0, Math.max(0, safeWidth - MIN_BOX_WIDTH));
  const y = clamp(finiteNumber(props.boxY, defaultY), 0, Math.max(0, safeHeight - MIN_BOX_HEIGHT));
  const width = clamp(
    finiteNumber(props.boxWidth, defaultWidth),
    MIN_BOX_WIDTH,
    Math.max(MIN_BOX_WIDTH, safeWidth - x),
  );
  const height = clamp(
    finiteNumber(props.boxHeight, defaultHeight),
    MIN_BOX_HEIGHT,
    Math.max(MIN_BOX_HEIGHT, safeHeight - y),
  );

  return { x, y, width, height };
}

export function createTextBoundsFromRect(
  rect: TextBoxRect,
  canvasWidth: number,
  canvasHeight: number,
  id: string = TEXT_BOUNDS_ID,
  options: { clampToCanvas?: boolean } = {},
): TextBoundsPath {
  const safeWidth = Math.max(1, canvasWidth || 1920);
  const safeHeight = Math.max(1, canvasHeight || 1080);
  const shouldClamp = options.clampToCanvas !== false;
  const left = shouldClamp ? clamp(rect.x, 0, safeWidth) : rect.x;
  const top = shouldClamp ? clamp(rect.y, 0, safeHeight) : rect.y;
  const right = shouldClamp
    ? clamp(rect.x + Math.max(MIN_BOX_WIDTH, rect.width), 0, safeWidth)
    : rect.x + Math.max(MIN_BOX_WIDTH, rect.width);
  const bottom = shouldClamp
    ? clamp(rect.y + Math.max(MIN_BOX_HEIGHT, rect.height), 0, safeHeight)
    : rect.y + Math.max(MIN_BOX_HEIGHT, rect.height);

  return {
    id,
    closed: true,
    position: { x: 0, y: 0 },
    visible: true,
    outlineColor: '#ff3b30',
    vertices: [
      { id: 'tbv_tl', x: left / safeWidth, y: top / safeHeight, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
      { id: 'tbv_tr', x: right / safeWidth, y: top / safeHeight, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
      { id: 'tbv_br', x: right / safeWidth, y: bottom / safeHeight, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
      { id: 'tbv_bl', x: left / safeWidth, y: bottom / safeHeight, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
    ],
  };
}

export function createDefaultTextBoundsPath(canvasWidth: number, canvasHeight: number): TextBoundsPath {
  return createTextBoundsFromRect(resolveLegacyTextBoxRect({}, canvasWidth, canvasHeight), canvasWidth, canvasHeight);
}

export function cloneTextBoundsPath(bounds: TextBoundsPath): TextBoundsPath {
  return {
    ...bounds,
    position: { ...bounds.position },
    vertices: bounds.vertices.map(vertex => ({
      ...vertex,
      handleIn: { ...vertex.handleIn },
      handleOut: { ...vertex.handleOut },
    })),
  };
}

export function getTextBoundsPathValue(bounds: TextBoundsPath): MaskPathKeyframeValue {
  return {
    closed: bounds.closed,
    vertices: cloneTextBoundsPath(bounds).vertices,
  };
}

export function applyTextBoundsPathValue(
  bounds: TextBoundsPath,
  value: MaskPathKeyframeValue,
): TextBoundsPath {
  return {
    ...bounds,
    closed: value.closed,
    vertices: value.vertices.map(vertex => ({
      ...vertex,
      handleIn: { ...vertex.handleIn },
      handleOut: { ...vertex.handleOut },
    })),
  };
}

export function getTextBoundsBoundingBox(
  bounds: TextBoundsPath,
  canvasWidth: number,
  canvasHeight: number,
): TextBoxRect {
  const safeWidth = Math.max(1, canvasWidth || 1920);
  const safeHeight = Math.max(1, canvasHeight || 1080);
  if (bounds.vertices.length === 0) {
    return resolveLegacyTextBoxRect({}, safeWidth, safeHeight);
  }

  const xs = bounds.vertices.map(vertex => (vertex.x + bounds.position.x) * safeWidth);
  const ys = bounds.vertices.map(vertex => (vertex.y + bounds.position.y) * safeHeight);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(MIN_BOX_WIDTH, Math.max(...xs) - x);
  const height = Math.max(MIN_BOX_HEIGHT, Math.max(...ys) - y);
  return { x, y, width, height };
}

export function resolveTextBoundsPath(
  props: Pick<TextClipProperties, 'textBounds' | 'boxX' | 'boxY' | 'boxWidth' | 'boxHeight'>,
  canvasWidth: number,
  canvasHeight: number,
): TextBoundsPath {
  if (props.textBounds?.vertices?.length) {
    return cloneTextBoundsPath(props.textBounds);
  }
  return createTextBoundsFromRect(resolveLegacyTextBoxRect(props, canvasWidth, canvasHeight), canvasWidth, canvasHeight);
}

export function resolveTextBoxRect(
  props: Pick<TextClipProperties, 'textBounds' | 'boxX' | 'boxY' | 'boxWidth' | 'boxHeight'>,
  canvasWidth: number,
  canvasHeight: number,
): TextBoxRect {
  if (props.textBounds?.vertices?.length) {
    return getTextBoundsBoundingBox(props.textBounds, canvasWidth, canvasHeight);
  }
  return resolveLegacyTextBoxRect(props, canvasWidth, canvasHeight);
}

export function traceTextBoundsPath(
  ctx: Pick<CanvasRenderingContext2D, 'beginPath' | 'moveTo' | 'lineTo' | 'bezierCurveTo' | 'closePath'>,
  bounds: TextBoundsPath,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const vertices = bounds.vertices;
  ctx.beginPath();
  if (vertices.length === 0) return;

  const toCanvas = (vertex: { x: number; y: number }) => ({
    x: (vertex.x + bounds.position.x) * canvasWidth,
    y: (vertex.y + bounds.position.y) * canvasHeight,
  });

  const first = toCanvas(vertices[0]);
  ctx.moveTo(first.x, first.y);

  for (let index = 1; index < vertices.length; index += 1) {
    const previous = vertices[index - 1];
    const current = vertices[index];
    const start = toCanvas(previous);
    const end = toCanvas(current);
    const cp1 = {
      x: start.x + previous.handleOut.x * canvasWidth,
      y: start.y + previous.handleOut.y * canvasHeight,
    };
    const cp2 = {
      x: end.x + current.handleIn.x * canvasWidth,
      y: end.y + current.handleIn.y * canvasHeight,
    };
    if (
      previous.handleOut.x === 0 &&
      previous.handleOut.y === 0 &&
      current.handleIn.x === 0 &&
      current.handleIn.y === 0
    ) {
      ctx.lineTo(end.x, end.y);
    } else {
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y);
    }
  }

  if (bounds.closed && vertices.length > 1) {
    const previous = vertices[vertices.length - 1];
    const current = vertices[0];
    const start = toCanvas(previous);
    const end = toCanvas(current);
    const cp1 = {
      x: start.x + previous.handleOut.x * canvasWidth,
      y: start.y + previous.handleOut.y * canvasHeight,
    };
    const cp2 = {
      x: end.x + current.handleIn.x * canvasWidth,
      y: end.y + current.handleIn.y * canvasHeight,
    };
    if (
      previous.handleOut.x === 0 &&
      previous.handleOut.y === 0 &&
      current.handleIn.x === 0 &&
      current.handleIn.y === 0
    ) {
      ctx.closePath();
    } else {
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y);
      ctx.closePath();
    }
  }
}
