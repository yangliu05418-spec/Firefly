/**
 * 画布节点：选中/悬停态、标题重命名、文本节点内容编辑、四角缩放（min 220x160、媒体保比例）、连线把手。
 * 移植自 infinite-canvas（MIT）components/canvas/canvas-node.tsx——
 * 裁剪：插件体系、批量生成、Config 节点、AI 面板；主题走 CSS 变量（Firefly 固定暗色）。
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Group, Image as ImageIcon, Music2, Video } from "lucide-react";
import type { CanvasNode as CanvasNodeData, CanvasPosition } from "../canvas-types";
import { getNodeSpec, NODE_MIN_HEIGHT, NODE_MIN_WIDTH } from "../core/nodes";
import { canvasMediaUrl } from "../canvas-media";
import { LazyCanvasVideo } from "./media/LazyCanvasVideo";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

type CanvasNodeProps = {
  node: CanvasNodeData;
  scale: number;
  isSelected: boolean;
  isRelated: boolean;
  isConnectionTarget: boolean;
  isConnecting: boolean;
  /** M2 隐藏连线把手；M3 接线后置 true */
  interactive?: boolean;
  isGroupDropTarget?: boolean;
  groupChildCount?: number;
  onMouseDown: (event: React.MouseEvent, nodeId: string) => void;
  onSelectCapture?: (event: React.MouseEvent, nodeId: string) => void;
  onHoverStart: (nodeId: string) => void;
  onHoverEnd: (nodeId: string) => void;
  onConnectStart?: (event: React.MouseEvent, nodeId: string, handleType: "source" | "target") => void;
  onResizeStart: (nodeId: string) => void;
  onResize: (nodeId: string, width: number, height: number, position?: CanvasPosition) => void;
  onResizeEnd: (nodeId: string) => void;
  onContentChange: (nodeId: string, content: string) => void;
  onTitleChange: (nodeId: string, title: string) => void;
  onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
};

