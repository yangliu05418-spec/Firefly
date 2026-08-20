import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, Film, RefreshCw, Trash2 } from "lucide-react";
import { api } from "../../api";
import type { ModelCapability, Task } from "../../types";

const statusText: Record<Task["status"], string> = { queued: "等待调度", submitting: "正在提交", running: "正在生成", succeeded: "生成完成", failed: "生成失败" };
export const taskStatusText = (task: Task) => task.status === "succeeded" && task.mediaStatus === "archiving" ? "正在归档成片" : task.status === "succeeded" && task.mediaStatus === "failed" ? "成片归档待恢复" : statusText[task.status];
export const waitingMoments = [
  { title: "镜头正在成形", detail: "正在理解画面、运动与声音之间的关系" },
  { title: "让画面慢慢呼吸", detail: "细节会在时间里找到自己的位置" },
  { title: "正在组织光线与节奏", detail: "每一帧都在向同一个方向靠拢" },
  { title: "故事仍在暗房里显影", detail: "可以离开页面，任务会在队列中继续" },
  { title: "正在打磨镜头的质感", detail: "成片完成后会自动出现在这里" },
  { title: "最后一点耐心，也属于创作", detail: "Firefly 正在守候这段镜头完成" }
];

export type MediaState = "idle" | "loading" | "ready" | "buffering" | "error";
type MediaEventName = "metadata" | "canplay" | "playing" | "waiting" | "stalled" | "error" | "download_click";

export const reportMediaEvent = (taskId: string, event: MediaEventName, startedAt: number, video?: HTMLVideoElement, bufferingMs?: number) => {
  let bufferedAhead: number | undefined;
  if (video) {
    for (let index = 0; index < video.buffered.length; index++) {
      if (video.buffered.start(index) <= video.currentTime && video.buffered.end(index) >= video.currentTime) {
        bufferedAhead = Math.max(0, video.buffered.end(index) - video.currentTime);
        break;
      }
    }
  }
  void api.post("/api/media-events", {
    taskId,
    event,
    elapsedMs: Math.min(24 * 3600 * 1000, Math.max(0, Date.now() - startedAt)),
    readyState: video?.readyState,
    networkState: video?.networkState,
    currentTime: video && Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : undefined,
    bufferedAhead,
    bufferingMs
  }).catch(() => undefined);
};

export const copyPlainText = async (text: string) => {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const input = document.createElement("textarea"); input.value = text; input.setAttribute("readonly", ""); input.style.position = "fixed"; input.style.opacity = "0";
    document.body.append(input); input.select(); const copied = document.execCommand("copy"); input.remove(); return copied;
  }
};

export function CaseIdButton({ task, compact = false }: { task: Task; compact?: boolean }) {
  const [copied, setCopied] = useState(false); const resetTimer = useRef<number | null>(null); const caseId = task.caseId || task.id;
  useEffect(() => () => { if (resetTimer.current !== null) window.clearTimeout(resetTimer.current); }, []);
  const copy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const success = await copyPlainText(caseId); setCopied(success);
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopied(false), 2200);
  };
  return <button className={`case-id-button ${compact ? "case-id-button--compact" : ""} ${copied ? "is-copied" : ""}`} onClick={copy} title={`复制 Case ID：${caseId}`} aria-label={`复制 Case ID ${caseId}`}>{copied ? <Check /> : <Copy />}{!compact && <span>{copied ? "已复制" : `Case ${caseId.slice(0, 8)}`}</span>}</button>;
}

