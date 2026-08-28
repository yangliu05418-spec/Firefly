import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createTextBoundsNumericProperty } from "../../types/animationProperties";
import type { MaskVertex, TextBoundsPath } from "../../types/masks";
import {
  createTextBoundsFromRect,
} from '../../services/textLayout';
import type { OverlayPoint } from './editModeOverlayMath';
import { TextPreviewChrome } from './textPreview/TextPreviewChrome';
import {
  buildTextEditorGeometry,
  roundNormalizedToPixel,
  sourcePointFromContainer as resolveSourcePointFromContainer,
} from './textPreview/textPreviewGeometry';
import {
  buildSelectionPolygons,
  buildTextEditorStyle,
} from './textPreview/textPreviewLayout';
import type {
  DragKind,
  DragState,
  EditorGeometry,
  TextPreviewEditorProps,
} from './textPreview/textPreviewTypes';
import { useTextSelectionState } from './textPreview/useTextSelectionState';
import {
  getCanvasSnapPoints,
  getRectSnapPoints,
  resolveSnapDelta,
  snapPointToTargets,
  type AxisSnapPoints,
} from './editModeSnapping';

function shouldMoveWholeText(event: Pick<ReactPointerEvent, 'ctrlKey' | 'metaKey'>): boolean {
  return event.ctrlKey || event.metaKey;
}

const TEXT_SNAP_THRESHOLD_SOURCE_PX = 10;

