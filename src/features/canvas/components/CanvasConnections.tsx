/**
 * 连线渲染：16px 透明命中层 + 贝塞尔路径 + 拖拽虚线预览。
 * 移植自 infinite-canvas（MIT）components/canvas/canvas-connections.tsx。
 */
import type { MouseEvent as ReactMouseEvent } from "react";
import type { CanvasConnection, CanvasNode, CanvasPosition, ConnectionHandle } from "../canvas-types";
import { activeConnectionPathD, connectionPathD } from "../core/connections";

export function ConnectionPath({ connection, from, to, active, onSelect, onContextMenu }: {
  connection: CanvasConnection;
  from: CanvasNode;
  to: CanvasNode;
  active: boolean;
  onSelect: () => void;
  onContextMenu?: (event: ReactMouseEvent<SVGPathElement>) => void;
}) {
  const d = connectionPathD(from, to);
  return (
    <g>
      <path data-connection-id={connection.id} d={d} stroke="transparent" strokeWidth="16" fill="none" className="canvas-connection__hit" onClick={(event) => { event.stopPropagation(); onSelect(); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onContextMenu?.(event); }} />
      <path d={d} className={active ? "canvas-connection__line canvas-connection__line--active" : "canvas-connection__line"} strokeWidth={active ? 3 : 2} fill="none" style={active ? { filter: "drop-shadow(0 0 8px var(--canvas-node-active-soft))" } : undefined} />
    </g>
  );
}

export function ActiveConnectionPath({ node, handle, mouseWorld, target }: { node?: CanvasNode; handle: ConnectionHandle; mouseWorld: CanvasPosition; target?: CanvasNode }) {
  const d = activeConnectionPathD(node, handle, mouseWorld, target);
  if (!d) return null;
  return <path d={d} className="canvas-connection__active" strokeWidth="2" fill="none" strokeDasharray="5,5" />;
}
