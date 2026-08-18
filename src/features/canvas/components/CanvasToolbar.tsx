/**
 * 画布工具栏（左下角停靠）：工具切换 / 缩放滑杆 / 重置视图 / 小地图开关 / 背景样式 / 快捷键说明。
 * 交互惯例对齐 Figma/Miro：滑杆缩放、快捷键弹层、图标按钮均带 aria-label 与 title。
 */
import { useEffect, useState } from "react";
import { Compass, Focus, Hand, HelpCircle, MousePointer2, X } from "lucide-react";
import type { CanvasBackground } from "../canvas-types";
import type { CanvasTool } from "../canvas-store";

const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "Space / Ctrl + 拖拽", label: "临时平移画布" },
  { keys: "滚轮", label: "以光标为中心缩放" },
  { keys: "中键拖拽", label: "平移画布" },
  { keys: "空白处拖拽", label: "框选节点" },
  { keys: "Shift + 点击", label: "追加/减选节点" },
  { keys: "Ctrl / Cmd + C / V", label: "复制 / 粘贴节点" },
  { keys: "Delete / Backspace", label: "删除选中节点或连线" },
  { keys: "Ctrl / Cmd + Z / Y", label: "撤销 / 重做" },
  { keys: "双击节点标题", label: "重命名节点" },
];

export function CanvasToolbar({ tool, onToolChange, scale, onScaleChange, onReset, isMiniMapOpen, onToggleMiniMap, background, onBackgroundChange }: {
  tool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
  scale: number;
  onScaleChange: (scale: number) => void;
  onReset: () => void;
  isMiniMapOpen: boolean;
  onToggleMiniMap: () => void;
  background: CanvasBackground;
  onBackgroundChange: (background: CanvasBackground) => void;
}) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    if (!shortcutsOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShortcutsOpen(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [shortcutsOpen]);

  return (
    <div className="canvas-toolbar" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
      <div className="canvas-toolbar__group" role="group" aria-label="画布工具">
        <button type="button" className={tool === "select" ? "active" : ""} onClick={() => onToolChange("select")} aria-label="选择工具" title="选择 (默认)"><MousePointer2 /></button>
        <button type="button" className={tool === "pan" ? "active" : ""} onClick={() => onToolChange("pan")} aria-label="平移工具" title="平移（空格可临时切换）"><Hand /></button>
      </div>
      <div className="canvas-toolbar__divider" aria-hidden="true" />
      <div className="canvas-toolbar__zoom">
        <input type="range" min={5} max={500} step={1} value={Math.round(scale * 100)} onChange={(event) => onScaleChange(Number(event.target.value) / 100)} aria-label="缩放" />
        <span className="canvas-toolbar__zoom-label">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={onReset} aria-label="重置视图" title="重置视图"><Focus /></button>
      </div>
      <div className="canvas-toolbar__divider" aria-hidden="true" />
      <button type="button" className={isMiniMapOpen ? "active" : ""} onClick={onToggleMiniMap} aria-label="小地图" title="小地图"><Compass /></button>
      <div className="canvas-toolbar__divider" aria-hidden="true" />
      <div className="canvas-toolbar__background" role="group" aria-label="背景样式">
        <button type="button" className={background === "dots" ? "active" : ""} onClick={() => onBackgroundChange("dots")} title="圆点背景">圆点</button>
        <button type="button" className={background === "lines" ? "active" : ""} onClick={() => onBackgroundChange("lines")} title="网格背景">网格</button>
        <button type="button" className={background === "blank" ? "active" : ""} onClick={() => onBackgroundChange("blank")} title="空白背景">空白</button>
      </div>
      <div className="canvas-toolbar__divider" aria-hidden="true" />
      <button type="button" onClick={() => setShortcutsOpen(true)} aria-label="快捷键" title="快捷键"><HelpCircle /></button>
      {shortcutsOpen && (
        <div className="canvas-shortcuts-backdrop" onClick={() => setShortcutsOpen(false)}>
          <div className="canvas-shortcuts" role="dialog" aria-modal="true" aria-labelledby="canvas-shortcuts-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2 id="canvas-shortcuts-title">快捷键</h2>
              <button type="button" onClick={() => setShortcutsOpen(false)} aria-label="关闭"><X /></button>
            </header>
            <ul>
              {SHORTCUTS.map((shortcut) => (
                <li key={shortcut.keys}>
                  <span>{shortcut.label}</span>
                  <kbd>{shortcut.keys}</kbd>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
