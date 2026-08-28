import { type Dispatch, type MouseEvent as ReactMouseEvent, type RefObject, type SetStateAction, useCallback } from 'react';
import { endBatch, startBatch } from '../../../stores/historyStore';
import { inferMaskVertexHandleMode } from '../../../utils/maskVertexHandles';
import type { ClipMask, MaskVertex } from "../../../types/masks";
import type { TimelineClip } from "../../../types/timeline";
import {
  constrainHandleDelta,
  getNearestMaskEdgeInsert,
  splitMaskSegment,
} from './maskOverlayGeometry';
import type { MaskOverlayPoint, PenEdgeInsertPreview, ProjectMaskPoint } from './maskOverlayTypes';

interface UsePenMaskDrawParams {
  svgRef: RefObject<SVGSVGElement | null>;
  canvasWidth: number;
  canvasHeight: number;
  selectedClip: TimelineClip | undefined;
  activeMask: ClipMask | undefined;
  maskEditMode: string;
  getCanvasPoint: (event: MouseEvent | ReactMouseEvent) => MaskOverlayPoint | null;
  getNormalizedPoint: (event: MouseEvent | ReactMouseEvent) => MaskOverlayPoint | null;
  projectMaskPoint: ProjectMaskPoint;
  addMask: (clipId: string, mask: Partial<ClipMask>) => string;
  addVertex: (clipId: string, maskId: string, vertex: Omit<MaskVertex, 'id'>, insertIndex?: number) => string;
  selectVertex: (vertexId: string, addToSelection?: boolean) => void;
  setActiveMask: (clipId: string, maskId: string) => void;
  setMaskEditMode: (mode: 'drawingPen') => void;
  setPenInsertPreview: Dispatch<SetStateAction<PenEdgeInsertPreview | null>>;
  updateVertex: (
    clipId: string,
    maskId: string,
    vertexId: string,
    updates: Partial<MaskVertex>,
    transient?: boolean,
  ) => void;
}

export function usePenMaskDraw({
  svgRef,
  canvasWidth,
  canvasHeight,
  selectedClip,
  activeMask,
  maskEditMode,
  getCanvasPoint,
  getNormalizedPoint,
  projectMaskPoint,
  addMask,
  addVertex,
  selectVertex,
  setActiveMask,
  setMaskEditMode,
  setPenInsertPreview,
  updateVertex,
}: UsePenMaskDrawParams) {
  const handlePenMouseDown = useCallback((e: ReactMouseEvent<SVGSVGElement>): boolean => {
    if (!selectedClip || maskEditMode !== 'drawingPen') return false;
    if (e.button !== 0 || e.target !== svgRef.current) return false;

    const startPoint = getNormalizedPoint(e);
    const startCanvasPoint = getCanvasPoint(e);
    if (!startPoint) return false;

    e.preventDefault();
    e.stopPropagation();
    startBatch('Add mask vertex');

    const insertPreview = activeMask
      ? getNearestMaskEdgeInsert(
          activeMask,
          startPoint,
          canvasWidth,
          canvasHeight,
          12,
          projectMaskPoint,
          startCanvasPoint ?? undefined,
        )
      : null;

    if (activeMask && insertPreview) {
      const split = splitMaskSegment(activeMask, insertPreview);
      if (split) {
        const prevVertex = activeMask.vertices.find(vertex => vertex.id === insertPreview.prevVertexId);
        const nextVertex = activeMask.vertices.find(vertex => vertex.id === insertPreview.nextVertexId);
        updateVertex(selectedClip.id, activeMask.id, insertPreview.prevVertexId, {
          handleOut: split.prevHandleOut,
          ...(prevVertex
            ? { handleMode: inferMaskVertexHandleMode({ ...prevVertex, handleOut: split.prevHandleOut }) }
            : {}),
        }, true);
        updateVertex(selectedClip.id, activeMask.id, insertPreview.nextVertexId, {
          handleIn: split.nextHandleIn,
          ...(nextVertex
            ? { handleMode: inferMaskVertexHandleMode({ ...nextVertex, handleIn: split.nextHandleIn }) }
            : {}),
        }, true);
        const insertedVertexId = addVertex(selectedClip.id, activeMask.id, split.vertex, insertPreview.insertIndex);
        selectVertex(insertedVertexId, false);
        setMaskEditMode('drawingPen');
        setPenInsertPreview(null);
        endBatch();
        return true;
      }
    }

    const maskId = activeMask && !activeMask.closed
      ? activeMask.id
      : addMask(selectedClip.id, { name: 'Pen Mask' });

    if (!activeMask || activeMask.closed) {
      setActiveMask(selectedClip.id, maskId);
    }

    const vertexId = addVertex(selectedClip.id, maskId, {
      x: startPoint.x,
      y: startPoint.y,
      handleIn: { x: 0, y: 0 },
      handleOut: { x: 0, y: 0 },
    });
    selectVertex(vertexId, false);
    setMaskEditMode('drawingPen');

    let didDrag = false;
    let latestHandle = { x: 0, y: 0 };
    let latestBroken = false;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const currentPoint = getNormalizedPoint(moveEvent);
      if (!currentPoint) return;

      const rawDx = currentPoint.x - startPoint.x;
      const rawDy = currentPoint.y - startPoint.y;
      const distancePx = Math.hypot(rawDx * canvasWidth, rawDy * canvasHeight);
      if (distancePx < 3 && !didDrag) return;

      didDrag = true;
      latestHandle = constrainHandleDelta(rawDx, rawDy, moveEvent.shiftKey);
      latestBroken = moveEvent.altKey;

      updateVertex(selectedClip.id, maskId, vertexId, {
        handleIn: latestBroken ? { x: 0, y: 0 } : { x: -latestHandle.x, y: -latestHandle.y },
        handleOut: latestHandle,
        handleMode: latestBroken ? 'split' : 'mirrored',
      }, true);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (didDrag) {
        updateVertex(selectedClip.id, maskId, vertexId, {
          handleIn: latestBroken ? { x: 0, y: 0 } : { x: -latestHandle.x, y: -latestHandle.y },
          handleOut: latestHandle,
          handleMode: latestBroken ? 'split' : 'mirrored',
        });
      }
      endBatch();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return true;
  }, [
    activeMask,
    addMask,
    addVertex,
    canvasHeight,
    canvasWidth,
    getCanvasPoint,
    getNormalizedPoint,
    maskEditMode,
    projectMaskPoint,
    selectedClip,
    selectVertex,
    setActiveMask,
    setMaskEditMode,
    setPenInsertPreview,
    svgRef,
    updateVertex,
  ]);

  return { handlePenMouseDown };
}
