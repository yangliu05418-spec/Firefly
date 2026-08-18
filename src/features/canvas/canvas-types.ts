/**
 * Canvas 功能类型定义（与 server/canvas-document.ts 保持一致）。
 */

export type CanvasPosition = { x: number; y: number };
export type CanvasViewportTransform = { x: number; y: number; k: number };
export type CanvasBackground = "lines" | "dots" | "blank";

export type CanvasNode = {
  id: string;
  type: string;
  title: string;
  position: CanvasPosition;
  width: number;
  height: number;
  metadata: Record<string, unknown>;
};

export type CanvasConnection = { id: string; fromNodeId: string; toNodeId: string };

export type CanvasDocument = {
  version: 1;
  viewport: CanvasViewportTransform;
  background: CanvasBackground;
  nodes: CanvasNode[];
  connections: CanvasConnection[];
};

export type CanvasProjectSummary = { id: string; title: string; nodeCount: number; updatedAt: number };
export type CanvasProjectDetail = { id: string; title: string; revision: number; updatedAt: number; document: CanvasDocument | null };
export type CanvasListResult = { Items: CanvasProjectSummary[]; PageNumber: number; PageSize: number; HasMore: boolean };

export const defaultCanvasDocument = (): CanvasDocument => ({
  version: 1,
  viewport: { x: 0, y: 0, k: 1 },
  background: "dots",
  nodes: [],
  connections: [],
});