function getTextBoundsSourceRect(
  bounds: TextBoundsPath,
  sourceWidth: number,
  sourceHeight: number,
  position: TextBoundsPath['position'] = bounds.position,
) {
  const xs = bounds.vertices.map((vertex) => (vertex.x + position.x) * sourceWidth);
  const ys = bounds.vertices.map((vertex) => (vertex.y + position.y) * sourceHeight);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

export function TextPreviewEditor({
  clip,
  layer,
  effectiveResolution,
  canvasSize,
  canvasInContainer,
  viewZoom,
  enabled,
  activeTextBounds,
  updateTextProperties,
  updateTextBoundsVertex,
  updateTextBoundsVertices,
  setPropertyValue,
}: TextPreviewEditorProps) {
  const textProperties = clip.textProperties;
  const layerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const selectAllOnFocusRef = useRef(false);
  const [draftText, setDraftText] = useState(textProperties?.text ?? '');
  const [isEditing, setIsEditing] = useState(false);
  const [dragSelection, setDragSelection] = useState<{ start: OverlayPoint; current: OverlayPoint } | null>(null);
  const {
    textSelection,
    setTextSelection,
    syncTextSelection,
  } = useTextSelectionState({ textareaRef, isEditing });

  useEffect(() => {
    if (!isEditing) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) {
          setDraftText(textProperties?.text ?? '');
        }
      });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [clip.id, isEditing, textProperties?.text]);

  useEffect(() => {
    dragStateRef.current = null;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setDragSelection(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [clip.id, enabled]);

  const geometry = useMemo<EditorGeometry | null>(() => {
    if (!textProperties) return null;
    return buildTextEditorGeometry({
      clip,
      layer,
      textProperties,
      activeTextBounds,
      effectiveResolution,
      canvasSize,
      canvasInContainer,
      viewZoom,
    });
  }, [
    activeTextBounds,
    canvasInContainer,
    canvasSize,
    clip,
    effectiveResolution,
    layer,
    textProperties,
    viewZoom,
  ]);

  const focusEditor = useCallback((selectAll = false) => {
    selectAllOnFocusRef.current = selectAll;
    setIsEditing(true);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      if (selectAllOnFocusRef.current) {
        textarea.select();
        selectAllOnFocusRef.current = false;
      }
      syncTextSelection();
    });
  }, [syncTextSelection]);

  const sourcePointFromContainer = useCallback((point: OverlayPoint): OverlayPoint | null => {
    if (!geometry) return null;
    return resolveSourcePointFromContainer({
      point,
      geometry,
      canvasInContainer,
      canvasSize,
      effectiveResolution,
      layer,
      viewZoom,
    });
  }, [
    canvasInContainer,
    canvasSize,
    effectiveResolution,
    geometry,
    layer,
    viewZoom,
  ]);

  const sourceSnapTargets = useMemo<AxisSnapPoints | null>(() => (
    geometry ? getCanvasSnapPoints(geometry.sourceWidth, geometry.sourceHeight) : null
  ), [geometry]);

  const snapSourcePoint = useCallback((
    point: OverlayPoint,
    axes: { x?: boolean; y?: boolean } = { x: true, y: true },
  ): OverlayPoint => (
    sourceSnapTargets
      ? snapPointToTargets(point, sourceSnapTargets, TEXT_SNAP_THRESHOLD_SOURCE_PX, axes)
      : point
  ), [sourceSnapTargets]);

  const applyMoveDrag = useCallback((drag: DragState, point: OverlayPoint, snapToGuides = false) => {
    if (!geometry) return;
    const start = sourcePointFromContainer(drag.start);
    const current = sourcePointFromContainer(point);
    if (!start || !current) return;
    let nextX = drag.startBounds.position.x + (current.x - start.x) / geometry.sourceWidth;
    let nextY = drag.startBounds.position.y + (current.y - start.y) / geometry.sourceHeight;
    if (snapToGuides && sourceSnapTargets) {
      const snapDelta = resolveSnapDelta(
        getRectSnapPoints(getTextBoundsSourceRect(
          drag.startBounds,
          geometry.sourceWidth,
          geometry.sourceHeight,
          { x: nextX, y: nextY },
        )),
        sourceSnapTargets,
        TEXT_SNAP_THRESHOLD_SOURCE_PX,
      );
      nextX += snapDelta.x / geometry.sourceWidth;
      nextY += snapDelta.y / geometry.sourceHeight;
    }
    setPropertyValue(clip.id, createTextBoundsNumericProperty('position.x'), nextX);
    setPropertyValue(clip.id, createTextBoundsNumericProperty('position.y'), nextY);
  }, [clip.id, geometry, setPropertyValue, sourcePointFromContainer, sourceSnapTargets]);

  const applyVertexDrag = useCallback((drag: DragState, point: OverlayPoint, recordKeyframe: boolean, freeMove = false, snapToGuides = false) => {
    if (!geometry || !drag.vertexId) return;
    const startVertex = drag.startBounds.vertices.find(vertex => vertex.id === drag.vertexId);
    if (!startVertex) return;
    const startPoint = drag.startSourcePoint ?? sourcePointFromContainer(drag.start);
    const sourcePoint = sourcePointFromContainer(point);
    if (!startPoint || !sourcePoint) return;
    const dx = (sourcePoint.x - startPoint.x) / geometry.sourceWidth;
    const dy = (sourcePoint.y - startPoint.y) / geometry.sourceHeight;

    const startVertices = drag.startBounds.vertices;
    // Default: corner handles resize the box rectangularly (normal handles).
    // Hold Ctrl (freeMove) to drag a single vertex freely for skew/perspective. (#205)
    if (!freeMove && startVertices.length === 4) {
      const minX = Math.min(...startVertices.map(v => v.x));
      const maxX = Math.max(...startVertices.map(v => v.x));
      const minY = Math.min(...startVertices.map(v => v.y));
      const maxY = Math.max(...startVertices.map(v => v.y));
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const draggedLeft = startVertex.x <= centerX;
      const draggedTop = startVertex.y <= centerY;
      let newX = startVertex.x + dx;
      let newY = startVertex.y + dy;
      if (snapToGuides) {
        const snappedPoint = snapSourcePoint({
          x: (newX + drag.startBounds.position.x) * geometry.sourceWidth,
          y: (newY + drag.startBounds.position.y) * geometry.sourceHeight,
        });
        newX = snappedPoint.x / geometry.sourceWidth - drag.startBounds.position.x;
        newY = snappedPoint.y / geometry.sourceHeight - drag.startBounds.position.y;
      }
      const resetHandles = {
        handleIn: { x: 0, y: 0 },
        handleOut: { x: 0, y: 0 },
        handleMode: 'none' as const,
      };
      const vertexUpdates = startVertices.map((vertex) => ({
        vertexId: vertex.id,
        updates: {
          ...resetHandles,
          x: (vertex.x <= centerX) === draggedLeft ? newX : vertex.x,
          y: (vertex.y <= centerY) === draggedTop ? newY : vertex.y,
        },
      }));
      updateTextBoundsVertices(clip.id, vertexUpdates, recordKeyframe);
      return;
    }

    const nextPoint = snapToGuides
      ? snapSourcePoint({
        x: (startVertex.x + dx + drag.startBounds.position.x) * geometry.sourceWidth,
        y: (startVertex.y + dy + drag.startBounds.position.y) * geometry.sourceHeight,
      })
      : null;
    updateTextBoundsVertex(clip.id, drag.vertexId, {
      x: nextPoint ? nextPoint.x / geometry.sourceWidth - drag.startBounds.position.x : startVertex.x + dx,
      y: nextPoint ? nextPoint.y / geometry.sourceHeight - drag.startBounds.position.y : startVertex.y + dy,
    }, recordKeyframe);
  }, [clip.id, geometry, snapSourcePoint, sourcePointFromContainer, updateTextBoundsVertex, updateTextBoundsVertices]);

  const applyEdgeDrag = useCallback((
    drag: DragState,
    point: OverlayPoint,
    recordKeyframe: boolean,
    snapStraight: boolean,
    snapToGuides = false,
  ) => {
    if (!geometry || !drag.edgeVertexIds) return;
    const startPoint = drag.startSourcePoint ?? sourcePointFromContainer(drag.start);
    const sourcePoint = sourcePointFromContainer(point);
    if (!startPoint || !sourcePoint) return;
    const dx = (sourcePoint.x - startPoint.x) / geometry.sourceWidth;
    const dy = (sourcePoint.y - startPoint.y) / geometry.sourceHeight;
    const movedVertices: Array<{ vertexId: string; startVertex: MaskVertex; x: number; y: number }> = [];
    for (const vertexId of drag.edgeVertexIds) {
      const startVertex = drag.startBounds.vertices.find(vertex => vertex.id === vertexId);
      if (!startVertex) continue;
      movedVertices.push({
        vertexId,
        startVertex,
        x: startVertex.x + dx,
        y: startVertex.y + dy,
      });
    }
    if (movedVertices.length === 0) return;

    if (snapToGuides && sourceSnapTargets) {
      const snapDelta = resolveSnapDelta(
        {
          x: movedVertices.map((entry) => (entry.x + drag.startBounds.position.x) * geometry.sourceWidth),
          y: movedVertices.map((entry) => (entry.y + drag.startBounds.position.y) * geometry.sourceHeight),
        },
        sourceSnapTargets,
        TEXT_SNAP_THRESHOLD_SOURCE_PX,
      );
      for (const entry of movedVertices) {
        entry.x += snapDelta.x / geometry.sourceWidth;
        entry.y += snapDelta.y / geometry.sourceHeight;
      }
    }

    const resetHandles = {
      handleIn: { x: 0, y: 0 },
      handleOut: { x: 0, y: 0 },
      handleMode: 'none' as const,
    };
    const vertexUpdates: Array<{ vertexId: string; updates: Partial<MaskVertex> }> = movedVertices.map((entry) => ({
      vertexId: entry.vertexId,
      updates: { x: entry.x, y: entry.y },
    }));

    if (snapStraight && movedVertices.length === 2) {
      const [from, to] = movedVertices;
      const edgeWidth = Math.abs((to.startVertex.x - from.startVertex.x) * geometry.sourceWidth);
      const edgeHeight = Math.abs((to.startVertex.y - from.startVertex.y) * geometry.sourceHeight);
      const startVertices = drag.startBounds.vertices;

      if (startVertices.length === 4) {
        const draggedVertexIds = new Set(drag.edgeVertexIds);
        const minX = Math.min(...startVertices.map(vertex => vertex.x));
        const maxX = Math.max(...startVertices.map(vertex => vertex.x));
        const minY = Math.min(...startVertices.map(vertex => vertex.y));
        const maxY = Math.max(...startVertices.map(vertex => vertex.y));
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const edgeCenterX = (from.startVertex.x + to.startVertex.x) / 2;
        const edgeCenterY = (from.startVertex.y + to.startVertex.y) / 2;

        vertexUpdates.length = 0;
        if (edgeWidth >= edgeHeight) {
          const draggedY = roundNormalizedToPixel((from.y + to.y) / 2, geometry.sourceHeight);
          const oppositeY = edgeCenterY <= centerY ? maxY : minY;
          for (const vertex of startVertices) {
            vertexUpdates.push({
              vertexId: vertex.id,
              updates: {
                ...resetHandles,
                x: vertex.x <= centerX ? minX : maxX,
                y: draggedVertexIds.has(vertex.id) ? draggedY : oppositeY,
              },
            });
          }
        } else {
          const draggedX = roundNormalizedToPixel((from.x + to.x) / 2, geometry.sourceWidth);
          const oppositeX = edgeCenterX <= centerX ? maxX : minX;
          for (const vertex of startVertices) {
            vertexUpdates.push({
              vertexId: vertex.id,
              updates: {
                ...resetHandles,
                x: draggedVertexIds.has(vertex.id) ? draggedX : oppositeX,
                y: vertex.y <= centerY ? minY : maxY,
              },
            });
          }
        }
      } else if (edgeWidth >= edgeHeight) {
        const y = roundNormalizedToPixel((from.y + to.y) / 2, geometry.sourceHeight);
        vertexUpdates[0] = { vertexId: from.vertexId, updates: { ...resetHandles, x: from.x, y } };
        vertexUpdates[1] = { vertexId: to.vertexId, updates: { ...resetHandles, x: to.x, y } };
      } else {
        const x = roundNormalizedToPixel((from.x + to.x) / 2, geometry.sourceWidth);
        vertexUpdates[0] = { vertexId: from.vertexId, updates: { ...resetHandles, x, y: from.y } };
        vertexUpdates[1] = { vertexId: to.vertexId, updates: { ...resetHandles, x, y: to.y } };
      }
    }

    if (vertexUpdates.length === 0) return;
    updateTextBoundsVertices(clip.id, vertexUpdates, recordKeyframe);
  }, [clip.id, geometry, sourcePointFromContainer, sourceSnapTargets, updateTextBoundsVertices]);

  const straightenEdge = useCallback((fromVertexId: string, toVertexId: string) => {
    if (!geometry) return;
    const from = geometry.bounds.vertices.find(vertex => vertex.id === fromVertexId);
    const to = geometry.bounds.vertices.find(vertex => vertex.id === toVertexId);
    if (!from || !to) return;

    const dx = Math.abs((to.x - from.x) * geometry.sourceWidth);
    const dy = Math.abs((to.y - from.y) * geometry.sourceHeight);
    const resetHandles = {
      handleIn: { x: 0, y: 0 },
      handleOut: { x: 0, y: 0 },
      handleMode: 'none' as const,
    };

    if (dx >= dy) {
      const y = roundNormalizedToPixel((from.y + to.y) / 2, geometry.sourceHeight);
      updateTextBoundsVertices(clip.id, [
        { vertexId: fromVertexId, updates: { ...resetHandles, y } },
        { vertexId: toVertexId, updates: { ...resetHandles, y } },
      ], true);
      return;
    }

    const x = roundNormalizedToPixel((from.x + to.x) / 2, geometry.sourceWidth);
    updateTextBoundsVertices(clip.id, [
      { vertexId: fromVertexId, updates: { ...resetHandles, x } },
      { vertexId: toVertexId, updates: { ...resetHandles, x } },
    ], true);
  }, [clip.id, geometry, updateTextBoundsVertices]);

  const finishDrag = useCallback((target: HTMLElement, pointerId: number, finalPoint?: OverlayPoint, freeMove = false, snapToGuides = false) => {
    const drag = dragStateRef.current;
    dragStateRef.current = null;
    setDragSelection(null);

    try {
      target.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }

    if (!drag || !geometry || !textProperties) return;
    const current = finalPoint ?? drag.current;

    if (drag.kind === 'move') {
      applyMoveDrag(drag, current, snapToGuides);
      return;
    }

    if (drag.kind === 'vertex') {
      applyVertexDrag(drag, current, true, freeMove, snapToGuides);
      return;
    }

    if (drag.kind === 'edge') {
      applyEdgeDrag(drag, current, true, !freeMove, snapToGuides);
      return;
    }

    const dragDistance = Math.hypot(current.x - drag.start.x, current.y - drag.start.y);
    if (dragDistance < 6) {
      focusEditor();
      return;
    }

    const rawStart = sourcePointFromContainer(drag.start);
    const rawEnd = sourcePointFromContainer(current);
    if (!rawStart || !rawEnd) return;
    const start = snapToGuides ? snapSourcePoint(rawStart) : rawStart;
    const end = snapToGuides ? snapSourcePoint(rawEnd) : rawEnd;

    const x = Math.round(Math.min(start.x, end.x));
    const y = Math.round(Math.min(start.y, end.y));
    const width = Math.round(Math.abs(end.x - start.x));
    const height = Math.round(Math.abs(end.y - start.y));

    if (width < 24 || height < 24) {
      focusEditor();
      return;
    }

    const box = {
      x,
      y,
      width: Math.max(24, width),
      height: Math.max(24, height),
    };
    updateTextProperties(clip.id, {
      boxEnabled: true,
      boxX: box.x,
      boxY: box.y,
      boxWidth: box.width,
      boxHeight: box.height,
      textBounds: createTextBoundsFromRect(box, geometry.sourceWidth, geometry.sourceHeight, undefined, { clampToCanvas: false }),
    });
    focusEditor(true);
  }, [
    applyMoveDrag,
    applyEdgeDrag,
    applyVertexDrag,
    clip.id,
    focusEditor,
    geometry,
    snapSourcePoint,
    sourcePointFromContainer,
    textProperties,
    updateTextProperties,
  ]);

  const beginDrag = useCallback((
    event: ReactPointerEvent<Element>,
    kind: DragKind,
    vertexId?: string,
    edgeVertexIds?: [string, string],
  ) => {
    if (!enabled || event.button !== 0 || event.altKey || !geometry) return;
    const captureElement = layerRef.current;
    if (!captureElement) return;
    const rect = captureElement.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    dragStateRef.current = {
      kind,
      pointerId: event.pointerId,
      start: point,
      current: point,
      startBounds: geometry.bounds,
      startSourcePoint: kind === 'vertex' || kind === 'edge' ? sourcePointFromContainer(point) ?? undefined : undefined,
      vertexId,
      edgeVertexIds,
    };
    setDragSelection(kind === 'create' ? { start: point, current: point } : null);
    captureElement.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }, [enabled, geometry, sourcePointFromContainer]);

  const handleCapturePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (shouldMoveWholeText(event)) {
      beginDrag(event, 'move');
      return;
    }
    beginDrag(event, 'create');
  }, [beginDrag]);

  const handleInputPointerDown = useCallback((event: ReactPointerEvent<HTMLTextAreaElement>) => {
    if (shouldMoveWholeText(event)) {
      beginDrag(event, 'move');
      return;
    }
    event.stopPropagation();
    focusEditor();
  }, [beginDrag, focusEditor]);

  const handleVertexPointerDown = useCallback((event: ReactPointerEvent<SVGRectElement>, vertexId: string) => {
    // Ctrl on a handle = free vertex movement (handled during the drag), not
    // move-whole-text — so corner handles stay usable with Ctrl. (#205)
    beginDrag(event, 'vertex', vertexId);
  }, [beginDrag]);

  const handleEdgePointerDown = useCallback((
    event: ReactPointerEvent<SVGElement>,
    fromVertexId: string,
    toVertexId: string,
  ) => {
    beginDrag(event, 'edge', undefined, [fromVertexId, toVertexId]);
  }, [beginDrag]);

  const handleEdgeDoubleClick = useCallback((
    event: ReactMouseEvent<SVGElement>,
    fromVertexId: string,
    toVertexId: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    straightenEdge(fromVertexId, toVertexId);
  }, [straightenEdge]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    drag.current = point;
    if (drag.kind === 'create') {
      setDragSelection({ start: drag.start, current: point });
    } else if (drag.kind === 'move') {
      applyMoveDrag(drag, point, event.shiftKey);
    } else if (drag.kind === 'vertex') {
      // Default = rectangular resize; Ctrl = free vertex. (#205)
      applyVertexDrag(drag, point, true, event.ctrlKey || event.metaKey, event.shiftKey);
    } else if (drag.kind === 'edge') {
      // Default = keep the box rectangular (no Shift needed); Ctrl = free edge. (#205)
      applyEdgeDrag(drag, point, true, !(event.ctrlKey || event.metaKey), event.shiftKey);
    }
    event.preventDefault();
    event.stopPropagation();
  }, [applyEdgeDrag, applyMoveDrag, applyVertexDrag]);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    finishDrag(event.currentTarget, event.pointerId, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }, event.ctrlKey || event.metaKey, event.shiftKey);
    event.preventDefault();
    event.stopPropagation();
  }, [finishDrag]);

  const handleTextChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextText = event.target.value;
    setDraftText(nextText);
    setTextSelection({
      start: Math.min(event.target.selectionStart, event.target.selectionEnd),
      end: Math.max(event.target.selectionStart, event.target.selectionEnd),
    });
    updateTextProperties(clip.id, { text: nextText });
  }, [clip.id, setTextSelection, updateTextProperties]);

  const handleTextKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      textareaRef.current?.blur();
    }
  }, []);

  const handleTextFocus = useCallback(() => {
    setIsEditing(true);
    syncTextSelection();
  }, [syncTextSelection]);

  const handleTextBlur = useCallback(() => {
    setIsEditing(false);
    setTextSelection({ start: 0, end: 0 });
  }, [setTextSelection]);

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    finishDrag(event.currentTarget, event.pointerId);
  }, [finishDrag]);

  const editorStyle = useMemo(() => {
    if (!geometry || !textProperties) return null;
    return buildTextEditorStyle({
      geometry,
      textProperties,
      draftText,
      isEditing,
    });
  }, [draftText, geometry, isEditing, textProperties]);

  const selectionPolygons = useMemo(() => {
    if (!geometry || !textProperties) return [];
    return buildSelectionPolygons({
      geometry,
      textProperties,
      draftText,
      isEditing,
      textSelection,
    });
  }, [draftText, geometry, isEditing, textProperties, textSelection]);

  const selectionClipPathId = `preview-text-selection-clip-${clip.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  if (!enabled || !textProperties || !geometry || !editorStyle) {
    return null;
  }

  return (
    <TextPreviewChrome
      layerRef={layerRef}
      textareaRef={textareaRef}
      isEditing={isEditing}
      draftText={draftText}
      editorStyle={editorStyle}
      geometry={geometry}
      dragSelection={dragSelection}
      selectionPolygons={selectionPolygons}
      selectionClipPathId={selectionClipPathId}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onCapturePointerDown={handleCapturePointerDown}
      onTextChange={handleTextChange}
      onTextFocus={handleTextFocus}
      onTextBlur={handleTextBlur}
      onTextKeyDown={handleTextKeyDown}
      onTextSelectionSync={syncTextSelection}
      onInputPointerDown={handleInputPointerDown}
      onEdgePointerDown={handleEdgePointerDown}
      onEdgeDoubleClick={handleEdgeDoubleClick}
      onVertexPointerDown={handleVertexPointerDown}
    />
  );
}
