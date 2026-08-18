/**
 * 节点工厂与内置节点规格（纯函数）。
 * 移植自 infinite-canvas（MIT）canvas-node-factory.ts / constant/canvas.ts，
 * id 改用 nanoid，标题使用中文（Firefly 无 i18n 体系）。
 */
import { nanoid } from "nanoid";
import type { CanvasNode, CanvasNodeMetadata, CanvasNodeTypeId, CanvasPosition } from "../canvas-types";

export const NODE_MIN_WIDTH = 220;
export const NODE_MIN_HEIGHT = 160;

export type NodeSpec = {
  width: number;
  height: number;
  title: string;
  metadata: CanvasNodeMetadata;
  /** 小地图颜色 */
  minimapColor?: string;
  /** 缩放时保持宽高比 */
  keepAspectRatio?: boolean;
};

export const NODE_SPECS: Record<CanvasNodeTypeId, NodeSpec> = {
  text: { width: 340, height: 240, title: "文本", metadata: { content: "", status: "idle", fontSize: 14 } },
  image: { width: 340, height: 240, title: "图片", metadata: { content: "", status: "idle" }, minimapColor: "#10b981", keepAspectRatio: true },
  video: { width: 420, height: 236, title: "视频", metadata: { content: "", status: "idle" }, minimapColor: "#f97316", keepAspectRatio: true },
  audio: { width: 340, height: 120, title: "音频", metadata: { content: "", status: "idle" }, minimapColor: "#a855f7" },
  group: { width: 760, height: 480, title: "分组", metadata: { status: "idle" }, minimapColor: "#94a3b8" },
};

export const getNodeSpec = (type: string): NodeSpec => NODE_SPECS[type as CanvasNodeTypeId] ?? NODE_SPECS.text;

export const createNodeId = (type: string): string => type + "-" + nanoid(10);

/** 创建节点：position 为节点中心点（自动换算左上角），尺寸取自规格 */
export const createCanvasNode = (type: CanvasNodeTypeId, position: CanvasPosition, metadata?: CanvasNodeMetadata): CanvasNode => {
  const spec = getNodeSpec(type);
  return {
    id: createNodeId(type),
    type,
    title: spec.title,
    position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 },
    width: spec.width,
    height: spec.height,
    metadata: { ...spec.metadata, ...metadata },
  };
};

/** 创建分组节点（默认尺寸更大） */
export const createGroupNode = (position: CanvasPosition, metadata?: CanvasNodeMetadata): CanvasNode => createCanvasNode("group", position, metadata);
