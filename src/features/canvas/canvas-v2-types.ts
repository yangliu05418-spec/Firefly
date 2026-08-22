import type { CanvasBackground, CanvasDocument as CanvasDocumentV1, CanvasViewportTransform } from "./canvas-types";

export type CanvasNodeTypeV2 = "character" | "scene" | "text" | "image" | "video" | "group" | "legacy-audio";
export type CanvasJobStatus = "idle" | "queued" | "running" | "succeeded" | "failed";
export type CanvasCrop = { x: number; y: number; width: number; height: number };

export type CanvasNodeDataV2 = {
  projectAssetId?: string;
  markdown?: string;
  richText?: Record<string, unknown>;
  prompt?: string;
  status?: CanvasJobStatus;
  jobId?: string;
  rotation?: number;
  crop?: CanvasCrop;
  mimeType?: string;
  durationMs?: number;
  legacyMediaRef?: Record<string, unknown>;
  [key: string]: unknown;
};

export type CanvasNodeV2 = {
  id: string;
  type: CanvasNodeTypeV2;
  title: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  parentId?: string;
  data: CanvasNodeDataV2;
};

export type CanvasConnectionV2 = {
  id: string;
  source: string;
  target: string;
  sourceHandle: "right";
  targetHandle: "left";
  relation: "context";
};

export type CanvasPreferencesV2 = {
  edgesHidden: boolean;
  snapToGrid: boolean;
  minimapOpen: boolean;
  panMode: boolean;
};

export type CanvasDocumentV2 = {
  version: 2;
  viewport: CanvasViewportTransform;
  background: CanvasBackground;
  preferences: CanvasPreferencesV2;
  nodes: CanvasNodeV2[];
  connections: CanvasConnectionV2[];
};

export type AnyCanvasDocument = CanvasDocumentV1 | CanvasDocumentV2;

export const defaultCanvasDocumentV2 = (): CanvasDocumentV2 => ({
  version: 2,
  viewport: { x: 0, y: 0, k: 1 },
  background: "dots",
  preferences: { edgesHidden: false, snapToGrid: true, minimapOpen: true, panMode: false },
  nodes: [],
  connections: [],
});

const mediaNodeTypes = new Set<CanvasNodeTypeV2>(["character", "scene", "image", "video"]);
const interruptedLocalUpload = (node: CanvasNodeV2) => mediaNodeTypes.has(node.type)
  && ["queued", "running"].includes(node.data.status ?? "")
  && !node.data.jobId
  && !node.data.projectAssetId;

/** Browser uploads are not resumable after the editor closes; never persist their transient spinner. */
export const canvasNodeForPersistence = (node: CanvasNodeV2): CanvasNodeV2 => interruptedLocalUpload(node)
  ? { ...node, data: { ...node.data, status: "idle", error: undefined } }
  : node;

/** Repair documents written by older clients that left an unresumable local upload running forever. */
export const recoverInterruptedCanvasNode = (node: CanvasNodeV2): CanvasNodeV2 => interruptedLocalUpload(node)
  ? { ...node, data: { ...node.data, status: "failed", error: "上次本地素材保存未完成，请重新选择素材" } }
  : node;

export const toCanvasDocumentV2 = (document: AnyCanvasDocument): CanvasDocumentV2 => {
  const converted: CanvasDocumentV2 = document.version === 2 ? document : {
    ...defaultCanvasDocumentV2(),
    viewport: document.viewport,
    background: document.background,
    nodes: document.nodes.map((node) => ({
      id: node.id,
      type: node.type === "audio" ? "legacy-audio" : node.type === "group" ? "group" : node.type === "text" ? "text" : node.type === "video" ? "video" : "image",
      title: node.title,
      position: node.position,
      width: node.width,
      height: node.height,
      parentId: typeof node.metadata.groupId === "string" ? node.metadata.groupId : undefined,
      data: {
        markdown: node.type === "text" && typeof node.metadata.content === "string" ? node.metadata.content : undefined,
        prompt: typeof node.metadata.prompt === "string" ? node.metadata.prompt : undefined,
        status: node.metadata.status === "loading" ? "running" : node.metadata.status === "error" ? "failed" : node.metadata.status === "success" ? "succeeded" : "idle",
        mimeType: typeof node.metadata.mimeType === "string" ? node.metadata.mimeType : undefined,
        durationMs: typeof node.metadata.durationMs === "number" ? node.metadata.durationMs : undefined,
        legacyMediaRef: node.metadata.mediaRef && typeof node.metadata.mediaRef === "object" ? node.metadata.mediaRef as Record<string, unknown> : undefined,
      },
    })),
    connections: document.connections.map((connection) => ({
      id: connection.id,
      source: connection.fromNodeId,
      target: connection.toNodeId,
      sourceHandle: "right",
      targetHandle: "left",
      relation: "context",
    })),
  };
  return { ...converted, nodes: converted.nodes.map(recoverInterruptedCanvasNode) };
};

export const createCanvasNodeV2 = (
  type: Exclude<CanvasNodeTypeV2, "legacy-audio">,
  position: { x: number; y: number },
  patch: Partial<CanvasNodeV2> = {},
): CanvasNodeV2 => {
  const media = type === "image" || type === "video" || type === "character" || type === "scene";
  return {
    id: patch.id ?? `node-${crypto.randomUUID()}`,
    type,
    title: patch.title ?? ({ character: "角色", scene: "场景", text: "文本", image: "图片", video: "视频", group: "分组" }[type]),
    position,
    width: patch.width ?? (media ? 320 : type === "group" ? 520 : 300),
    height: patch.height ?? (type === "text" ? 220 : type === "group" ? 360 : 300),
    parentId: patch.parentId,
    data: patch.data ?? { status: "idle" },
  };
};

export const NODE_CONNECTION_MATRIX: Record<Exclude<CanvasNodeTypeV2, "group" | "legacy-audio">, Exclude<CanvasNodeTypeV2, "group" | "legacy-audio">[]> = {
  text: ["text", "image", "video", "character", "scene"],
  character: ["image", "video", "character", "scene"],
  scene: ["image", "video", "scene"],
  image: ["image", "video", "character", "scene"],
  video: ["video"],
};

export const canCreateFromNode = (source: CanvasNodeTypeV2, target: CanvasNodeTypeV2) => {
  if (source === "group" || source === "legacy-audio" || target === "group" || target === "legacy-audio") return false;
  return NODE_CONNECTION_MATRIX[source].includes(target);
};
