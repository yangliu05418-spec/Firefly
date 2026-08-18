/**
 * 媒体桥接：节点只存稳定引用（mediaRef），渲染时解析为受保护的 Firefly 路由；
 * 不落任何签名 URL（铁律）。图片插入时服务端同步迁移到 canvas/ 前缀。
 */
import type { CanvasDocument, CanvasMediaRef, CanvasNode, CanvasPosition, CanvasNodeTypeId } from "./canvas-types";
import { canvasCenter } from "./core/viewport";
import { createCanvasNode } from "./core/nodes";
import { fitNodeSize } from "./core/geometry";

/** 解析节点媒体地址（返回受保护的 API 路由；无引用时回退到旧版 content 直链） */
export const canvasMediaUrl = (node: CanvasNode): string | null => {
  const ref = node.metadata.mediaRef as CanvasMediaRef | undefined;
  if (ref) return ref.source === "generation" ? "/api/generations/" + encodeURIComponent(ref.taskId) + "/media" : "/api/canvas-media/" + encodeURIComponent(ref.assetId);
  const content = node.metadata.content;
  return typeof content === "string" && content ? content : null;
};

/** 插入媒体的目标位置：画布视口中心（未打开过的新画布落在原点附近） */
export const documentCenter = (document: CanvasDocument, viewportSize: { width: number; height: number } = { width: 1200, height: 800 }): CanvasPosition => canvasCenter(document.viewport, viewportSize);

/** 创建媒体节点：按自然尺寸等比适配（≤640px 边长），位置以中心点输入 */
export const createMediaNode = (kind: Extract<CanvasNodeTypeId, "image" | "video">, center: CanvasPosition, mediaRef: CanvasMediaRef, meta: { title?: string; width?: number; height?: number; durationMs?: number }): CanvasNode => {
  const node = createCanvasNode(kind, center, {
    mediaRef,
    status: "success",
    content: "",
    naturalWidth: meta.width,
    naturalHeight: meta.height,
    durationMs: meta.durationMs,
  });
  if (meta.width && meta.height) {
    const fitted = fitNodeSize(meta.width, meta.height, 640, 640);
    return { ...node, ...fitted, position: { x: center.x - fitted.width / 2, y: center.y - fitted.height / 2 } };
  }
  return node;
};
