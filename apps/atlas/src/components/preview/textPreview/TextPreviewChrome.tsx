import type {
  ChangeEvent,
  CSSProperties,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';
import type { DragSelection, EditorGeometry, SelectionPolygon } from './textPreviewTypes';

interface TextPreviewChromeProps {
  layerRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  isEditing: boolean;
  draftText: string;
  editorStyle: CSSProperties;
  geometry: EditorGeometry;
  dragSelection: DragSelection | null;
  selectionPolygons: SelectionPolygon[];
  selectionClipPathId: string;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onCapturePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onTextChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextFocus: () => void;
  onTextBlur: () => void;
  onTextKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextSelectionSync: () => void;
  onInputPointerDown: (event: ReactPointerEvent<HTMLTextAreaElement>) => void;
  onEdgePointerDown: (event: ReactPointerEvent<SVGElement>, fromVertexId: string, toVertexId: string) => void;
  onEdgeDoubleClick: (event: ReactMouseEvent<SVGElement>, fromVertexId: string, toVertexId: string) => void;
  onVertexPointerDown: (event: ReactPointerEvent<SVGRectElement>, vertexId: string) => void;
}

function selectionRect(start: { x: number; y: number }, end: { x: number; y: number }): CSSProperties {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  return {
    left,
    top,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function hasVisibleSelectionRect(start: { x: number; y: number }, end: { x: number; y: number }): boolean {
  return Math.abs(end.x - start.x) >= 6 && Math.abs(end.y - start.y) >= 6;
}

export function TextPreviewChrome({
  layerRef,
  textareaRef,
  isEditing,
  draftText,
  editorStyle,
  geometry,
  dragSelection,
  selectionPolygons,
  selectionClipPathId,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onCapturePointerDown,
  onTextChange,
  onTextFocus,
  onTextBlur,
  onTextKeyDown,
  onTextSelectionSync,
  onInputPointerDown,
  onEdgePointerDown,
  onEdgeDoubleClick,
  onVertexPointerDown,
}: TextPreviewChromeProps) {
  return (
    <div
      ref={layerRef}
      className="preview-text-editor-layer"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div
        className="preview-text-area-capture"
        onPointerDown={onCapturePointerDown}
      />
      {dragSelection && hasVisibleSelectionRect(dragSelection.start, dragSelection.current) && (
        <div
          className="preview-text-draft-box"
          style={selectionRect(dragSelection.start, dragSelection.current)}
        />
      )}
      <textarea
        ref={textareaRef}
        className={`preview-text-editor-input ${isEditing ? 'editing' : ''}`}
        value={draftText}
        onChange={onTextChange}
        onFocus={onTextFocus}
        onBlur={onTextBlur}
        onKeyDown={onTextKeyDown}
        onKeyUp={onTextSelectionSync}
        onMouseDown={(event) => event.stopPropagation()}
        onMouseUp={onTextSelectionSync}
        onPointerDown={onInputPointerDown}
        onSelect={onTextSelectionSync}
        spellCheck={false}
        style={editorStyle}
      />
      <svg className="preview-text-bounds-svg" width="100%" height="100%">
        {geometry.pathD && (
          <defs>
            <clipPath id={selectionClipPathId}>
              <path d={geometry.pathD} />
            </clipPath>
          </defs>
        )}
        {selectionPolygons.map(polygon => (
          <polygon
            key={polygon.id}
            className="preview-text-selection-highlight"
            points={polygon.points}
            clipPath={geometry.pathD ? `url(#${selectionClipPathId})` : undefined}
          />
        ))}
        {geometry.pathD && (
          <path className="preview-text-bounds-outline" d={geometry.pathD} />
        )}
        {geometry.edges.map(edge => (
          <path
            key={edge.id}
            className="preview-text-bounds-edge-hit"
            d={edge.pathD}
            onPointerDown={(event) => onEdgePointerDown(event, edge.fromVertexId, edge.toVertexId)}
            onDoubleClick={(event) => onEdgeDoubleClick(event, edge.fromVertexId, edge.toVertexId)}
          >
            <title>Drag edge to resize. Shift-drag to snap. Ctrl-drag for free edge. Double-click to straighten.</title>
          </path>
        ))}
        {geometry.edges.map(edge => (
          <rect
            key={`${edge.id}-handle`}
            className="preview-text-bounds-edge-handle"
            x={edge.midpoint.x - 3}
            y={edge.midpoint.y - 3}
            width={6}
            height={6}
            onPointerDown={(event) => onEdgePointerDown(event, edge.fromVertexId, edge.toVertexId)}
            onDoubleClick={(event) => onEdgeDoubleClick(event, edge.fromVertexId, edge.toVertexId)}
          >
            <title>Drag edge to resize. Shift-drag to snap. Ctrl-drag for free edge. Double-click to straighten.</title>
          </rect>
        ))}
        {geometry.vertices.map(({ vertex, point }) => (
          <rect
            key={vertex.id}
            className="preview-text-bounds-vertex"
            x={point.x - 4}
            y={point.y - 4}
            width={8}
            height={8}
            onPointerDown={(event) => onVertexPointerDown(event, vertex.id)}
          />
        ))}
      </svg>
    </div>
  );
}