export const CanvasNode = memo(function CanvasNode({
  node,
  scale,
  isSelected,
  isRelated,
  isConnectionTarget,
  isConnecting,
  interactive = false,
  isGroupDropTarget = false,
  groupChildCount = 0,
  onMouseDown,
  onSelectCapture,
  onHoverStart,
  onHoverEnd,
  onConnectStart,
  onResizeStart,
  onResize,
  onResizeEnd,
  onContentChange,
  onTitleChange,
  onContextMenu,
}: CanvasNodeProps) {
  const [hovered, setHovered] = useState(false);
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(node.title || "");
  const isGroup = node.type === "group";
  const spec = getNodeSpec(node.type);
  const keepRatio = (node.type === "image" && !node.metadata.freeResize) || node.type === "video" || Boolean(spec.keepAspectRatio);
  const ratio = (node.metadata.naturalWidth || node.width) / (node.metadata.naturalHeight || node.height || 1);
  const isActive = isConnectionTarget || isSelected;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const resizeRef = useRef({ isResizing: false, corner: "bottom-right" as ResizeCorner, startX: 0, startY: 0, startLeft: 0, startTop: 0, startWidth: 0, startHeight: 0, keepRatio: false, ratio: 1 });

  useEffect(() => {
    setTitleDraft(node.title || "");
  }, [node.title]);

  useEffect(() => {
    if (!isEditingTitle) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [isEditingTitle]);

  const finishTitleEditing = useCallback(() => {
    const title = titleDraft.trim() || node.title || "未命名";
    setTitleDraft(title);
    setIsEditingTitle(false);
    if (title !== node.title) onTitleChange(node.id, title);
  }, [node.id, node.title, onTitleChange, titleDraft]);

  useEffect(() => {
    if (!isEditingTitle) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && titleInputRef.current?.contains(target)) return;
      finishTitleEditing();
    };
    window.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [finishTitleEditing, isEditingTitle]);

  useEffect(() => {
    if (!isEditingContent) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    const handleWheel = (event: WheelEvent) => event.stopPropagation();
    textarea.addEventListener("wheel", handleWheel, { passive: false });
    return () => textarea.removeEventListener("wheel", handleWheel);
  }, [isEditingContent]);

  useEffect(() => {
    if (!isEditingContent) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (textareaRef.current?.contains(target)) return;
      setIsEditingContent(false);
    };
    window.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [isEditingContent]);

  const handleResizeMove = useCallback(
    (event: MouseEvent) => {
      if (!resizeRef.current.isResizing) return;
      const dx = (event.clientX - resizeRef.current.startX) / scale;
      const dy = (event.clientY - resizeRef.current.startY) / scale;
      const minWidth = NODE_MIN_WIDTH;
      const minHeight = NODE_MIN_HEIGHT;
      const startRight = resizeRef.current.startLeft + resizeRef.current.startWidth;
      const startBottom = resizeRef.current.startTop + resizeRef.current.startHeight;
      const fromLeft = resizeRef.current.corner.includes("left");
      const fromTop = resizeRef.current.corner.includes("top");
      const rawWidth = Math.max(minWidth, resizeRef.current.startWidth + (fromLeft ? -dx : dx));
      const rawHeight = Math.max(minHeight, resizeRef.current.startHeight + (fromTop ? -dy : dy));
      let width = rawWidth;
      let height = rawHeight;
      if (resizeRef.current.keepRatio) {
        const r = resizeRef.current.ratio;
        if (Math.abs(dx) >= Math.abs(dy)) {
          height = width / r;
        } else {
          width = height * r;
        }
        if (height < minHeight) {
          height = minHeight;
          width = height * r;
        }
        if (width < minWidth) {
          width = minWidth;
          height = width / r;
        }
      }
      onResize(node.id, width, height, { x: fromLeft ? startRight - width : resizeRef.current.startLeft, y: fromTop ? startBottom - height : resizeRef.current.startTop });
    },
    [node.id, onResize, scale],
  );

  const handleResizeUp = useCallback(() => {
    resizeRef.current.isResizing = false;
    window.removeEventListener("mousemove", handleResizeMove);
    window.removeEventListener("mouseup", handleResizeUp);
    onResizeEnd(node.id);
  }, [node.id, handleResizeMove, onResizeEnd]);

  const handleResizeMouseDown = (event: React.MouseEvent, corner: ResizeCorner) => {
    event.stopPropagation();
    event.preventDefault();
    onResizeStart(node.id);
    resizeRef.current = {
      isResizing: true,
      corner,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: node.position.x,
      startTop: node.position.y,
      startWidth: node.width,
      startHeight: node.height,
      keepRatio,
      ratio,
    };
    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", handleResizeUp);
  };

  useEffect(
    () => () => {
      window.removeEventListener("mousemove", handleResizeMove);
      window.removeEventListener("mouseup", handleResizeUp);
    },
    [handleResizeMove, handleResizeUp],
  );

  return (
    <div
      data-node-id={node.id}
      className={"canvas-node" + (isGroup ? " canvas-node--group" : "") + (isSelected ? " canvas-node--selected" : "") + (isRelated ? " canvas-node--related" : "") + (isGroupDropTarget ? " canvas-node--drop-target" : "")}
      style={{
        transform: "translate(" + node.position.x + "px, " + node.position.y + "px)",
        width: node.width,
        height: node.height,
        zIndex: isGroup ? 5 : isSelected ? 50 : 10,
      }}
      onMouseEnter={() => {
        setHovered(true);
        onHoverStart(node.id);
      }}
      onMouseLeave={() => {
        setHovered(false);
        onHoverEnd(node.id);
      }}
      onMouseDownCapture={(event) => onSelectCapture?.(event, node.id)}
      onContextMenu={(event) => onContextMenu(event, node.id)}
    >
      {(isSelected || hovered || isEditingTitle) && (
        <div className="canvas-node__label" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              maxLength={64}
              className="canvas-node__title-input"
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={finishTitleEditing}
              onKeyDown={(event) => {
                if (event.key === "Enter") finishTitleEditing();
                if (event.key === "Escape") {
                  setTitleDraft(node.title || "");
                  setIsEditingTitle(false);
                }
              }}
              aria-label="节点名称"
            />
          ) : (
            <button
              type="button"
              className="canvas-node__title"
              title="双击重命名"
              onDoubleClick={(event) => {
                event.stopPropagation();
                setIsEditingTitle(true);
              }}
            >
              {node.title || "未命名"}
            </button>
          )}
        </div>
      )}

      <div
        className={"canvas-node__frame" + (isGroup ? " canvas-node__frame--group" : "")}
        onMouseDown={(event) => onMouseDown(event, node.id)}
        onDoubleClick={(event) => {
          if (node.type !== "text") return;
          event.stopPropagation();
          setIsEditingContent(true);
        }}
      >
        <div className="canvas-node__content">
          {node.type === "text" && (
            <TextNodeContent node={node} isEditingContent={isEditingContent} textareaRef={textareaRef} onContentChange={onContentChange} onStopEditing={() => setIsEditingContent(false)} />
          )}
          {node.type === "image" && <ImageNodeContent node={node} />}
          {node.type === "video" && <VideoNodeContent node={node} />}
          {node.type === "audio" && <AudioNodeContent node={node} />}
          {isGroup && <GroupNodeContent groupChildCount={groupChildCount} />}
        </div>

        {!isGroup && interactive && onConnectStart && (
          <>
            <div
              className={"canvas-node__handle canvas-node__handle--left" + (hovered || isSelected || isConnecting ? " canvas-node__handle--visible" : "")}
              onMouseDown={(event) => onConnectStart(event, node.id, "target")}
              title="拖出连线"
            >
              <i />
            </div>
            <div
              className={"canvas-node__handle canvas-node__handle--right" + (hovered || isSelected || isConnecting ? " canvas-node__handle--visible" : "")}
              onMouseDown={(event) => onConnectStart(event, node.id, "source")}
              title="拖出连线"
            >
              <i />
            </div>
          </>
        )}

        <ResizeHandle corner="top-left" onMouseDown={handleResizeMouseDown} />
        <ResizeHandle corner="top-right" onMouseDown={handleResizeMouseDown} />
        <ResizeHandle corner="bottom-left" onMouseDown={handleResizeMouseDown} />
        <ResizeHandle corner="bottom-right" onMouseDown={handleResizeMouseDown} />
      </div>
    </div>
  );
});

