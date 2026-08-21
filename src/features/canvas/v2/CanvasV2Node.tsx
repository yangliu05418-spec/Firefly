import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";
import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";
import { Box, CircleStop, Clapperboard, Crop, Download, ImageIcon, Images, Library, LoaderCircle, Maximize2, Plus, RotateCw, ScanFace, TextCursorInput, Upload, Users, WandSparkles, X } from "lucide-react";
import type { CanvasNodeTypeV2, CanvasNodeV2 } from "../canvas-v2-types";
import { LazyCanvasVideo } from "../components/media/LazyCanvasVideo";
import type { CanvasMenuAnchor, CanvasReferenceSummary } from "./canvas-ux";

const CanvasRichText = lazy(() => import("./CanvasRichText").then((module) => ({ default: module.CanvasRichText })));

export type CanvasFlowData = {
  domain: CanvasNodeV2;
  readOnly: boolean;
  references: CanvasReferenceSummary[];
  localPreviewUrl?: string;
  onChange: (id: string, patch: Partial<CanvasNodeV2["data"]>) => void;
  onCreateFrom: (id: string, side: "left" | "right", anchor: CanvasMenuAnchor) => void;
  onFocusReference: (sourceId: string) => void;
  onRemoveReference: (sourceId: string, targetId: string) => void;
  onGenerate: (id: string) => void;
  onInspect: (id: string) => void;
  onCancel: (id: string) => void;
  onExtractFrame: (id: string) => void;
  onSelection: (id: string, text: string) => void;
  onCrop: (id: string) => void;
  onRotate: (id: string) => void;
  onUpload: (id: string, file: File) => void;
  onPickAsset: (id: string) => void;
};
export type CanvasFlowNode = Node<CanvasFlowData, CanvasNodeTypeV2>;

const icons: Record<CanvasNodeTypeV2, typeof ImageIcon> = { character: ScanFace, scene: Clapperboard, text: TextCursorInput, image: ImageIcon, video: Clapperboard, group: Users, "legacy-audio": Box };
const emptyCopy: Record<CanvasNodeTypeV2, string> = { character: "添加角色参考", scene: "添加场景参考", text: "开始书写", image: "添加图片或生成", video: "添加视频或生成", group: "把节点拖入分组", "legacy-audio": "旧版音频节点" };

