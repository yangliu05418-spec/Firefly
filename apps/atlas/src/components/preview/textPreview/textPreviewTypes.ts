import type { createTextBoundsNumericProperty } from "../../../types/animationProperties";
import type { Layer } from "../../../types/layers";
import type { MaskVertex, TextBoundsPath } from "../../../types/masks";
import type { TextClipProperties } from "../../../types/text";
import type { TimelineClip } from "../../../types/timeline";
import type { OverlayPoint } from '../editModeOverlayMath';
import type { resolveTextBoxRect } from '../../../services/textLayout';

export interface TextPreviewEditorProps {
  clip: TimelineClip;
  layer: Layer;
  effectiveResolution: { width: number; height: number };
  canvasSize: { width: number; height: number };
  canvasInContainer: { x: number; y: number; width: number; height: number };
  viewZoom: number;
  enabled: boolean;
  activeTextBounds?: TextBoundsPath;
  updateTextProperties: (clipId: string, props: Partial<TextClipProperties>) => void;
  updateTextBoundsVertex: (clipId: string, vertexId: string, updates: Partial<MaskVertex>, recordKeyframe?: boolean) => void;
  updateTextBoundsVertices: (clipId: string, vertexUpdates: Array<{ vertexId: string; updates: Partial<MaskVertex> }>, recordKeyframe?: boolean) => void;
  setPropertyValue: (clipId: string, property: ReturnType<typeof createTextBoundsNumericProperty>, value: number) => void;
}

export type DragKind = 'create' | 'move' | 'vertex' | 'edge';

export interface DragState {
  kind: DragKind;
  pointerId: number;
  start: OverlayPoint;
  current: OverlayPoint;
  startBounds: TextBoundsPath;
  startSourcePoint?: OverlayPoint;
  vertexId?: string;
  edgeVertexIds?: [string, string];
}

export interface ProjectedVertex {
  vertex: MaskVertex;
  point: OverlayPoint;
}

export interface ProjectedEdge {
  id: string;
  fromVertexId: string;
  toVertexId: string;
  pathD: string;
  midpoint: OverlayPoint;
}

export interface EditorGeometry {
  sourceWidth: number;
  sourceHeight: number;
  bounds: TextBoundsPath;
  box: ReturnType<typeof resolveTextBoxRect>;
  vertices: ProjectedVertex[];
  edges: ProjectedEdge[];
  pathD: string;
  corners: {
    tl: OverlayPoint;
    tr: OverlayPoint;
    bl: OverlayPoint;
  };
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  projectSourcePoint: (sourceX: number, sourceY: number) => OverlayPoint;
}

export interface SelectionPolygon {
  id: string;
  points: string;
}

export interface TextSelectionRange {
  start: number;
  end: number;
}

export interface DragSelection {
  start: OverlayPoint;
  current: OverlayPoint;
}
