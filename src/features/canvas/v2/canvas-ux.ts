import type { CanvasNodeTypeV2, CanvasNodeV2 } from "../canvas-v2-types";

export type CanvasMenuAnchor = { left: number; right: number; top: number; bottom: number };
export type CanvasMenuPlacement = { left: number; top: number; arrowTop: number; placement: "left" | "right" };
export type CanvasReferenceSummary = { sourceId: string; title: string; type: CanvasNodeTypeV2 };

// Keep the first fit-to-view from turning a lone node into a full-screen panel.
// Explicit user zoom remains available up to the workspace's normal maximum.
export const CANVAS_INITIAL_FIT_VIEW_OPTIONS = { padding: .18, maxZoom: 1 } as const;

const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum);

export const placeCanvasMenu = (
  anchor: CanvasMenuAnchor,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  preferred: "left" | "right",
  gap = 10,
  padding = 12,
): CanvasMenuPlacement => {
  const right = anchor.right + gap;
  const left = anchor.left - panel.width - gap;
  const fitsRight = right + panel.width <= viewport.width - padding;
  const fitsLeft = left >= padding;
  const placement = preferred === "right"
    ? fitsRight || !fitsLeft ? "right" : "left"
    : fitsLeft || !fitsRight ? "left" : "right";
  const idealLeft = placement === "right" ? right : left;
  const anchorCenter = (anchor.top + anchor.bottom) / 2;
  const top = clamp(anchorCenter - panel.height / 2, padding, Math.max(padding, viewport.height - panel.height - padding));
  return {
    left: clamp(idealLeft, padding, Math.max(padding, viewport.width - panel.width - padding)),
    top,
    arrowTop: clamp(anchorCenter - top, 18, Math.max(18, panel.height - 18)),
    placement,
  };
};

export const incomingCanvasReferences = (
  targetId: string,
  nodes: readonly Pick<CanvasNodeV2, "id" | "title" | "type">[],
  connections: readonly { source: string; target: string }[],
): CanvasReferenceSummary[] => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const references: CanvasReferenceSummary[] = [];
  for (const connection of connections) {
    if (connection.target !== targetId || seen.has(connection.source)) continue;
    const source = byId.get(connection.source);
    if (!source) continue;
    seen.add(source.id);
    references.push({ sourceId: source.id, title: source.title || "未命名节点", type: source.type });
  }
  return references;
};

export const hasCanvasConnection = (connections: readonly { source: string; target: string }[], source: string, target: string) =>
  connections.some((connection) => connection.source === source && connection.target === target);

export const withoutEphemeralCanvasElements = <Node extends { id: string }, Connection extends { source: string; target: string }>(
  nodes: readonly Node[],
  connections: readonly Connection[],
  ephemeralIds: ReadonlySet<string>,
) => {
  const persistedNodes = nodes.filter((node) => !ephemeralIds.has(node.id));
  const persistedIds = new Set(persistedNodes.map((node) => node.id));
  return {
    nodes: persistedNodes,
    connections: connections.filter((connection) => persistedIds.has(connection.source) && persistedIds.has(connection.target)),
  };
};