function CanvasV2NodeView({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const { domain, readOnly } = data;
  const Icon = icons[domain.type];
  const [imageError, setImageError] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const persistedMediaUrl = domain.data.projectAssetId ? `/api/canvas-project-assets/${encodeURIComponent(domain.data.projectAssetId)}/media${["image", "character", "scene"].includes(domain.type) ? "?variant=thumbnail" : ""}` : "";
  const mediaUrl = data.localPreviewUrl ?? persistedMediaUrl;
  const status = domain.data.status ?? "idle";
  const mediaStyle = { transform: `rotate(${domain.data.rotation ?? 0}deg)` };
  const canBranch = domain.type !== "group" && domain.type !== "legacy-audio";
  const canFill = domain.type === "image" || domain.type === "video" || domain.type === "character" || domain.type === "scene";
  const bodyIsInteractive = domain.type === "text" || domain.type === "legacy-audio" || (domain.type === "video" && Boolean(mediaUrl));
  const uploadAccept = domain.type === "video" ? "video/mp4,video/quicktime" : "image/*";
  useEffect(() => setImageError(false), [domain.data.projectAssetId, status]);

  const emptyMedia = canFill ? <div className="canvas-v2-node__empty">
    <Icon />
    <span>{imageError ? "素材暂时无法显示" : emptyCopy[domain.type]}</span>
    {!readOnly && <div className="canvas-v2-node__empty-actions nodrag nowheel">
      <button type="button" onClick={() => uploadInput.current?.click()}>
        <Upload />
        <span>本地上传</span>
      </button>
      <input ref={uploadInput} type="file" accept={uploadAccept} onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) data.onUpload(id, file);
      }} />
      <button type="button" onClick={() => data.onPickAsset(id)}><Library /><span>资产库</span></button>
    </div>}
  </div> : <div className="canvas-v2-node__empty"><Icon /><span>{emptyCopy[domain.type]}</span></div>;

  return <article data-node-id={id} className={`canvas-v2-node canvas-v2-node--${domain.type} canvas-v2-node--${status}${data.references.length ? " canvas-v2-node--has-references" : ""}`}>
    {!readOnly && <NodeResizer minWidth={180} minHeight={120} isVisible={selected} lineClassName="canvas-v2-resize-line" handleClassName="canvas-v2-resize-handle" />}
    <Handle type="target" id="left" position={Position.Left} className="canvas-v2-handle" isConnectable={!readOnly} />
    <Handle type="source" id="right" position={Position.Right} className="canvas-v2-handle" isConnectable={!readOnly} />
    {!readOnly && canBranch && <button className="canvas-v2-node__plus canvas-v2-node__plus--left nodrag" aria-label="添加上下文" onClick={(event) => { event.stopPropagation(); data.onCreateFrom(id, "left", event.currentTarget.getBoundingClientRect()); }}><Plus /></button>}
    {!readOnly && canBranch && <button className="canvas-v2-node__plus canvas-v2-node__plus--right nodrag" aria-label="引用该节点生成" onClick={(event) => { event.stopPropagation(); data.onCreateFrom(id, "right", event.currentTarget.getBoundingClientRect()); }}><Plus /></button>}
    <header className="canvas-v2-node__head">
      <span><Icon /></span><b>{domain.title}</b>
      {data.localPreviewUrl && status === "running" && <small>本地已完成 · 保存中</small>}
      {(status === "queued" || status === "running") && <><LoaderCircle className="spin" />{!readOnly && domain.data.jobId && <button className="canvas-v2-node__cancel nodrag" onClick={() => data.onCancel(id)} aria-label="取消生成" title="取消生成"><CircleStop /></button>}</>}
      {status === "failed" && <i title={String(domain.data.error ?? "生成失败")}>!</i>}
    </header>
    {data.references.length > 0 && <div className="canvas-v2-node__references nodrag nowheel" aria-label="引用来源">
      <span>引用自</span>
      <div>{data.references.map((reference) => {
        const ReferenceIcon = icons[reference.type];
        return <span className="canvas-v2-reference-chip" key={reference.sourceId}>
          <button type="button" onClick={() => data.onFocusReference(reference.sourceId)} title={`定位到 ${reference.title}`}><ReferenceIcon /><b>{reference.title}</b></button>
          {!readOnly && <button type="button" onClick={() => data.onRemoveReference(reference.sourceId, id)} aria-label={`移除引用 ${reference.title}`} title="移除引用"><X /></button>}
        </span>;
      })}</div>
    </div>}
    <div className={`canvas-v2-node__body${bodyIsInteractive ? " nodrag nowheel" : ""}`}>
      {domain.type === "text" ? <Suspense fallback={<div className="canvas-v2-node__empty" aria-busy="true"><LoaderCircle className="spin" /><span>正在载入文本编辑器</span></div>}><CanvasRichText value={domain.data.markdown ?? ""} richText={domain.data.richText} readOnly={readOnly} onChange={(markdown, richText) => data.onChange(id, { markdown, richText })} onSelection={(selectionText) => data.onSelection(id, selectionText)} /></Suspense> :
        domain.type === "group" ? <div className="canvas-v2-node__group"><Users /><span>内容分组</span><small>拖动节点到这里整理镜头关系</small></div> :
        domain.type === "legacy-audio" ? mediaUrl ? <audio className="canvas-v2-node__media canvas-v2-node__audio" src={mediaUrl} controls preload="metadata" /> : <div className="canvas-v2-node__empty"><Icon /><span>{emptyCopy[domain.type]}</span></div> :
        domain.type === "video" ? mediaUrl ? <LazyCanvasVideo src={mediaUrl} /> : emptyMedia :
        mediaUrl && !imageError ? <img className="canvas-v2-node__media" style={mediaStyle} src={mediaUrl} alt={domain.title} loading="lazy" draggable={false} onError={() => setImageError(true)} /> : emptyMedia}
    </div>
    {selected && domain.type !== "group" && <footer className="canvas-v2-node__tools nodrag">
      {persistedMediaUrl && <><a href={`${persistedMediaUrl}?download=1`} aria-label="下载"><Download /></a><button onClick={() => data.onInspect(id)} aria-label="放大"><Maximize2 /></button>{domain.type === "video" && !readOnly && <button onClick={() => data.onExtractFrame(id)} aria-label="抽取中间帧" title="抽取中间帧"><Images /></button>}{domain.type !== "video" && domain.type !== "legacy-audio" && !readOnly && <><button onClick={() => data.onCrop(id)} aria-label="裁剪"><Crop /></button><button onClick={() => data.onRotate(id)} aria-label="旋转并创建派生图"><RotateCw /></button></>}</>}
      {!readOnly && <button className="canvas-v2-node__generate" onClick={() => data.onGenerate(id)}><WandSparkles /> 生成</button>}
    </footer>}
  </article>;
}

export const CanvasV2Node = memo(CanvasV2NodeView);
