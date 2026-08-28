import type { MouseEvent as ReactMouseEvent } from 'react';
import type { MaskVertex } from "../../../types/masks";

export type MaskOverlayPoint = { x: number; y: number };

export interface PenEdgeInsertPreview {
  insertIndex: number;
  prevVertexId: string;
  nextVertexId: string;
  t: number;
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
}

export interface SplitSegmentResult {
  vertex: Omit<MaskVertex, 'id'>;
  prevHandleOut: MaskOverlayPoint;
  nextHandleIn: MaskOverlayPoint;
}

export type CanvasMaskVertex = MaskVertex;

export interface VisibleMaskPath {
  id: string;
  d: string;
  closed: boolean;
  color: string;
}

export interface MaskEdgeSegment {
  d: string;
  idA: string;
  idB: string;
  fromIndex: number;
  toIndex: number;
}

export type MaskOverlayMouseEvent =
  | MouseEvent
  | ReactMouseEvent<Element>
  | ReactMouseEvent<SVGSVGElement>;

export type ProjectMaskPoint = (point: MaskOverlayPoint) => MaskOverlayPoint;
