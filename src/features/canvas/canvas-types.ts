/**
 * Canvas 功能类型定义。
 * 文档结构（CanvasDocument）与 server/canvas-document.ts 的 zod 校验保持一致；
 * metadata 为宽松对象（服务端以 Record<string, unknown> 校验），此处提供常见字段的类型提示。
 */

export type CanvasPosition = { x: number; y: number };
export type CanvasViewportTransform = { x: number; y: number; k: number };
export type CanvasBackground = "lines" | "dots" | "blank";

/** 内置节点类型（不含原项目的 config/插件类型） */
export type CanvasNodeTypeId = "text" | "image" | "video" | "audio" | "group";

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";

export type CanvasNodeMetadata = {
  /** 文本内容或媒体地址（M4 起为媒体引用描述，渲染时解析） */
  content?: string;
  prompt?: string;
  status?: CanvasNodeStatus;
  errorDetails?: string;
  fontSize?: number;
  naturalWidth?: number;
  naturalHeight?: number;
  freeResize?: boolean;
  mimeType?: string;
  bytes?: number;
  durationMs?: number;
  /** 所属分组节点 id */
  groupId?: string;
  /** 媒体引用（M4）：{ source: "generation"; taskId } 或 { source: "canvas-asset"; assetId } */
  mediaRef?: { source: "generation"; taskId: string } | { source: "canvas-asset"; assetId: string };
  [key: string]: unknown;
};

export type CanvasNode = {
  id: string;
  type: CanvasNodeTypeId;
  title: string;
  position: CanvasPosition;
  width: number;
  height: number;
  metadata: CanvasNodeMetadata;
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

/** 连线拖拽把手 */
export type ConnectionHandle = { nodeId: string; handleType: "source" | "target" };

/** 框选状态（世界坐标） */
export type SelectionBox = {
  startWorldX: number;
  startWorldY: number;
  currentWorldX: number;
  currentWorldY: number;
  additive: boolean;
  initialSelectedNodeIds: string[];
};

/** 撤销历史条目（文档快照引用） */
export type CanvasHistoryEntry = { nodes: CanvasNode[]; connections: CanvasConnection[]; background: CanvasBackground };

/** 剪贴板内容 */
export type CanvasClipboard = { nodes: CanvasNode[]; connections: CanvasConnection[] };

export const defaultCanvasDocument = (): CanvasDocument => ({
  version: 1,
  viewport: { x: 0, y: 0, k: 1 },
  background: "dots",
  nodes: [],
  connections: [],
});
