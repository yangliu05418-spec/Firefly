import { memo, useEffect, useState } from "react";
import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";
import { Box, CircleStop, Clapperboard, Crop, Download, ImageIcon, Images, LoaderCircle, Maximize2, Plus, RotateCw, ScanFace, TextCursorInput, Users, WandSparkles } from "lucide-react";
import type { CanvasNodeTypeV2, CanvasNodeV2 } from "../canvas-v2-types";
import { CanvasRichText } from "./CanvasRichText";

export type CanvasFlowData = {
  domain: CanvasNodeV2;
  readOnly: boolean;
  onChange: (id: string, patch: Partial<CanvasNodeV2["data"]>) => void;
  onCreateFrom: (id: string, side: "left" | "right") => void;
  onGenerate: (id: string) => void;
  onInspect: (id: string) => void;
  onCancel: (id: string) => void;
  onExtractFrame: (id: string) => void;
  onSelection: (id: string, text: string) => void;
  onCrop: (id: string) => void;
  onRotate: (id: string) => void;
};
export type CanvasFlowNode = Node<CanvasFlowData, CanvasNodeTypeV2>;

const icons: Record<CanvasNodeTypeV2, typeof ImageIcon> = { character: ScanFace, scene: Clapperboard, text: TextCursorInput, image: ImageIcon, video: Clapperboard, group: Users, "legacy-audio": Box };
const emptyCopy: Record<CanvasNodeTypeV2, string> = { character: "添加角色参考", scene: "添加场景参考", text: "开始书写", image: "添加图片或生成", video: "添加视频或生成", group: "把节点拖入分组", "legacy-audio": "旧版音频节点" };

function CanvasV2NodeView({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const { domain, readOnly } = data;
  const Icon = icons[domain.type];
  const [imageError, setImageError] = useState(false);
  const mediaUrl = domain.data.projectAssetId ? `/api/canvas-project-assets/${encodeURIComponent(domain.data.projectAssetId)}/media` : "";
  const status = domain.data.status ?? "idle";
  const mediaStyle = { transform: `rotate(${domain.data.rotation ?? 0}deg)` };
  useEffect(() => setImageError(false), [domain.data.projectAssetId, status]);

  return <article className={`canvas-v2-node canvas-v2-node--${domain.type} canvas-v2-node--${status}`}>
    {!readOnly && <NodeResizer minWidth={180} minHeight={120} isVisible={selected} lineClassName="canvas-v2-resize-line" handleClassName="canvas-v2-resize-handle" />}
    <Handle type="target" id="left" position={Position.Left} className="canvas-v2-handle" isConnectable={!readOnly} />
    <Handle type="source" id="right" position={Position.Right} className="canvas-v2-handle" isConnectable={!readOnly} />
    {!readOnly && <button className="canvas-v2-node__plus canvas-v2-node__plus--left nodrag" aria-label="添加上下文" onClick={() => data.onCreateFrom(id, "left")}><Plus /></button>}
    {!readOnly && <button className="canvas-v2-node__plus canvas-v2-node__plus--right nodrag" aria-label="引用该节点生成" onClick={() => data.onCreateFrom(id, "right")}><Plus /></button>}
    <header className="canvas-v2-node__head">
      <span><Icon /></span><b>{domain.title}</b>
      {(status === "queued" || status === "running") && <><LoaderCircle className="spin" />{!readOnly && <button className="canvas-v2-node__cancel nodrag" onClick={() => data.onCancel(id)} aria-label="取消生成" title="取消生成"><CircleStop /></button>}</>}
      {status === "failed" && <i title={String(domain.data.error ?? "生成失败")}>!</i>}
    </header>
    <div className="canvas-v2-node__body nodrag nowheel">
      {domain.type === "text" ? <CanvasRichText value={domain.data.markdown ?? ""} readOnly={readOnly} onChange={(markdown, richText) => data.onChange(id, { markdown, richText })} onSelection={(selectionText) => data.onSelection(id, selectionText)} /> :
        domain.type === "group" ? <div className="canvas-v2-node__group"><Users /><span>内容分组</span><small>拖动节点到这里整理镜头关系</small></div> :
        domain.type === "legacy-audio" ? mediaUrl ? <audio className="canvas-v2-node__media canvas-v2-node__audio" src={mediaUrl} controls preload="metadata" /> : <div className="canvas-v2-node__empty"><Icon /><span>{emptyCopy[domain.type]}</span></div> :
        domain.type === "video" ? mediaUrl ? <video className="canvas-v2-node__media" style={mediaStyle} src={mediaUrl} controls playsInline preload="metadata" /> : <div className="canvas-v2-node__empty"><Icon /><span>{emptyCopy[domain.type]}</span></div> :
        mediaUrl && !imageError ? <img className="canvas-v2-node__media" style={mediaStyle} src={mediaUrl} alt={domain.title} loading="lazy" draggable={false} onError={() => setImageError(true)} /> : <div className="canvas-v2-node__empty"><Icon /><span>{imageError ? "素材暂时无法显示" : emptyCopy[domain.type]}</span></div>}
    </div>
    {selected && domain.type !== "group" && <footer className="canvas-v2-node__tools nodrag">
      {mediaUrl && <><a href={`${mediaUrl}?download=1`} aria-label="下载"><Download /></a><button onClick={() => data.onInspect(id)} aria-label="放大"><Maximize2 /></button>{domain.type === "video" && !readOnly && <button onClick={() => data.onExtractFrame(id)} aria-label="抽取中间帧" title="抽取中间帧"><Images /></button>}{domain.type !== "video" && domain.type !== "legacy-audio" && !readOnly && <><button onClick={() => data.onCrop(id)} aria-label="裁剪"><Crop /></button><button onClick={() => data.onRotate(id)} aria-label="旋转并创建派生图"><RotateCw /></button></>}</>}
      {!readOnly && <button className="canvas-v2-node__generate" onClick={() => data.onGenerate(id)}><WandSparkles /> 生成</button>}
    </footer>}
  </article>;
}

export const CanvasV2Node = memo(CanvasV2NodeView);
