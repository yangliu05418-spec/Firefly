import { z } from "zod";

export type CanvasPosition = { x: number; y: number };
export type CanvasViewportTransform = { x: number; y: number; k: number };
export type CanvasBackground = "lines" | "dots" | "blank";

export type CanvasNodeV1 = {
  id: string;
  type: string;
  title: string;
  position: CanvasPosition;
  width: number;
  height: number;
  metadata: Record<string, unknown>;
};

export type CanvasConnectionV1 = { id: string; fromNodeId: string; toNodeId: string };
export type CanvasDocumentV1 = {
  version: 1;
  viewport: CanvasViewportTransform;
  background: CanvasBackground;
  nodes: CanvasNodeV1[];
  connections: CanvasConnectionV1[];
};

export type CanvasNodeTypeV2 = "character" | "scene" | "text" | "image" | "video" | "group" | "legacy-audio";
export type CanvasNodeV2 = {
  id: string;
  type: CanvasNodeTypeV2;
  title: string;
  position: CanvasPosition;
  width: number;
  height: number;
  parentId?: string;
  data: {
    projectAssetId?: string;
    markdown?: string;
    richText?: Record<string, unknown>;
    prompt?: string;
    status?: "idle" | "queued" | "running" | "succeeded" | "failed";
    jobId?: string;
    rotation?: number;
    crop?: { x: number; y: number; width: number; height: number };
    mimeType?: string;
    durationMs?: number;
    legacyMediaRef?: Record<string, unknown>;
    [key: string]: unknown;
  };
};

export type CanvasConnectionV2 = {
  id: string;
  source: string;
  target: string;
  sourceHandle: "right";
  targetHandle: "left";
  relation: "context";
};

export type CanvasDocumentV2 = {
  version: 2;
  viewport: CanvasViewportTransform;
  background: CanvasBackground;
  preferences: {
    edgesHidden: boolean;
    snapToGrid: boolean;
    minimapOpen: boolean;
    panMode: boolean;
  };
  nodes: CanvasNodeV2[];
  connections: CanvasConnectionV2[];
};

const positionSchema = z.object({
  x: z.number().min(-1_000_000).max(1_000_000),
  y: z.number().min(-1_000_000).max(1_000_000),
});

const viewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  k: z.number().min(0.05).max(4),
});

const canvasNodeV1Schema = z.object({
  id: z.string().min(1).max(120),
  type: z.string().min(1).max(60),
  title: z.string().max(200).default(""),
  position: positionSchema,
  width: z.number().min(40).max(10_000),
  height: z.number().min(40).max(10_000),
  metadata: z.record(z.unknown()).default({}),
});

const canvasConnectionV1Schema = z.object({
  id: z.string().min(1).max(120),
  fromNodeId: z.string().min(1).max(120),
  toNodeId: z.string().min(1).max(120),
});

export const canvasDocumentV1Schema = z.object({
  version: z.literal(1),
  viewport: viewportSchema,
  background: z.enum(["lines", "dots", "blank"]),
  nodes: z.array(canvasNodeV1Schema).max(10_000),
  connections: z.array(canvasConnectionV1Schema).max(20_000),
});

export const DEFAULT_CANVAS_DOCUMENT_V1: CanvasDocumentV1 = {
  version: 1,
  viewport: { x: 0, y: 0, k: 1 },
  background: "dots",
  nodes: [],
  connections: [],
};

const cropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).refine((crop) => crop.x + crop.width <= 1.000001 && crop.y + crop.height <= 1.000001, "裁剪区域超出媒体边界");

const canvasNodeV2Schema = z.object({
  id: z.string().min(1).max(120),
  type: z.enum(["character", "scene", "text", "image", "video", "group", "legacy-audio"]),
  title: z.string().max(200).default(""),
  position: positionSchema,
  width: z.number().min(80).max(10_000),
  height: z.number().min(60).max(10_000),
  parentId: z.string().min(1).max(120).optional(),
  data: z.object({
    projectAssetId: z.string().min(1).max(160).optional(),
    markdown: z.string().max(200_000).optional(),
    richText: z.record(z.unknown()).optional(),
    prompt: z.string().max(20_000).optional(),
    status: z.enum(["idle", "queued", "running", "succeeded", "failed"]).optional(),
    jobId: z.string().min(1).max(160).optional(),
    rotation: z.number().min(-360).max(360).optional(),
    crop: cropSchema.optional(),
    mimeType: z.string().max(120).optional(),
    durationMs: z.number().nonnegative().max(3_600_000).optional(),
    legacyMediaRef: z.record(z.unknown()).optional(),
  }).catchall(z.unknown()).default({}),
});

const canvasConnectionV2Schema = z.object({
  id: z.string().min(1).max(120),
  source: z.string().min(1).max(120),
  target: z.string().min(1).max(120),
  sourceHandle: z.literal("right"),
  targetHandle: z.literal("left"),
  relation: z.literal("context"),
});