function TextNodeContent({ node, isEditingContent, textareaRef, onContentChange, onStopEditing }: {
  node: CanvasNodeData;
  isEditingContent: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onContentChange: (nodeId: string, content: string) => void;
  onStopEditing: () => void;
}) {
  const fontSize = (node.metadata.fontSize as number) || 14;
  const textStyle = { fontSize: fontSize + "px", lineHeight: Math.round(fontSize * 1.65) + "px" };
  const content = (node.metadata.content as string) || "";
  return (
    <div className="canvas-node__text" style={textStyle}>
      {isEditingContent ? (
        <textarea
          ref={textareaRef}
          value={content}
          className="canvas-node__textarea"
          onChange={(event) => onContentChange(node.id, event.target.value)}
          onBlur={onStopEditing}
          onKeyDown={(event) => {
            if (event.key === "Escape") onStopEditing();
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          aria-label="节点内容"
        />
      ) : (
        <div className="canvas-node__text-view" onWheel={(event) => event.stopPropagation()}>
          {content || <span className="canvas-node__placeholder">双击编辑文本</span>}
        </div>
      )}
    </div>
  );
}

function ImageNodeContent({ node }: { node: CanvasNodeData }) {
  const src = canvasMediaUrl(node);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return (
      <div className="canvas-node__empty">
        <i><ImageIcon /></i>
        <span>{failed ? "图片加载失败" : "图片节点"}</span>
        <small>{failed ? "可在资产归档中重新插入" : "通过资产归档插入"}</small>
      </div>
    );
  }
  return (
    <div className="canvas-node__media">
      <img src={src} alt={node.title} draggable={false} loading="lazy" decoding="async" onDragStart={(event) => event.preventDefault()} onError={() => setFailed(true)} className={node.metadata.freeResize ? "canvas-node__img canvas-node__img--fill" : "canvas-node__img"} data-canvas-no-zoom />
    </div>
  );
}

function VideoNodeContent({ node }: { node: CanvasNodeData }) {
  const src = canvasMediaUrl(node);
  if (!src) {
    return (
      <div className="canvas-node__empty">
        <i><Video /></i>
        <span>视频节点</span>
        <small>插入已归档成片</small>
      </div>
    );
  }
  return <LazyCanvasVideo src={src} />;
}

function AudioNodeContent({ node }: { node: CanvasNodeData }) {
  const content = (node.metadata.content as string) || "";
  if (!content) {
    return (
      <div className="canvas-node__empty">
        <i><Music2 /></i>
        <span>音频节点</span>
        <small>音频素材</small>
      </div>
    );
  }
  return (
    <div className="canvas-node__audio">
      <span><Music2 /> 音频</span>
      <audio src={content} controls className="canvas-node__audio-player" data-canvas-no-zoom />
    </div>
  );
}

function GroupNodeContent({ groupChildCount }: { groupChildCount: number }) {
  return (
    <div className="canvas-node__group-content">
      <div className="canvas-node__group-head">
        <span className="canvas-node__group-icon"><Group /></span>
        <span>分组</span>
        <em>{groupChildCount} 个节点</em>
      </div>
      <div className="canvas-node__group-body" />
    </div>
  );
}

function ResizeHandle({ corner, onMouseDown }: { corner: ResizeCorner; onMouseDown: (event: React.MouseEvent, corner: ResizeCorner) => void }) {
  const className = "canvas-node__resize canvas-node__resize--" + corner;
  return <div className={className} onMouseDown={(event) => onMouseDown(event, corner)} />;
}