export function TaskCard({ task, models, eager, now, onDelete, canDelete = false }: { task: Task; models: ModelCapability[]; eager: boolean; now: number; onDelete: (task: Task) => void; canDelete?: boolean }) {
  const model = models.find((item) => item.id === task.model);
  const expired = Boolean(task.videoExpiresAt && task.videoExpiresAt <= now);
  const mediaFailed = task.status === "succeeded" && task.mediaStatus === "failed";
  const [quoteIndex, setQuoteIndex] = useState(() => Math.abs(task.id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) % waitingMoments.length);
  const cardRef = useRef<HTMLElement>(null); const retryTimer = useRef<number | null>(null); const readyOnce = useRef(false); const loadStartedAt = useRef(Date.now()); const bufferingStartedAt = useRef<number | null>(null); const resumeTime = useRef(0);
  const [nearViewport, setNearViewport] = useState(eager); const [mediaState, setMediaState] = useState<MediaState>("idle"); const [retryCount, setRetryCount] = useState(0); const [downloadNotice, setDownloadNotice] = useState(""); const [copyNotice, setCopyNotice] = useState("");
  const shouldLoadVideo = task.status === "succeeded" && Boolean(task.videoUrl) && !expired && (eager || nearViewport);
  const reportTaskMediaEvent = (event: MediaEventName, video?: HTMLVideoElement, bufferingMs?: number) => reportMediaEvent(task.id, event, loadStartedAt.current, video, bufferingMs);
  useEffect(() => {
    if (["succeeded", "failed"].includes(task.status)) return;
    const timer = window.setInterval(() => setQuoteIndex((index) => (index + 1) % waitingMoments.length), 5600);
    return () => window.clearInterval(timer);
  }, [task.status]);
  useEffect(() => {
    if (eager) { setNearViewport(true); return; }
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === "undefined") { setNearViewport(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setNearViewport(true); observer.disconnect(); }
    }, { rootMargin: "480px 0px", threshold: 0.01 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [eager]);
  useEffect(() => {
    if (!shouldLoadVideo) return;
    loadStartedAt.current = Date.now(); setMediaState("loading");
    return () => { if (retryTimer.current !== null) window.clearTimeout(retryTimer.current); };
  }, [shouldLoadVideo, task.videoUrl, task.mediaRevision]);
  useEffect(() => {
    readyOnce.current = false; resumeTime.current = 0; bufferingStartedAt.current = null; setRetryCount(0);
  }, [task.id, task.mediaRevision]);
  useEffect(() => {
    const resume = () => { if (mediaState === "error" && shouldLoadVideo) retryMedia(); };
    window.addEventListener("online", resume);
    return () => window.removeEventListener("online", resume);
  }, [mediaState, shouldLoadVideo]);
  const waitingMoment = waitingMoments[quoteIndex];
  const retryMedia = () => { if (retryTimer.current !== null) window.clearTimeout(retryTimer.current); setMediaState("loading"); setRetryCount((count) => count + 1); };
  const handleMediaError = (video: HTMLVideoElement) => {
    reportTaskMediaEvent("error", video);
    if (readyOnce.current && Number.isFinite(video.currentTime)) resumeTime.current = Math.max(0, video.currentTime);
    if (!navigator.onLine) { setMediaState("error"); return; }
    if (!readyOnce.current && retryCount < 2 && !expired) {
      setMediaState("loading");
      retryTimer.current = window.setTimeout(() => setRetryCount((count) => count + 1), [2000, 6000][retryCount]);
      return;
    }
    setMediaState("error");
  };
  const copyVideoLink = async () => {
    if (!task.videoUrl || expired) return;
    try { await navigator.clipboard.writeText(new URL(task.videoUrl, window.location.origin).href); setCopyNotice("链接已复制"); } catch { setCopyNotice("复制失败，请使用下载按钮"); }
    window.setTimeout(() => setCopyNotice(""), 2400);
  };
  return <article id={`task-${task.id}`} ref={cardRef} className={`task-card task-card--${task.status}${mediaFailed ? " task-card--media-failed" : ""}`}>
    <header><div><span className="status-pulse" /><b>{taskStatusText(task)}</b><small>{new Date(task.createdAt).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small>{task.visibility === "shared" && <small className="shared-mark">团队历史</small>}</div><span>{model?.name ?? task.model} · {task.ratio} · {task.resolution} · {task.duration}s <CaseIdButton task={task} />{canDelete && <button className="task-delete" title="删除项目" onClick={() => onDelete(task)}><Trash2 /></button>}</span></header>
    <p>{task.prompt || "基于参考素材生成"}</p>
    {task.status === "succeeded" && task.videoUrl ? <div className="video-result"><div className="video-stage">{shouldLoadVideo && <video key={`${task.id}-${task.mediaRevision ?? 0}-${retryCount}`} src={task.videoUrl} poster={task.posterUrl} controls playsInline preload={eager ? "auto" : "metadata"} onLoadedMetadata={(event) => { const video = event.currentTarget; if (resumeTime.current > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(resumeTime.current, Math.max(0, video.duration - 0.1)); reportTaskMediaEvent("metadata", video); }} onCanPlay={(event) => { const firstCanPlay = !readyOnce.current; readyOnce.current = true; setMediaState("ready"); if (firstCanPlay) reportTaskMediaEvent("canplay", event.currentTarget); }} onPlaying={(event) => { const bufferingMs = bufferingStartedAt.current === null ? undefined : Math.min(3600 * 1000, Date.now() - bufferingStartedAt.current); bufferingStartedAt.current = null; setMediaState("ready"); reportTaskMediaEvent("playing", event.currentTarget, bufferingMs); }} onWaiting={(event) => { const video = event.currentTarget; if (!readyOnce.current || (video.paused && !video.seeking) || bufferingStartedAt.current !== null) return; bufferingStartedAt.current = Date.now(); setMediaState("buffering"); reportTaskMediaEvent("waiting", video); }} onStalled={(event) => { const video = event.currentTarget; if (!readyOnce.current || (video.paused && !video.seeking) || bufferingStartedAt.current !== null) return; bufferingStartedAt.current = Date.now(); setMediaState("buffering"); reportTaskMediaEvent("stalled", video); }} onError={(event) => handleMediaError(event.currentTarget)} />}{(!shouldLoadVideo || mediaState !== "ready") && <div className={`video-loading video-loading--${mediaState}`} aria-live="polite"><div className="film-window"><Film /><span /><i /></div><b>{expired ? "预览链接已过期" : mediaState === "error" ? navigator.onLine ? "预览连接失败" : "网络连接已断开" : mediaState === "buffering" ? "正在继续缓冲" : shouldLoadVideo ? "正在载入第一帧" : "靠近时自动载入预览"}</b><small>{expired ? "成片正在重新归档，请稍后再试" : mediaState === "error" ? navigator.onLine ? "播放位置已保留，可重新加载预览" : "网络恢复后将自动重新连接" : "Firefly 正在从北京媒体存储准备画面"}</small>{mediaState === "error" && !expired && navigator.onLine && <button onClick={retryMedia}><RefreshCw /> 重新加载预览</button>}</div>}</div><div className="video-result__footer"><span>{expired ? "预览链接已过期" : downloadNotice || (task.mediaSource === "upstream" ? "临时源预览中，归档完成后将提供稳定入口" : "成片已安全归档，可随时预览与下载")}</span><div className="video-actions">{!expired && <button title="复制受保护的预览入口" onClick={copyVideoLink}><Copy /> {copyNotice || "复制入口"}</button>}{expired ? <button disabled><Download /> 下载暂不可用</button> : <a href={task.downloadUrl ?? task.videoUrl} target="_blank" rel="noreferrer" onClick={() => { setDownloadNotice("已交给浏览器下载器，可在下载列表中继续"); reportTaskMediaEvent("download_click"); }}><Download /> 下载视频</a>}</div></div></div> : task.status === "failed" ? <div className="task-error">{task.error ?? "生成失败，请检查素材与参数后重试"}</div> : <div className={`generation-visual ${mediaFailed ? "generation-visual--recovery" : ""}`}><div className="film-window"><Film /><span /><i /></div><div className="progress-copy"><div className="waiting-quote" aria-live="polite" key={quoteIndex}><b>{mediaFailed ? "成片尚未完成安全归档" : task.status === "succeeded" && task.mediaStatus === "archiving" ? "正在归档到北京 TOS" : task.status === "queued" ? "正在等待一束空闲的算力" : waitingMoment.title}</b><small>{mediaFailed ? "不会使用临时源；系统将在有效期内自动重试" : task.status === "succeeded" && task.mediaStatus === "archiving" ? "完成校验后将自动开放预览与下载" : task.status === "queued" ? "已进入安全队列，可以放心离开页面" : waitingMoment.detail}</small></div><code>{task.providerId ? `TASK / ${task.providerId.slice(0, 18)}…` : "SECURELY SUBMITTING PARAMETERS"}</code></div></div>}
  </article>;
}