export const canvasDocumentV2Schema = z.object({
  version: z.literal(2),
  viewport: viewportSchema,
  background: z.enum(["lines", "dots", "blank"]),
  preferences: z.object({
    edgesHidden: z.boolean(),
    snapToGrid: z.boolean(),
    minimapOpen: z.boolean(),
    panMode: z.boolean(),
  }),
  nodes: z.array(canvasNodeV2Schema).max(10_000),
  connections: z.array(canvasConnectionV2Schema).max(20_000),
}).superRefine((document, context) => {
  const nodeIds = new Set(document.nodes.map((node) => node.id));
  const nodeTypes = new Map(document.nodes.map((node) => [node.id, node.type]));
  const allowed: Partial<Record<CanvasNodeTypeV2, CanvasNodeTypeV2[]>> = {
    text: ["text", "image", "video", "character", "scene"],
    character: ["image", "video", "character", "scene"],
    scene: ["image", "video", "scene"],
    image: ["image", "video", "character", "scene"],
    video: ["video"],
  };
  for (const node of document.nodes) {
    if (node.parentId && !nodeIds.has(node.parentId)) context.addIssue({ code: z.ZodIssueCode.custom, message: "分组节点不存在", path: ["nodes"] });
  }
  for (const connection of document.connections) {
    if (!nodeIds.has(connection.source) || !nodeIds.has(connection.target)) context.addIssue({ code: z.ZodIssueCode.custom, message: "连线引用了不存在的节点", path: ["connections"] });
    if (connection.source === connection.target) context.addIssue({ code: z.ZodIssueCode.custom, message: "节点不能连接自身", path: ["connections"] });
    const sourceType = nodeTypes.get(connection.source);
    const targetType = nodeTypes.get(connection.target);
    if (sourceType && targetType && !allowed[sourceType]?.includes(targetType)) context.addIssue({ code: z.ZodIssueCode.custom, message: `不支持从 ${sourceType} 连接到 ${targetType}`, path: ["connections"] });
  }
});

export const canvasDocumentSchema = z.union([canvasDocumentV1Schema, canvasDocumentV2Schema]);
export type CanvasDocument = z.infer<typeof canvasDocumentSchema>;

export const DEFAULT_CANVAS_DOCUMENT: CanvasDocumentV2 = {
  version: 2,
  viewport: { x: 0, y: 0, k: 1 },
  background: "dots",
  preferences: { edgesHidden: false, snapToGrid: true, minimapOpen: true, panMode: false },
  nodes: [],
  connections: [],
};

export const toCanvasDocumentV2 = (document: CanvasDocument): CanvasDocumentV2 => {
  if (document.version === 2) return document;
  return {
    version: 2,
    viewport: document.viewport,
    background: document.background,
    preferences: { edgesHidden: false, snapToGrid: true, minimapOpen: true, panMode: false },
    nodes: document.nodes.map((node) => ({
      id: node.id,
      type: node.type === "audio" ? "legacy-audio" : node.type === "group" ? "group" : node.type === "text" ? "text" : node.type === "video" ? "video" : "image",
      title: node.title,
      position: node.position,
      width: node.width,
      height: node.height,
      parentId: typeof node.metadata.groupId === "string" ? node.metadata.groupId : undefined,
      data: {
        markdown: typeof node.metadata.content === "string" && node.type === "text" ? node.metadata.content : undefined,
        prompt: typeof node.metadata.prompt === "string" ? node.metadata.prompt : undefined,
        status: node.metadata.status === "loading" ? "running" : node.metadata.status === "error" ? "failed" : node.metadata.status === "success" ? "succeeded" : "idle",
        mimeType: typeof node.metadata.mimeType === "string" ? node.metadata.mimeType : undefined,
        durationMs: typeof node.metadata.durationMs === "number" ? node.metadata.durationMs : undefined,
        legacyMediaRef: node.metadata.mediaRef && typeof node.metadata.mediaRef === "object" ? node.metadata.mediaRef as Record<string, unknown> : undefined,
      },
    })),
    connections: document.connections.map((connection) => ({ id: connection.id, source: connection.fromNodeId, target: connection.toNodeId, sourceHandle: "right", targetHandle: "left", relation: "context" })),
  };
};

export const parseCanvasDocument = (documentJson: string): CanvasDocument => canvasDocumentSchema.parse(JSON.parse(documentJson));

export const parseCanvasDocumentSafe = (documentJson: string): CanvasDocument | null => {
  try { return parseCanvasDocument(documentJson); }
  catch { return null; }
};

export const countCanvasNodes = (documentJson: string): number => {
  try {
    const document = JSON.parse(documentJson) as { nodes?: unknown };
    return Array.isArray(document.nodes) ? document.nodes.length : 0;
  } catch { return 0; }
};
