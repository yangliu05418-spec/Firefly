import { Download, ImageIcon, LayoutGrid, LoaderCircle } from "lucide-react";
import type { ImageGenerationTask } from "../../types";
import { waitingMoments } from "./TaskCard";

export function ImageResultsGallery({ tasks, onInsertCanvas }: { tasks: ImageGenerationTask[]; onInsertCanvas: (target: { kind: "generated"; mediaId: string; title: string }) => void }) {
  if (!tasks.length) return null;
  return <section className="image-results" aria-label="图片生成结果">
    {tasks.map((task) => { const waiting = waitingMoments[task.id.length % waitingMoments.length]!; return <article className={`image-result image-result--${task.status}`} key={task.id}>
      <header><span className="image-result__badge"><ImageIcon /> 图片生成</span><b>{task.modelName}</b><small>{task.ratio} · {task.resolution}px · {task.status === "succeeded" ? `${task.Items.length} 张` : task.status === "failed" ? "生成失败" : task.status === "running" ? "正在生成" : "等待调度"} · {new Date(task.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small></header>
      {task.prompt && <p className="image-result__prompt" title={task.prompt}>「{task.prompt}」</p>}
      {(task.status === "queued" || task.status === "running") && <div className="image-result__waiting" role="status" aria-live="polite"><span><LoaderCircle className="spin" /></span><p><b>{waiting.title}</b><small>{waiting.detail}</small></p></div>}
      {!!task.Items.length && <div className="image-result__grid">
        {task.Items.map((item) => <figure key={item.mediaId}>
          <img src={"/api/image-media/" + encodeURIComponent(item.mediaId)} alt={task.prompt || "生成图片"} loading="lazy" decoding="async" />
          <figcaption>
            <a href={"/api/image-media/" + encodeURIComponent(item.mediaId) + "?download=1"} download title="下载图片"><Download /> 下载</a>
            <button onClick={() => onInsertCanvas({ kind: "generated", mediaId: item.mediaId, title: (task.prompt || "生成图片").slice(0, 24) })} title="插入画布"><LayoutGrid /> 插入画布</button>
          </figcaption>
        </figure>)}
      </div>}
      {!!task.Failed.length && task.status === "succeeded" && <p className="image-result__failed" role="alert">{task.Failed.length} 张生成失败，其余结果已保留</p>}
      {task.status === "failed" && <p className="image-result__failed" role="alert">{task.error ?? task.Failed[0] ?? "图片生成失败，请调整参数后重试"}</p>}
    </article>; })}
  </section>;
}
