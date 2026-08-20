import { ArrowLeft, Command, MousePointer2, Network, Save, Sparkles } from "lucide-react";

const shortcuts = [
  ["选择全部", "⌘ / Ctrl + A"], ["复制 / 粘贴", "⌘ / Ctrl + C / V"], ["撤销 / 重做", "⌘ / Ctrl + Z / Shift + Z"],
  ["新建节点", "Tab"], ["删除所选", "Delete / Backspace"], ["适应画布", "⌘ / Ctrl + 0"], ["整理画布", "Option / Alt + Shift + F"],
  ["移动画布", "Space + 拖动"], ["复制节点", "Option / Alt + 拖动"], ["搜索", "⌘ / Ctrl + F"],
];

export function CanvasTutorial({ navigate }: { navigate: (path: string) => void }) {
  return <main className="canvas-v2-tutorial"><header><button onClick={() => navigate("/studio/canvas")}><ArrowLeft /> 全部画布</button><span>FIREFLY CANVAS</span><h1>让关系，而不是窗口，组织创作。</h1><p>画布会自动保存。节点只记录稳定资产，视频预览与下载始终从 TOS 直达浏览器。</p></header><section className="canvas-v2-tutorial__principles"><article><MousePointer2 /><b>创建与连接</b><p>使用中央快捷入口、Tab、左侧加号或右键空白处创建节点。节点左侧是输入上下文，右侧是基于该节点继续生成。</p></article><article><Network /><b>上下文方向</b><p>连线从左向右表达引用关系。生成时，服务端只解析已经保存的入边，避免界面状态与实际传参不一致。</p></article><article><Sparkles /><b>生成与版本</b><p>空节点会被填充；已有内容再次生成会保留原版本。关闭页面后任务继续，重新进入时会恢复状态。</p></article><article><Save /><b>保存与接管</b><p>本地草稿约 250ms 写入，服务端约 800ms 保存。同一画布第二窗口默认只读，可显式接管而不会静默覆盖。</p></article></section><section className="canvas-v2-tutorial__shortcuts"><div><Command /><span>Keyboard map</span><h2>快捷键</h2></div><dl>{shortcuts.map(([label, key]) => <div key={label}><dt>{label}</dt><dd>{key}</dd></div>)}</dl></section></main>;
}
