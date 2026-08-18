import { useCallback, useEffect, useState } from "react";
import { Archive, ArrowLeft, LayoutGrid, LoaderCircle, RefreshCw } from "lucide-react";
import { getCanvas } from "./canvas-api";
import type { CanvasProjectDetail } from "./canvas-types";
import { relativeTime } from "./format";

/**
 * 画布工作台（M1：数据链路 + 过渡外壳；M2 起在此之上接入编辑器主体）。
 * 接管 /studio/canvas/:id 路由。
 */
export function CanvasWorkspace({ canvasId, navigate }: { canvasId: string; navigate: (path: string) => void }) {
  const [project, setProject] = useState<CanvasProjectDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setProject(await getCanvas(canvasId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "画布暂时无法载入");
    } finally {
      setLoading(false);
    }
  }, [canvasId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="canvas-workspace">
      <header className="canvas-workspace__head">
        <button className="canvas-workspace__back" onClick={() => navigate("/studio/canvas")}><ArrowLeft /> 画布列表</button>
        {project && !loading && !error && (
          <div className="canvas-workspace__title">
            <h1>{project.title}</h1>
            <span>{project.document?.nodes.length ?? 0} 个节点 · 更新于 {relativeTime(project.updatedAt, now)}</span>
          </div>
        )}
      </header>
      <div className="canvas-workspace__stage">
        {loading ? (
          <div className="canvas-workspace__state"><LoaderCircle className="spin" /> 正在载入画布</div>
        ) : error ? (
          <div className="workspace-error">
            <Archive />
            <h1>画布暂时无法载入</h1>
            <p>{error}</p>
            <button onClick={() => void load()}><RefreshCw /> 重新载入</button>
          </div>
        ) : project?.document ? (
          <div className="canvas-workspace__placeholder">
            <span className="canvas-workspace__placeholder-mark"><LayoutGrid /></span>
            <b>画布编辑器准备就绪</b>
            <p>编辑器主体将在下一阶段接入：节点排版、连线、缩放与组织能力即将到来。</p>
            <small>{project.document.nodes.length} 个节点 · {project.document.connections.length} 条连线</small>
          </div>
        ) : (
          <div className="workspace-error">
            <Archive />
            <h1>画布数据异常</h1>
            <p>画布文档无法解析，请重试。</p>
            <button onClick={() => void load()}><RefreshCw /> 重新载入</button>
          </div>
        )}
      </div>
    </div>
  );
}
