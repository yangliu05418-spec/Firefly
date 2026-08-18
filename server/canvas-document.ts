import { z } from "zod";

/**
 * CanvasDocumentV1 — 画布文档模型（服务端校验层）。
 * 类型与前端 src/features/canvas/canvas-types.ts 保持一致。
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
export type CanvasDocumentV1 = {
  version: 1;
  viewport: CanvasViewportTransform;
  background: CanvasBackground;
  nodes: CanvasNode[];
  connections: CanvasConnection[];
};

const canvasNodeSchema = z.object({
  id: z.string().min(1).max(120),
  type: z.string().min(1).max(60),
  title: z.string().max(200).default(""),
  position: z.object({ x: z.number().min(-1_000_000).max(1_000_000), y: z.number().min(-1_000_000).max(1_000_000) }),
  width: z.number().min(40).max(100_000),
  height: z.number().min(40).max(100_000),
  metadata: z.record(z.unknown()).default({}),
});
const canvasConnectionSchema = z.object({
  id: z.string().min(1).max(120),
  fromNodeId: z.string().min(1).max(120),
  toNodeId: z.string().min(1).max(120),
});
export const canvasDocumentSchema = z.object({
  version: z.literal(1),
  viewport: z.object({ x: z.number(), y: z.number(), k: z.number().min(0.01).max(100) }),
  background: z.enum(["lines", "dots", "blank"]),
  nodes: z.array(canvasNodeSchema).max(10_000),
  connections: z.array(canvasConnectionSchema).max(20_000),
});

export const DEFAULT_CANVAS_DOCUMENT: CanvasDocumentV1 = {
  version: 1,
  viewport: { x: 0, y: 0, k: 1 },
  background: "dots",
  nodes: [],
  connections: [],
};

export const parseCanvasDocument = (documentJson: string): CanvasDocumentV1 => canvasDocumentSchema.parse(JSON.parse(documentJson));

export const parseCanvasDocumentSafe = (documentJson: string): CanvasDocumentV1 | null => {
  try {
    return parseCanvasDocument(documentJson);
  } catch {
    return null;
  }
};

export const countCanvasNodes = (documentJson: string): number => {
  try {
    const document = JSON.parse(documentJson) as { nodes?: unknown };
    return Array.isArray(document.nodes) ? document.nodes.length : 0;
  } catch {
    return 0;
  }
};
