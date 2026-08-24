import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Archive, ArrowRight, Check, ChevronRight, Copy, Download, Film, Home, ImageIcon, LayoutGrid, LoaderCircle, LogOut, Menu, MessageSquare, PanelLeftClose, Pencil, Play, Plus, RefreshCw, RotateCcw, Search, Trash2, WandSparkles, X } from "lucide-react";
import { api, ApiError, listenForSignedOut, notifySignedOut } from "./api";
import type { CreationSession, GenerationCapacity, ImageResultBundle, LibraryAsset, ModelCapability, SessionUser, Task } from "./types";
import { CanvasProjectList } from "./features/canvas/CanvasProjectList";
import { CanvasWorkspaceGate as CanvasWorkspace } from "./features/canvas/CanvasWorkspaceGate";
import { CanvasInsertPicker } from "./features/canvas/CanvasInsertPicker";
import { ImageAssetManager } from "./features/assets/ImageAssetManager";
import { Composer } from "./features/composer/Composer";
import { AssetCacheScope } from "./asset-cache-context";
import { assetMetadataCache } from "./asset-metadata-cache";
import { createSessionRecoverably, hasActiveStudioWork, isAmbiguousSubmissionFailure, replaceSessionSnapshot, selectSessionSnapshot, upsertStudioItem } from "./studio-sync";
import { loadStudioBootstrap } from "./studio-bootstrap";
import { useAdaptiveRefresh } from "./use-adaptive-refresh";
import { composerDraftCache } from "./composer-draft-cache";
import { deactivatePrivateMediaCacheScope, forgetPrivateMediaCacheUser, persistPrivateMediaStorage, scopePrivateMediaCacheToUser } from "./private-media-cache";
import { RecoveringImage, RecoveringThumbnail } from "./recovering-image";
import { bootstrapSession } from "./auth-bootstrap";
import type { ComposerRestore, ComposerRestorePayload } from "./composer-restore";
import { hasMeaningfulComposerDraft, loadReeditPayload } from "./reedit-client";
const statusText: Record<Task["status"], string> = { queued: "等待调度", submitting: "正在提交", running: "正在生成", succeeded: "生成完成", failed: "生成失败" };
const taskStatusText = (task: Task) => task.status === "succeeded" && task.mediaStatus === "archiving" ? "正在归档成片" : task.status === "succeeded" && task.mediaStatus === "failed" ? "成片归档待恢复" : statusText[task.status];
const waitingMoments = [
  { title: "镜头正在成形", detail: "正在理解画面、运动与声音之间的关系" },
  { title: "让画面慢慢呼吸", detail: "细节会在时间里找到自己的位置" },
  { title: "正在组织光线与节奏", detail: "每一帧都在向同一个方向靠拢" },
  { title: "故事仍在暗房里显影", detail: "可以离开页面，任务会在队列中继续" },
  { title: "正在打磨镜头的质感", detail: "成片完成后会自动出现在这里" },
  { title: "最后一点耐心，也属于创作", detail: "Firefly 正在守候这段镜头完成" }
];

function FocusedModal({ labelledBy, onDismiss, className = "", children }: { labelledBy: string; onDismiss: () => void; className?: string; children: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    window.requestAnimationFrame(() => (focusable().find((item) => item.hasAttribute("autofocus")) ?? focusable()[0] ?? dialog.current)?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onDismiss(); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); dialog.current?.focus(); return; }
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [onDismiss]);
  return <div className="confirm-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onDismiss(); }}>
    <div ref={dialog} tabIndex={-1} className={`confirm-dialog ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>{children}</div>
  </div>;
}

function FireflyGlyph({ compact = false }: { compact?: boolean }) {
  return <svg className={`firefly-glyph ${compact ? "firefly-glyph--compact" : ""}`} viewBox="0 0 1024 1024" role="img" aria-label="Firefly 萤火虫标志">
    <path d="M467 397C394 330 311 259 228 197C159 146 102 108 76 115C49 123 55 178 76 226C105 292 160 345 224 371C288 397 360 399 467 397Z" />
    <path d="M535 397C608 330 691 259 774 197C843 146 900 108 926 115C953 123 947 178 926 226C897 292 842 345 778 371C714 397 642 399 535 397Z" />
    <path d="M458 417C383 422 312 430 250 446C198 459 168 479 171 508C174 545 199 574 236 581C281 590 322 572 354 539C388 504 419 462 458 417Z" />
    <path d="M544 417C619 422 690 430 752 446C804 459 834 479 831 508C828 545 803 574 766 581C721 590 680 572 648 539C614 504 583 462 544 417Z" />
    <path d="M501 425C466 477 438 533 422 596C405 662 405 735 422 799C437 855 466 887 501 887C536 887 565 855 580 799C597 735 597 662 580 596C564 533 536 477 501 425Z" />
  </svg>;
}

function GenerateNavGlyph() { return <svg className="rail-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2c1.35 4.78 4.02 7.45 8.8 8.8-4.78 1.35-7.45 4.02-8.8 8.8-1.35-4.78-4.02-7.45-8.8-8.8 4.78-1.35 7.45-4.02 8.8-8.8Z" /></svg>; }
function AssetsNavGlyph() { return <svg className="rail-glyph rail-glyph--stroke" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h6l1.8 2h9.2v8.7a2.3 2.3 0 0 1-2.3 2.3H5.8a2.3 2.3 0 0 1-2.3-2.3V7.5Z" /><path d="M3.5 7.5V6.2a2 2 0 0 1 2-2h3.2l1.8 2h7a2 2 0 0 1 2 2v1.3" /></svg>; }
function CanvasNavGlyph() { return <svg className="rail-glyph rail-glyph--canvas" viewBox="0 0 24 24" aria-hidden="true"><path className="canvas-frame" d="M6 2.5v19M2.5 6h12M2.5 18h11.5M17 2.5v7" /><path d="M17 3.2c.45 1.8 1.5 2.85 3.3 3.3-1.8.45-2.85 1.5-3.3 3.3-.45-1.8-1.5-2.85-3.3-3.3 1.8-.45 2.85-1.5 3.3-3.3ZM17.8 14.2c.55 2.1 1.8 3.35 3.9 3.9-2.1.55-3.35 1.8-3.9 3.9-.55-2.1-1.8-3.35-3.9-3.9 2.1-.55 3.35-1.8 3.9-3.9Z" /></svg>; }
function AtlasNavGlyph() { return <svg className="rail-glyph rail-glyph--atlas" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 0 100 100H70L50 49 42 64H22L50 0Z" /><path d="M10 80h58l12 20H0l10-20Z" /></svg>; }

function FireflyMark({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? "brand--compact" : ""}`}><span className="brand__glyph"><FireflyGlyph compact={compact} /></span><span>Firefly</span></div>;
}

function Landing({ enter }: { enter: () => void }) {
  return <main className="cinema-landing">
    <section className="cinema-hero" aria-labelledby="landing-quote">
      <video className="cinema-hero__film" autoPlay muted loop playsInline preload="metadata" poster="/ciridae/video-placeholder.webp?v=20260814b">
        <source src="/ciridae/hero_web.mp4?v=20260814b" type="video/mp4" />
      </video>
      <div className="cinema-hero__veil" />
      <div className="cinema-hero__brand" aria-label="Firefly">
        <FireflyGlyph />
        <span>FIREFLY</span>
      </div>
      <div className="cinema-hero__copy">
        <h1 id="landing-quote">
          <span>My fancies are fireflies, —</span>
          <span>Specks of living light</span>
          <span>twinkling in the dark.</span>
        </h1>
        <p>— Rabindranath Tagore</p>
      </div>
      <button className="cinema-hero__cta" onClick={enter}>
        <span>开始创作</span><ArrowRight size={16} />
      </button>
      <div className="cinema-hero__index" aria-hidden="true"><span>01</span><i /><span>FIREFLY · SEEDANCE STUDIO</span></div>
      <div className="cinema-hero__scroll" aria-hidden="true"><i /> SCROLL TO DISCOVER</div>
    </section>

    <section className="cinema-statement">
      <div className="cinema-statement__media"><img src="/ciridae/Hero.webp?v=20260814b" alt="星空下的湖泊与群山" /></div>
      <div className="cinema-statement__shade" />
      <div className="cinema-statement__copy">
        <span>FROM THOUGHT TO FRAME</span>
        <h2>让想象，拥有时间。</h2>
        <p>从文字、图像与声音出发，在同一个安静的创作空间里完成镜头。</p>
      </div>
    </section>

    <section className="cinema-process" aria-label="Firefly 创作能力">
      <header><span>THE WORKFLOW</span><p>清晰的输入，可靠的生成，完整的留存。</p></header>
      <div className="cinema-process__grid">
        <article>
          <img src="/ciridae/numbers-bg-new.webp?v=20260814b" alt="" />
          <div><span>01 / REFERENCE</span><h3>组织灵感</h3><p>组合官方支持的文字、图像、视频与音频参考。</p></div>
        </article>
        <article>
          <img src="/ciridae/pawel-czerwinski.webp?v=20260814b" alt="" />
          <div><span>02 / CREATE</span><h3>控制镜头</h3><p>让模型、生成模式和参数始终保持一致。</p></div>
        </article>
        <article>
          <img src="/ciridae/video-placeholder.webp?v=20260814b" alt="" />
          <div><span>03 / RETURN</span><h3>守候成片</h3><p>任务在队列中继续，完成后回到你的创作历史。</p></div>
        </article>
      </div>
    </section>

    <footer className="cinema-footer">
      <img src="/ciridae/footer-img-03.webp?v=20260814b" alt="抽象的电影感光轨" />
      <div className="cinema-footer__veil" />
      <div className="cinema-footer__mark"><FireflyGlyph /><span>FIREFLY</span></div>
      <p>SEEDANCE VIDEO STUDIO</p>
    </footer>
  </main>;
}

function AccessGate({ back }: { back: () => void }) {
  const error = new URLSearchParams(location.search).get("auth_error");
  const login = () => location.assign("/api/auth/feishu/start?returnTo=%2Fstudio");
  return <main className="access-page"><div className="ambient-grid" /><div className="access-card"><button className="back-link" onClick={back}>← 返回首页</button><FireflyMark /><h1>进入创作台</h1><p>仅向 dokuai.tv 企业成员开放，<br />首次登录会自动激活你的独立创作空间。</p><button className="primary-button feishu-login" onClick={login}>使用飞书企业账号登录 <ArrowRight size={16} /></button>{error && <div className="form-error">{error}</div>}</div></main>;
}

type MediaState = "idle" | "loading" | "ready" | "buffering" | "error";
type MediaEventName = "metadata" | "canplay" | "playing" | "waiting" | "stalled" | "error" | "download_click";

const reportMediaEvent = (taskId: string, event: MediaEventName, startedAt: number, video?: HTMLVideoElement, bufferingMs?: number) => {
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

const copyPlainText = async (text: string) => {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const input = document.createElement("textarea"); input.value = text; input.setAttribute("readonly", ""); input.style.position = "fixed"; input.style.opacity = "0";
    document.body.append(input); input.select(); const copied = document.execCommand("copy"); input.remove(); return copied;
  }
};

function CaseIdButton({ task, compact = false }: { task: Task; compact?: boolean }) {
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

function TaskCard({ task, models, eager, now, onDelete, onReedit, reeditBusy = false, canDelete = false }: { task: Task; models: ModelCapability[]; eager: boolean; now: number; onDelete: (task: Task) => void; onReedit: (kind: "video", id: string) => void; reeditBusy?: boolean; canDelete?: boolean }) {
  const model = models.find((item) => item.id === task.model);
  const temporaryAvailable = Boolean(task.temporaryVideoUrl && (!task.temporaryVideoExpiresAt || task.temporaryVideoExpiresAt > now));
  const expired = false;
  const mediaFailed = task.status === "succeeded" && task.mediaStatus === "failed";
  const [quoteIndex, setQuoteIndex] = useState(() => Math.abs(task.id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) % waitingMoments.length);
  const cardRef = useRef<HTMLElement>(null); const retryTimer = useRef<number | null>(null); const bufferWatchdog = useRef<number | null>(null); const automaticRecoveries = useRef(0); const readyOnce = useRef(false); const loadStartedAt = useRef(Date.now()); const bufferingStartedAt = useRef<number | null>(null); const resumeTime = useRef(0);
  const [nearViewport, setNearViewport] = useState(eager); const [mediaState, setMediaState] = useState<MediaState>("idle"); const [retryCount, setRetryCount] = useState(0); const [downloadNotice, setDownloadNotice] = useState(""); const [copyNotice, setCopyNotice] = useState("");
  const shouldLoadVideo = task.status === "succeeded" && Boolean(task.videoUrl) && (eager || nearViewport);
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
    return () => { if (retryTimer.current !== null) window.clearTimeout(retryTimer.current); if (bufferWatchdog.current !== null) window.clearTimeout(bufferWatchdog.current); };
  }, [shouldLoadVideo, task.videoUrl, task.mediaRevision]);
  useEffect(() => {
    readyOnce.current = false; resumeTime.current = 0; bufferingStartedAt.current = null; automaticRecoveries.current = 0; setRetryCount(0);
  }, [task.id, task.mediaRevision]);
  useEffect(() => {
    const resume = () => { if (mediaState === "error" && shouldLoadVideo) retryMedia(); };
    window.addEventListener("online", resume);
    return () => window.removeEventListener("online", resume);
  }, [mediaState, shouldLoadVideo]);
  const waitingMoment = waitingMoments[quoteIndex];
  const clearBufferWatchdog = () => { if (bufferWatchdog.current !== null) window.clearTimeout(bufferWatchdog.current); bufferWatchdog.current = null; };
  const retryMedia = () => { if (retryTimer.current !== null) window.clearTimeout(retryTimer.current); clearBufferWatchdog(); setMediaState("loading"); setRetryCount((count) => count + 1); };
  const beginBufferRecovery = (video: HTMLVideoElement, event: "waiting" | "stalled") => {
    if (!readyOnce.current || (video.paused && !video.seeking) || bufferingStartedAt.current !== null) return;
    bufferingStartedAt.current = Date.now(); setMediaState("buffering"); reportTaskMediaEvent(event, video);
    clearBufferWatchdog();
    bufferWatchdog.current = window.setTimeout(() => {
      bufferWatchdog.current = null;
      if (!navigator.onLine) { setMediaState("error"); return; }
      if (video.paused || video.ended) return;
      if (Number.isFinite(video.currentTime)) resumeTime.current = Math.max(0, video.currentTime);
      if (automaticRecoveries.current >= 2) { setMediaState("error"); return; }
      automaticRecoveries.current += 1; bufferingStartedAt.current = null; setMediaState("loading"); setRetryCount((count) => count + 1);
    }, 15_000);
  };
  const handleMediaError = (video: HTMLVideoElement) => {
    clearBufferWatchdog();
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
    if (!task.videoUrl) return;
    try { await navigator.clipboard.writeText(new URL(task.videoUrl, window.location.origin).href); setCopyNotice("链接已复制"); } catch { setCopyNotice("复制失败，请使用下载按钮"); }
    window.setTimeout(() => setCopyNotice(""), 2400);
  };
  return <article id={`task-${task.id}`} ref={cardRef} className={`task-card task-card--${task.status}${mediaFailed ? " task-card--media-failed" : ""}`}>
    <header><div><span className="status-pulse" /><b>{taskStatusText(task)}</b><small>{new Date(task.createdAt).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small>{task.visibility === "shared" && <small className="shared-mark">团队历史</small>}</div><span>{model?.name ?? task.model} · {task.ratio} · {task.resolution} · {task.duration}s <CaseIdButton task={task} />{["succeeded", "failed"].includes(task.status) && <button className="task-reedit" disabled={reeditBusy} aria-label="重新编辑这次视频创作" title="载入这次创作的提示词、参数与参考素材" onClick={() => onReedit("video", task.id)}>{reeditBusy ? <LoaderCircle className="spin" /> : <RotateCcw />}<span>{reeditBusy ? "载入中" : "重新编辑"}</span></button>}{canDelete && <button className="task-delete" aria-label="删除项目" title="删除项目" onClick={() => onDelete(task)}><Trash2 /></button>}</span></header>
    <p>{task.prompt || "基于参考素材生成"}</p>
    {task.status === "succeeded" && task.videoUrl ? <div className="video-result"><div className="video-stage">{shouldLoadVideo && <video key={`${task.id}-${task.mediaRevision ?? 0}-${retryCount}`} src={task.videoUrl} poster={task.posterUrl} controls playsInline preload={eager ? "auto" : "metadata"} onLoadedMetadata={(event) => { const video = event.currentTarget; if (resumeTime.current > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(resumeTime.current, Math.max(0, video.duration - 0.1)); reportTaskMediaEvent("metadata", video); }} onCanPlay={(event) => { const firstCanPlay = !readyOnce.current; readyOnce.current = true; setMediaState("ready"); if (firstCanPlay) reportTaskMediaEvent("canplay", event.currentTarget); }} onPlaying={(event) => { clearBufferWatchdog(); const bufferingMs = bufferingStartedAt.current === null ? undefined : Math.min(3600 * 1000, Date.now() - bufferingStartedAt.current); bufferingStartedAt.current = null; setMediaState("ready"); reportTaskMediaEvent("playing", event.currentTarget, bufferingMs); }} onWaiting={(event) => beginBufferRecovery(event.currentTarget, "waiting")} onStalled={(event) => beginBufferRecovery(event.currentTarget, "stalled")} onError={(event) => handleMediaError(event.currentTarget)} />}{(!shouldLoadVideo || mediaState !== "ready") && <div className={`video-loading video-loading--${mediaState}`} aria-live="polite"><div className="film-window"><Film /><span /><i /></div><b>{expired ? "预览链接已过期" : mediaState === "error" ? navigator.onLine ? "预览连接失败" : "网络连接已断开" : mediaState === "buffering" ? "正在继续缓冲" : shouldLoadVideo ? "正在载入第一帧" : "靠近时自动载入预览"}</b><small>{expired ? "成片正在重新归档，请稍后再试" : mediaState === "error" ? navigator.onLine ? "播放位置已保留，可重新加载预览" : "网络恢复后将自动重新连接" : "Firefly 正在从北京媒体存储准备画面"}</small>{mediaState === "error" && !expired && navigator.onLine && <button onClick={retryMedia}><RefreshCw /> 重新加载预览</button>}</div>}</div><div className="video-result__footer"><span>{expired ? "预览链接已过期" : downloadNotice || (task.downloadUrl ? "成片已安全归档，可随时预览与下载" : "兼容预览已就绪，原始成片仍在安全归档")}</span><div className="video-actions">{!expired && <button title="复制受保护的预览入口" onClick={copyVideoLink}><Copy /> {copyNotice || "复制入口"}</button>}{expired ? <button disabled><Download /> 下载暂不可用</button> : task.downloadUrl ? <a href={task.downloadUrl} target="_blank" rel="noreferrer" onClick={() => { setDownloadNotice("已交给浏览器下载器，可在下载列表中继续"); reportTaskMediaEvent("download_click"); }}><Download /> 下载视频</a> : <button disabled><Download /> 原片归档中</button>}</div></div></div> : task.status === "failed" ? <div className="task-error">{task.error ?? "生成失败，请检查素材与参数后重试"}</div> : <div className={`generation-visual ${mediaFailed ? "generation-visual--recovery" : ""}`}><div className="film-window"><Film /><span /><i /></div><div className="progress-copy"><div className="waiting-quote" aria-live="polite" key={quoteIndex}><b>{mediaFailed ? "成片尚未完成安全归档" : task.status === "succeeded" && task.mediaStatus === "archiving" ? "正在归档到北京 TOS" : task.status === "submitting" ? "正在确认任务接纳" : task.status === "queued" ? "正在等待一束空闲的算力" : waitingMoment.title}</b><small>{mediaFailed ? "不会使用临时源；系统将在有效期内自动重试" : task.status === "succeeded" && task.mediaStatus === "archiving" ? "完成校验后将自动开放预览与下载" : task.status === "submitting" ? "正在等待模型服务返回任务编号；响应中断时不会重复提交" : task.status === "queued" ? "已进入安全队列，可以放心离开页面" : waitingMoment.detail}</small></div><code>{task.providerId ? `TASK / ${task.providerId.slice(0, 18)}…` : "SECURELY SUBMITTING PARAMETERS"}</code></div></div>}
    {task.status === "succeeded" && !task.videoUrl && temporaryAvailable && <button className="temporary-preview-button" onClick={() => window.open(task.temporaryVideoUrl, "_blank", "noopener,noreferrer")}><Play /> 立即预览临时源（可能卡顿）</button>}
  </article>;
}

function UserAvatar({ user }: { user: SessionUser }) {
  const initials = (user.name || user.email).trim().slice(0, 1).toUpperCase();
  return user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span>{initials}</span>;
}

function AccountMenu({ user, close, home, logout }: { user: SessionUser; close: () => void; home: () => void; logout: () => void }) {
  return <div className="account-menu" role="menu" aria-label="账号菜单" onClick={(event) => event.stopPropagation()}>
    <div className="account-menu__identity"><div className="account-menu__avatar"><UserAvatar user={user} /></div><span><b>{user.name}</b><small>{user.email}</small></span></div>
    <div className="account-menu__space"><span>企业创作空间</span><small>项目与成片仅你可见</small></div>
    <div className="account-menu__actions">
      <button role="menuitem" onClick={() => { close(); home(); }}><Home /><span>返回首页</span><ChevronRight /></button>
      <button role="menuitem" onClick={() => { close(); logout(); }}><LogOut /><span>退出登录</span></button>
    </div>
  </div>;
}

function AssetPreview({ task, close, onDelete, initialTime, onPosition }: { task: Task; close: () => void; onDelete: (task: Task) => void; initialTime: number; onPosition: (time: number) => void }) {
  const [state, setState] = useState<MediaState>("loading"); const [retryCount, setRetryCount] = useState(0); const [downloadNotice, setDownloadNotice] = useState("");
  const startedAt = useRef(Date.now()); const readyOnce = useRef(false); const bufferingStartedAt = useRef<number | null>(null); const resumeTime = useRef(initialTime); const retryTimer = useRef<number | null>(null); const bufferWatchdog = useRef<number | null>(null); const automaticRecoveries = useRef(0); const dialogRef = useRef<HTMLDivElement>(null); const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => () => { if (retryTimer.current !== null) window.clearTimeout(retryTimer.current); if (bufferWatchdog.current !== null) window.clearTimeout(bufferWatchdog.current); }, []);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("[data-modal-initial]")?.focus());
    return () => { document.body.style.overflow = previousOverflow; opener?.focus(); };
  }, []);
  useEffect(() => () => {
    const time = videoRef.current?.currentTime;
    if (typeof time === "number" && Number.isFinite(time)) onPosition(Math.max(0, time));
  }, []);
  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],video[controls],[tabindex]:not([tabindex="-1"])') ?? [])].filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const clearBufferWatchdog = () => { if (bufferWatchdog.current !== null) window.clearTimeout(bufferWatchdog.current); bufferWatchdog.current = null; };
  const retry = () => { if (retryTimer.current !== null) window.clearTimeout(retryTimer.current); clearBufferWatchdog(); setState("loading"); setRetryCount((count) => count + 1); };
  useEffect(() => { const reconnect = () => { if (state === "error") retry(); }; window.addEventListener("online", reconnect); return () => window.removeEventListener("online", reconnect); }, [state]);
  const failed = (video: HTMLVideoElement) => {
    clearBufferWatchdog();
    reportMediaEvent(task.id, "error", startedAt.current, video);
    if (readyOnce.current && Number.isFinite(video.currentTime)) resumeTime.current = Math.max(0, video.currentTime);
    if (!readyOnce.current && retryCount < 2 && navigator.onLine) {
      setState("loading"); retryTimer.current = window.setTimeout(() => setRetryCount((count) => count + 1), [2000, 6000][retryCount]); return;
    }
    setState("error");
  };
  const beginBufferRecovery = (video: HTMLVideoElement, event: "waiting" | "stalled") => {
    if (!readyOnce.current || (video.paused && !video.seeking) || bufferingStartedAt.current !== null) return;
    bufferingStartedAt.current = Date.now(); setState("buffering"); reportMediaEvent(task.id, event, startedAt.current, video);
    clearBufferWatchdog();
    bufferWatchdog.current = window.setTimeout(() => {
      bufferWatchdog.current = null;
      if (!navigator.onLine) { setState("error"); return; }
      if (video.paused || video.ended) return;
      if (Number.isFinite(video.currentTime)) resumeTime.current = Math.max(0, video.currentTime);
      if (automaticRecoveries.current >= 2) { setState("error"); return; }
      automaticRecoveries.current += 1; bufferingStartedAt.current = null; setState("loading"); setRetryCount((count) => count + 1);
    }, 15_000);
  };
  return <div className="asset-preview-backdrop" role="dialog" aria-modal="true" aria-labelledby="asset-preview-title" onClick={close}>
    <div ref={dialogRef} className="asset-preview" onKeyDown={handleDialogKeyDown} onClick={(event) => event.stopPropagation()}>
      <header><div><span>视频预览</span><h2 id="asset-preview-title">{task.prompt || "参考素材生成"}</h2></div><button data-modal-initial aria-label="关闭预览" onClick={close}><X /></button></header>
      <div className="asset-preview__stage">
        <video ref={videoRef} key={`${task.id}-${task.mediaRevision ?? 0}-${retryCount}`} src={task.videoUrl} poster={task.posterUrl} controls playsInline preload="auto" onLoadedMetadata={(event) => { const video = event.currentTarget; if (resumeTime.current > 0 && Number.isFinite(video.duration) && resumeTime.current < video.duration - 1) video.currentTime = Math.min(resumeTime.current, Math.max(0, video.duration - 0.1)); reportMediaEvent(task.id, "metadata", startedAt.current, video); }} onTimeUpdate={(event) => { const time = event.currentTarget.currentTime; if (Number.isFinite(time)) onPosition(Math.max(0, time)); }} onEnded={() => onPosition(0)} onCanPlay={(event) => { const firstCanPlay = !readyOnce.current; readyOnce.current = true; setState("ready"); if (firstCanPlay) reportMediaEvent(task.id, "canplay", startedAt.current, event.currentTarget); }} onPlaying={(event) => { clearBufferWatchdog(); const bufferingMs = bufferingStartedAt.current === null ? undefined : Math.min(3600 * 1000, Date.now() - bufferingStartedAt.current); bufferingStartedAt.current = null; setState("ready"); reportMediaEvent(task.id, "playing", startedAt.current, event.currentTarget, bufferingMs); }} onWaiting={(event) => beginBufferRecovery(event.currentTarget, "waiting")} onStalled={(event) => beginBufferRecovery(event.currentTarget, "stalled")} onError={(event) => failed(event.currentTarget)} />
        {state !== "ready" && <div className={`asset-preview__status asset-preview__status--${state}`} aria-live="polite"><div className="film-window"><Film /><span /><i /></div><b>{state === "error" ? navigator.onLine ? "预览连接失败" : "网络连接已断开" : state === "buffering" ? "正在继续缓冲" : "正在载入成片"}</b><small>{state === "error" ? navigator.onLine ? "播放位置已保留，可重新加载" : "网络恢复后将自动重新连接" : "正在从北京媒体存储准备画面"}</small>{state === "error" && navigator.onLine && <button onClick={retry}><RefreshCw /> 重新加载</button>}</div>}
      </div>
      <footer><span>{downloadNotice || `${new Date(task.createdAt).toLocaleString("zh-CN")} · ${task.resolution} · ${task.ratio}`}</span><div><CaseIdButton task={task} /><button onClick={() => { close(); onDelete(task); }}><Trash2 /> 删除</button><a href={task.downloadUrl ?? task.videoUrl} target="_blank" rel="noreferrer" onClick={() => { setDownloadNotice("已交给浏览器下载器，可在下载列表中继续"); reportMediaEvent(task.id, "download_click", startedAt.current); }}><Download /> 下载视频</a></div></footer>
    </div>
  </div>;
}

function AssetArchive({ tasks, imageResults, models, onCreate, onDelete, onRemoveImage, onReedit, reeditBusyId, onInsertCanvas }: { tasks: Task[]; imageResults: ImageResultBundle[]; models: ModelCapability[]; onCreate: () => void; onDelete: (task: Task) => void; onRemoveImage: (id: string) => void; onReedit: (kind: "video" | "image", id: string) => void; reeditBusyId: string | null; onInsertCanvas: (target: { kind: "video"; task: Task } | { kind: "image"; asset: LibraryAsset } | { kind: "generated"; mediaId: string; title: string }) => void }) {
  const [assetView, setAssetView] = useState<"videos" | "images">(() => new URLSearchParams(location.search).get("view") === "images" ? "images" : "videos"); const [query, setQuery] = useState(""); const [preview, setPreview] = useState<Task | null>(null); const [downloadNotice, setDownloadNotice] = useState<{ task: Task; message: string } | null>(null); const noticeTimer = useRef<number | null>(null); const playbackPositions = useRef(new Map<string, number>());
  const selectAssetView = (next: "videos" | "images") => {
    setAssetView(next); setPreview(null);
    const url = new URL(location.href);
    if (next === "images") url.searchParams.set("view", "images"); else url.searchParams.delete("view");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };
  const archived = useMemo(() => tasks.filter((task) => task.visibility !== "shared" && task.status === "succeeded" && task.mediaStatus === "ready" && task.videoUrl), [tasks]);
  const filtered = useMemo(() => archived.filter((task) => (task.prompt || "参考素材生成").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [archived, query]);
  useEffect(() => () => { if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current); }, []);
  const announceDownload = (task: Task) => {
    reportMediaEvent(task.id, "download_click", Date.now());
    setDownloadNotice({ task, message: "已交给浏览器下载器" });
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setDownloadNotice(null), 5200);
  };
  const copyDownloadEntry = async () => {
    if (!downloadNotice) return;
    const url = downloadNotice.task.downloadUrl ?? downloadNotice.task.videoUrl;
    try {
      if (!url) throw new Error("missing download url");
      await navigator.clipboard.writeText(new URL(url, window.location.origin).href);
      setDownloadNotice({ ...downloadNotice, message: "下载入口已复制" });
    } catch { setDownloadNotice({ ...downloadNotice, message: "复制失败，请再次点击下载" }); }
  };
  return <div className="archive-page">
    <header className="archive-heading"><div><span>Firefly archive</span><h1>我的资产</h1><p>{assetView === "videos" ? "已完成并归档的视频会自动收录在这里。" : "管理只属于你的参考图片素材。"}</p></div>{assetView === "videos" && archived.length > 0 && <label className="archive-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索视频" aria-label="搜索视频资产" /></label>}</header>
    <nav className="asset-tabs" aria-label="资产类型"><button className={assetView === "videos" ? "active" : ""} aria-current={assetView === "videos" ? "page" : undefined} onClick={() => selectAssetView("videos")}><Film /> 视频资产</button><button className={assetView === "images" ? "active" : ""} aria-current={assetView === "images" ? "page" : undefined} onClick={() => selectAssetView("images")}><ImageIcon /> 图片资产</button></nav>
    {assetView === "images" ? <><section className="generated-image-assets"><header><span>Generated archive</span><h2>生成图片</h2><p>所有创作会话的生成结果都会汇总在这里。</p></header>{imageResults.length ? <ImageResultsGallery results={imageResults} onInsertCanvas={(target) => onInsertCanvas(target)} onRemove={onRemoveImage} onReedit={onReedit} reeditBusyId={reeditBusyId} /> : <div className="generated-image-assets__empty"><ImageIcon /><span>生成的第一张图片会出现在这里</span></div>}</section><ImageAssetManager onInsertCanvas={(asset) => onInsertCanvas({ kind: "image", asset })} /></> : <>{!archived.length ? <div className="archive-empty"><div><Archive /></div><h2>第一支成片会出现在这里</h2><p>完成一次视频生成后，Firefly 会自动整理预览、下载与创作参数。</p><button onClick={onCreate}><Plus /> 开始创作</button></div>
      : !filtered.length ? <div className="archive-empty archive-empty--search"><Search /><h2>没有找到相关视频</h2><p>换一个关键词，或清除当前搜索。</p><button onClick={() => setQuery("")}>清除搜索</button></div>
      : <div className="archive-grid">{filtered.map((task) => { const model = models.find((item) => item.id === task.model); return <article className="archive-card" key={task.id}>
        <button className="archive-card__media" onClick={() => setPreview(task)} aria-label={`预览 ${task.prompt || "生成视频"}`}>
          <div className="archive-card__fallback"><Film /><span>{task.ratio}</span></div>{task.posterUrl && <RecoveringImage key={`${task.id}-${task.mediaRevision ?? 0}`} src={task.posterUrl} alt="" loading="lazy" decoding="async" fallback={() => null} />}<span className="archive-card__play"><Play /></span><small>{task.duration}s</small>
        </button>
        <div className="archive-card__body"><h2 title={task.prompt || "参考素材生成"}>{task.prompt || "参考素材生成"}</h2><p>{model?.name ?? task.model} · {task.resolution} · {task.ratio}</p><footer><time>{new Date(task.createdAt).toLocaleDateString("zh-CN")}</time><div><CaseIdButton task={task} compact /><button disabled={reeditBusyId === task.id} aria-label="重新编辑这次视频创作" title="重新编辑" onClick={() => onReedit("video", task.id)}>{reeditBusyId === task.id ? <LoaderCircle className="spin" /> : <RotateCcw />}</button><a href={task.downloadUrl ?? task.videoUrl} target="_blank" rel="noreferrer" aria-label="下载视频" title="下载视频" onClick={() => announceDownload(task)}><Download /></a><button aria-label="插入画布" title="插入画布" onClick={() => onInsertCanvas({ kind: "video", task })}><LayoutGrid /></button><button aria-label="删除项目" title="删除项目" onClick={() => onDelete(task)}><Trash2 /></button></div></footer></div>
      </article>; })}</div>}
    {preview && <AssetPreview task={preview} close={() => setPreview(null)} onDelete={onDelete} initialTime={playbackPositions.current.get(preview.id) ?? 0} onPosition={(time) => playbackPositions.current.set(preview.id, time)} />}
    {downloadNotice && <div className="archive-download-notice" role="status" aria-live="polite"><span className="archive-download-notice__icon"><Download /></span><span><b>{downloadNotice.message}</b><small>网络中断后可从浏览器下载列表继续</small></span><button onClick={copyDownloadEntry}><Copy /> 复制入口</button></div>}</>}
  </div>;
}

function ImageResultsGallery({ results, onInsertCanvas, onRemove, onReedit, reeditBusyId }: { results: ImageResultBundle[]; onInsertCanvas: (target: { kind: "generated"; mediaId: string; title: string }) => void; onRemove: (id: string) => void; onReedit: (kind: "video" | "image", id: string) => void; reeditBusyId: string | null }) {
  if (!results.length) return null;
  return <section className="image-results" aria-label="图片生成结果">
    {results.map((result) => { const status = result.status ?? "succeeded"; const count = result.requestedCount ?? result.items.length; return <article className={`image-result image-result--${status}`} aria-busy={status === "generating" ? true : undefined} key={result.id}>
      <header><span className="image-result__badge">{status === "generating" ? <WandSparkles /> : status === "failed" ? <X /> : <ImageIcon />} {status === "generating" ? "正在生成" : status === "failed" ? "生成未完成" : "图片生成"}</span><b>{result.modelName}</b><small>{result.ratio}{result.resolution ? ` · ${result.resolution}px` : ""} · {count} 张 · {new Date(result.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small></header>
      {result.prompt && <p className="image-result__prompt" title={result.prompt}>「{result.prompt}」</p>}
      {status === "generating" ? <div className="image-result__pending" role="status"><span className="image-result__pending-mark"><WandSparkles /></span><span><b>{result.error ? "正在确认提交" : "请求已接收"}</b><small>{result.error ?? "正在生成画面，完成后会自动显示在这里。"}</small></span><div className="image-result__pending-cells" aria-hidden="true">{Array.from({ length: Math.min(4, Math.max(1, count)) }, (_, index) => <i key={index} />)}</div></div> : status === "failed" ? <div className="image-result__failure" role="alert"><X /><span><b>这次没有生成成功</b><small>{result.error ?? "请检查网络或调整参数后重新生成。"}</small></span></div> : <div className="image-result__grid">
        {result.items.map((item) => <figure key={item.mediaId} style={{ aspectRatio: result.ratio.replace(":", " / ") }}>
          <RecoveringThumbnail src={"/api/image-media/" + encodeURIComponent(item.mediaId) + "?variant=thumbnail"} alt={result.prompt || "生成图片"} loading="lazy" decoding="async" />
          <figcaption>
            <a href={"/api/image-media/" + encodeURIComponent(item.mediaId) + "?download=1"} download title="下载图片"><Download /> 下载</a>
            <button onClick={() => onInsertCanvas({ kind: "generated", mediaId: item.mediaId, title: (result.prompt || "生成图片").slice(0, 24) })} title="插入画布"><LayoutGrid /> 插入画布</button>
          </figcaption>
        </figure>)}
      </div>}
      {!!result.failed?.length && <p className="image-result__failed" role="alert">{result.failed.length} 张生成失败，可调整参数后重试</p>}
      {status !== "generating" && <div className="image-result__actions"><button className="image-result__reedit" disabled={reeditBusyId === result.id} aria-label="重新编辑这次图片创作" onClick={() => onReedit("image", result.id)} title="载入这次创作的提示词、参数与参考图">{reeditBusyId === result.id ? <LoaderCircle className="spin" /> : <RotateCcw />} 重新编辑</button><button className="image-result__remove" onClick={() => onRemove(result.id)} aria-label="删除这组图片结果" title="删除这组结果"><X /> 删除</button></div>}
    </article>; })}
  </section>;
}

type ReeditConflict = { payload: ComposerRestorePayload; destination: CreationSession; draft: Awaited<ReturnType<typeof composerDraftCache.read>> };
type ReeditUndo = { payload: ComposerRestorePayload; destination: CreationSession; expiresAt: number };

function Studio({ user, route, navigate, logout }: { user: SessionUser; route: string; navigate: (path: string) => void; logout: () => void }) {
  const view = route.startsWith("/studio/canvas") ? "canvas" : route === "/studio/assets" ? "assets" : "create";
  const routedSessionId = route.startsWith("/studio/sessions/") ? decodeURIComponent(route.slice("/studio/sessions/".length)) : "";
  const [models, setModels] = useState<ModelCapability[]>([]); const [tasks, setTasks] = useState<Task[]>([]); const [assetTasks, setAssetTasks] = useState<Task[]>([]); const [sessions, setSessions] = useState<CreationSession[]>([]); const [sidebar, setSidebar] = useState(() => window.innerWidth > 760); const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState(""); const [syncIssue, setSyncIssue] = useState(false); const [creatingNew, setCreatingNew] = useState(false); const [creatingSession, setCreatingSession] = useState(false);
  const [generationCapacity, setGenerationCapacity] = useState<GenerationCapacity | null>(null);
  const [videoAdmissionPending, setVideoAdmissionPending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null); const [deleting, setDeleting] = useState(false); const [deleteError, setDeleteError] = useState(""); const [sessionDeleteTarget, setSessionDeleteTarget] = useState<CreationSession | null>(null); const [editingSessionId, setEditingSessionId] = useState<string | null>(null); const [sessionTitleDraft, setSessionTitleDraft] = useState(""); const [sessionBusy, setSessionBusy] = useState(false); const [profileOpen, setProfileOpen] = useState(false); const [featureNotice, setFeatureNotice] = useState<{ kind: "atlas"; nonce: number; leaving?: boolean } | null>(null); const [pendingCanvasCreate, setPendingCanvasCreate] = useState(false); const [canvasInsertTarget, setCanvasInsertTarget] = useState<{ kind: "video"; task: Task } | { kind: "image"; asset: LibraryAsset } | { kind: "generated"; mediaId: string; title: string } | null>(null); const [imageResults, setImageResults] = useState<ImageResultBundle[]>([]); const [assetImageResults, setAssetImageResults] = useState<ImageResultBundle[]>([]); const [selectedSessionId, setSelectedSessionId] = useState(""); const [composerRestore, setComposerRestore] = useState<ComposerRestore | null>(null); const [reeditBusyId, setReeditBusyId] = useState<string | null>(null); const [reeditError, setReeditError] = useState(""); const [reeditInfo, setReeditInfo] = useState(""); const [reeditConflict, setReeditConflict] = useState<ReeditConflict | null>(null); const [reeditUndo, setReeditUndo] = useState<ReeditUndo | null>(null); const profileRef = useRef<HTMLDivElement>(null); const sessionRequestSequence = useRef(0); const reeditRequest = useRef<AbortController | null>(null); const atlasExitTimer = useRef<number | undefined>(undefined); const atlasAutoTimer = useRef<number | undefined>(undefined);
  const sessionCreateIntent = useRef<string | null>(null);
  const activeSessionId = routedSessionId || selectedSessionId || sessions[0]?.id || "";
  const markSessionUsed = (prompt: string) => setSessions((current) => current.map((session) => session.id === activeSessionId ? { ...session, title: session.title === "新创作" && prompt.trim() ? prompt.trim().slice(0, 40) : session.title, updatedAt: Date.now() } : session).sort((a, b) => b.updatedAt - a.updatedAt));
  const mergeImageResult = (current: ImageResultBundle[], bundle: ImageResultBundle) => upsertStudioItem(current, bundle);
  const updateImageResult = (bundle: ImageResultBundle) => { setImageResults((current) => mergeImageResult(current, bundle)); setAssetImageResults((current) => mergeImageResult(current, bundle)); };
  const removeImageResult = async (id: string) => {
    const removed = assetImageResults.find((item) => item.id === id);
    setImageResults((current) => current.filter((item) => item.id !== id));
    setAssetImageResults((current) => current.filter((item) => item.id !== id));
    try { await api.delete(`/api/image-generations/${encodeURIComponent(id)}`); }
    catch (error) {
      if (removed) { setAssetImageResults((current) => mergeImageResult(current, removed)); if (removed.sessionId === activeSessionId) setImageResults((current) => mergeImageResult(current, removed)); }
      setSyncIssue(true);
      console.warn("image history delete failed", error);
    }
  };
  const [now, setNow] = useState(Date.now());
  const activeTasks = useMemo(() => tasks.filter((task) => !["succeeded", "failed"].includes(task.status) || task.mediaStatus === "archiving"), [tasks]);
  const activeWork = useMemo(() => hasActiveStudioWork(tasks, imageResults) || (generationCapacity?.active ?? 0) > 0, [tasks, imageResults, generationCapacity?.active]);
  const archivedCount = useMemo(() => assetTasks.filter((task) => task.visibility !== "shared" && task.status === "succeeded" && task.videoUrl).length, [assetTasks]);
  const latestVideoTaskId = useMemo(() => tasks.find((task) => task.status === "succeeded" && task.videoUrl && (!task.videoExpiresAt || task.videoExpiresAt > now))?.id, [tasks, now]);
  const refreshGenerationCapacity = async () => {
    try {
      setGenerationCapacity(await api.get<GenerationCapacity>("/api/generation-capacity"));
      return true;
    } catch {
      return false;
    }
  };
  const refresh = async () => {
    if (!activeSessionId) return;
    const sequence = ++sessionRequestSequence.current;
    const query = `?sessionId=${encodeURIComponent(activeSessionId)}`;
    const [taskResult, imageResult, capacityResult] = await Promise.allSettled([api.get<Task[]>(`/api/generations${query}`), api.get<ImageResultBundle[]>(`/api/image-generations${query}`), api.get<GenerationCapacity>("/api/generation-capacity")]);
    if (sequence !== sessionRequestSequence.current) return;
    if (taskResult.status === "fulfilled") { setTasks(taskResult.value); setAssetTasks((current) => replaceSessionSnapshot(current, activeSessionId, taskResult.value)); setLoadError(""); }
    if (imageResult.status === "fulfilled") { setImageResults(imageResult.value); setAssetImageResults((current) => replaceSessionSnapshot(current, activeSessionId, imageResult.value)); }
    if (capacityResult.status === "fulfilled") setGenerationCapacity(capacityResult.value);
    setSyncIssue(taskResult.status === "rejected" || imageResult.status === "rejected" || capacityResult.status === "rejected");
    setLoading(false);
  };
  const admitNewSession = async () => {
    const requestId = sessionCreateIntent.current ?? crypto.randomUUID(); sessionCreateIntent.current = requestId;
    try {
      const session = await createSessionRecoverably(
        () => api.post<CreationSession>("/api/creation-sessions", { requestId }, { timeoutMs: 8_000 }),
        () => api.get<CreationSession>(`/api/creation-sessions/${encodeURIComponent(requestId)}`, { timeoutMs: 8_000 }),
      );
      sessionCreateIntent.current = null;
      return session;
    } catch (error) {
      if (!isAmbiguousSubmissionFailure(error)) sessionCreateIntent.current = null;
      throw error;
    }
  };
  const initialLoad = async () => {
    setLoading(true); setLoadError("");
    try {
      const loaded = await loadStudioBootstrap({
        readModels: () => api.get<ModelCapability[]>("/api/models"),
        readTasks: () => api.get<Task[]>("/api/generations"),
        readImages: () => api.get<ImageResultBundle[]>("/api/image-generations"),
        readSessions: () => api.get<CreationSession[]>("/api/creation-sessions"),
        createSession: admitNewSession,
      });
      const target = loaded.sessions.some((session) => session.id === routedSessionId) ? routedSessionId : loaded.sessions[0].id;
      const snapshot = selectSessionSnapshot(loaded.tasks, loaded.images, target);
      setModels(loaded.models); setAssetTasks(loaded.tasks); setAssetImageResults(loaded.images); setSessions(loaded.sessions); setSelectedSessionId(target); setTasks(snapshot.tasks); setImageResults(snapshot.images); setSyncIssue(loaded.degraded);
      void refreshGenerationCapacity();
      if (view === "create" && route !== `/studio/sessions/${encodeURIComponent(target)}`) navigate(`/studio/sessions/${encodeURIComponent(target)}`);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "创作台暂时无法载入"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void initialLoad(); }, []);
  useEffect(() => { if (!loading && view === "create" && activeSessionId) void refresh(); }, [activeSessionId, view]);
  useAdaptiveRefresh(!loading && Boolean(activeSessionId), activeWork, refresh);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(timer); }, []);
  useEffect(() => () => { reeditRequest.current?.abort(); if (atlasExitTimer.current) window.clearTimeout(atlasExitTimer.current); if (atlasAutoTimer.current) window.clearTimeout(atlasAutoTimer.current); }, []);
  useEffect(() => {
    if (!reeditUndo) return;
    const timer = window.setTimeout(() => setReeditUndo(null), Math.max(0, reeditUndo.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [reeditUndo]);
  useEffect(() => {
    if (!reeditInfo) return;
    const timer = window.setTimeout(() => setReeditInfo(""), 7_000);
    return () => window.clearTimeout(timer);
  }, [reeditInfo]);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (profileRef.current && !profileRef.current.contains(event.target as Node)) setProfileOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setProfileOpen(false); setEditingSessionId(null); setReeditConflict(null); if (!deleting) setDeleteTarget(null); if (!sessionBusy) setSessionDeleteTarget(null); } };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [deleting, sessionBusy]);
  const openSession = (session: CreationSession) => {
    reeditRequest.current?.abort();
    sessionRequestSequence.current += 1;
    const snapshot = selectSessionSnapshot(assetTasks, assetImageResults, session.id);
    if (composerRestore?.targetSessionId !== session.id) setComposerRestore(null);
    navigate(`/studio/sessions/${encodeURIComponent(session.id)}`); setSelectedSessionId(session.id); setCreatingNew(false); setFeatureNotice(null); setLoadError(""); setReeditError("");
    setTasks(snapshot.tasks); setImageResults(snapshot.images); setSyncIssue(false);
    if (window.innerWidth <= 760) setSidebar(false);
  };
  const createSession = async () => {
    if (creatingSession) return; reeditRequest.current?.abort(); setCreatingSession(true);
    try {
      const session = await admitNewSession();
      setComposerRestore(null);
      sessionRequestSequence.current += 1; setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]); setSelectedSessionId(session.id); setTasks([]); setImageResults([]); setCreatingNew(true); navigate(`/studio/sessions/${encodeURIComponent(session.id)}`); setSyncIssue(false);
    }
    catch { setSyncIssue(true); }
    finally { setCreatingSession(false); if (window.innerWidth <= 760) setSidebar(false); }
  };
  const readOriginalSession = async (payload: ComposerRestorePayload, signal?: AbortSignal) => {
    if (!payload.sessionId || payload.sourceSessionStatus !== "active") return undefined;
    const local = sessions.find((session) => session.id === payload.sessionId);
    if (local) return local;
    try { return await api.get<CreationSession>(`/api/creation-sessions/${encodeURIComponent(payload.sessionId)}`, { timeoutMs: 8_000, signal }); }
    catch (error) { if (error instanceof ApiError && error.status === 404) return undefined; throw error; }
  };
  const readFallbackSession = (payload: ComposerRestorePayload, signal?: AbortSignal) => api.post<CreationSession>("/api/reedit-sessions", { sourceType: payload.sourceType, sourceId: payload.sourceId }, { timeoutMs: 8_000, signal });
  const applyReedit = async (payload: ComposerRestorePayload, destination: CreationSession, backup?: ReeditUndo) => {
    await composerDraftCache.write(user.id, destination.id, payload.state);
    if (backup) setReeditUndo(backup);
    setSessions((current) => [destination, ...current.filter((session) => session.id !== destination.id)]);
    openSession(destination);
    setComposerRestore({ ...payload, nonce: Date.now(), restoreIntentId: crypto.randomUUID(), targetSessionId: destination.id });
    const notices = [...payload.adjustments.map((item) => item.reason), ...payload.warnings.map((item) => item.message)];
    setReeditInfo(notices.length ? notices.join("；") : `已恢复这次创作${payload.state.assets.length ? ` · ${payload.state.assets.length} 个参考素材` : ""}`);
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".composer-shell")?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  const recordReeditEvent = (body: { type: "reedit_draft_conflict" | "reedit_completed" | "reedit_failed"; sourceType: "video" | "image"; sourceId: string; restoreIntentId?: string; code?: string }) => {
    void api.post<void>("/api/reedit-events", body, { timeoutMs: 4_000 }).catch(() => undefined);
  };
  const consumeComposerRestore = () => {
    const current = composerRestore;
    if (!current) return;
    setComposerRestore(null);
    recordReeditEvent({ type: "reedit_completed", sourceType: current.sourceType, sourceId: current.sourceId, restoreIntentId: current.restoreIntentId });
  };
  const reeditGeneration = async (kind: "video" | "image", id: string) => {
    reeditRequest.current?.abort();
    const controller = new AbortController(); reeditRequest.current = controller;
    setReeditBusyId(id); setReeditError(""); setReeditInfo(""); setReeditConflict(null);
    try {
      const endpoint = kind === "video" ? `/api/generations/${encodeURIComponent(id)}/reedit` : `/api/image-generations/${encodeURIComponent(id)}/reedit`;
      const payload = await loadReeditPayload(endpoint, controller.signal);
      const destination = await readOriginalSession(payload, controller.signal);
      if (destination) {
        const draft = await composerDraftCache.read(user.id, destination.id);
        if (hasMeaningfulComposerDraft(draft?.state)) {
          setReeditConflict({ payload, destination, draft });
          recordReeditEvent({ type: "reedit_draft_conflict", sourceType: payload.sourceType, sourceId: payload.sourceId });
          return;
        }
        await applyReedit(payload, destination);
      } else {
        await applyReedit(payload, await readFallbackSession(payload, controller.signal));
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setReeditError(error instanceof Error ? error.message : "暂时无法载入这次创作，请稍后重试");
        recordReeditEvent({ type: "reedit_failed", sourceType: kind, sourceId: id, code: error instanceof ApiError ? String(error.status) : "client_error" });
      }
    } finally {
      if (reeditRequest.current === controller) { reeditRequest.current = null; setReeditBusyId(null); }
    }
  };
  const resolveReeditConflict = async (choice: "new" | "replace") => {
    const conflict = reeditConflict; if (!conflict) return;
    reeditRequest.current?.abort();
    const controller = new AbortController();
    reeditRequest.current = controller;
    setReeditConflict(null); setReeditBusyId(conflict.payload.sourceId);
    try {
      if (choice === "new") await applyReedit(conflict.payload, await readFallbackSession(conflict.payload, controller.signal));
      else await applyReedit(conflict.payload, conflict.destination, conflict.draft ? { payload: { ...conflict.payload, state: conflict.draft.state }, destination: conflict.destination, expiresAt: Date.now() + 30 * 60_000 } : undefined);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setReeditError(error instanceof Error ? error.message : "暂时无法恢复这次创作");
    } finally {
      if (reeditRequest.current === controller) { reeditRequest.current = null; setReeditBusyId(null); }
    }
  };
  const undoReeditReplacement = async () => {
    const undo = reeditUndo; if (!undo || undo.expiresAt <= Date.now()) return setReeditUndo(null);
    setReeditUndo(null);
    await applyReedit(undo.payload, undo.destination);
    setReeditInfo("已恢复替换前的草稿");
  };
  const showCreate = (fresh = false) => { if (fresh) { void createSession(); return; } const target = sessions.find((session) => session.id === activeSessionId) ?? sessions[0]; if (target) void openSession(target); else void createSession(); };
  const showAssets = () => { reeditRequest.current?.abort(); void persistPrivateMediaStorage(); setComposerRestore(null); navigate("/studio/assets"); setProfileOpen(false); setFeatureNotice(null); setReeditError(""); void Promise.allSettled([api.get<Task[]>("/api/generations"), api.get<ImageResultBundle[]>("/api/image-generations")]).then(([videos, images]) => { if (videos.status === "fulfilled") setAssetTasks(videos.value); if (images.status === "fulfilled") setAssetImageResults(images.value); setSyncIssue(videos.status === "rejected" || images.status === "rejected"); }); if (window.innerWidth <= 760) setSidebar(false); };
  const showCanvas = () => { reeditRequest.current?.abort(); setComposerRestore(null); navigate("/studio/canvas"); setProfileOpen(false); setFeatureNotice(null); setReeditError(""); if (window.innerWidth <= 760) setSidebar(false); };
  const createCanvasFromSidebar = () => { setPendingCanvasCreate(true); showCanvas(); };
  const dismissAtlas = () => {
    if (!featureNotice || featureNotice.leaving) return;
    if (atlasAutoTimer.current) window.clearTimeout(atlasAutoTimer.current);
    setFeatureNotice({ ...featureNotice, leaving: true });
    atlasExitTimer.current = window.setTimeout(() => setFeatureNotice(null), 700);
  };
  const activateAtlas = () => {
    setProfileOpen(false);
    if (featureNotice && !featureNotice.leaving) { dismissAtlas(); return; }
    if (atlasExitTimer.current) window.clearTimeout(atlasExitTimer.current);
    if (atlasAutoTimer.current) window.clearTimeout(atlasAutoTimer.current);
    setFeatureNotice({ kind: "atlas", nonce: Date.now() });
    atlasAutoTimer.current = window.setTimeout(() => {
      setFeatureNotice((current) => current && !current.leaving ? { ...current, leaving: true } : current);
      atlasExitTimer.current = window.setTimeout(() => setFeatureNotice(null), 700);
    }, 6400);
  };
  const requestDelete = (task: Task) => { setDeleteError(""); setDeleteTarget(task); };
  const confirmDelete = async () => { if (!deleteTarget) return; setDeleting(true); setDeleteError(""); try { await api.delete(`/api/generations/${deleteTarget.id}`); setTasks((old) => old.filter((task) => task.id !== deleteTarget.id)); setAssetTasks((old) => old.filter((task) => task.id !== deleteTarget.id)); setDeleteTarget(null); } catch (error) { setDeleteError(error instanceof Error ? error.message : "删除失败，请稍后重试"); } finally { setDeleting(false); } };
  const beginRenameSession = (session: CreationSession) => { setEditingSessionId(session.id); setSessionTitleDraft(session.title); };
  const saveSessionTitle = async (session: CreationSession) => { const title = sessionTitleDraft.trim(); if (!title || title === session.title) { setEditingSessionId(null); return; } setSessionBusy(true); try { const updated = await api.patch<CreationSession>(`/api/creation-sessions/${encodeURIComponent(session.id)}`, { title }); setSessions((current) => current.map((item) => item.id === session.id ? updated : item)); setEditingSessionId(null); } catch { setSyncIssue(true); } finally { setSessionBusy(false); } };
  const confirmDeleteSession = async () => { if (!sessionDeleteTarget) return; setSessionBusy(true); try { await api.delete(`/api/creation-sessions/${encodeURIComponent(sessionDeleteTarget.id)}`); void composerDraftCache.clearSession(user.id, sessionDeleteTarget.id); const remaining = sessions.filter((session) => session.id !== sessionDeleteTarget.id); setSessions(remaining); setSessionDeleteTarget(null); if (sessionDeleteTarget.id === activeSessionId) { if (remaining[0]) await openSession(remaining[0]); else await createSession(); } } catch { setSyncIssue(true); } finally { setSessionBusy(false); } };
  return <main className={`studio ${sidebar ? "" : "studio--collapsed"}`}>
    <div className={`intelligence-aura ${featureNotice ? featureNotice.leaving ? "intelligence-aura--leaving" : "intelligence-aura--active" : ""}`} aria-hidden="true"><i className="aura-corner aura-corner--tl" /><i className="aura-corner aura-corner--tr" /><i className="aura-corner aura-corner--br" /><i className="aura-corner aura-corner--bl" /></div>
    <nav className="app-rail" aria-label="主要导航"><button className="rail-logo" aria-label="Firefly 创作台" onClick={() => showCreate(false)}><FireflyGlyph compact /></button><div className="rail-nav"><button className={view === "create" ? "active" : ""} aria-current={view === "create" ? "page" : undefined} onClick={() => showCreate(false)}><GenerateNavGlyph /><span>生成</span></button><button className={view === "assets" ? "active" : ""} aria-current={view === "assets" ? "page" : undefined} onClick={showAssets}><AssetsNavGlyph /><span>资产</span>{archivedCount > 0 && <i title={`${archivedCount} 个资产`}>{archivedCount > 99 ? "99+" : archivedCount}</i>}</button><button className={view === "canvas" ? "active" : ""} aria-current={view === "canvas" ? "page" : undefined} onClick={showCanvas}><CanvasNavGlyph /><span>画布</span></button><button className={featureNotice && !featureNotice.leaving ? "future active-preview" : "future"} aria-pressed={Boolean(featureNotice && !featureNotice.leaving)} onClick={activateAtlas}><AtlasNavGlyph /><span>Atlas</span></button></div><div className="rail-account" ref={profileRef}><button className="rail-avatar" aria-label="打开账号菜单" aria-expanded={profileOpen} onClick={() => setProfileOpen((open) => !open)}><UserAvatar user={user} /></button>{profileOpen && <AccountMenu user={user} close={() => setProfileOpen(false)} home={() => navigate("/")} logout={logout} />}</div></nav>
    <aside className="sidebar" aria-hidden={!sidebar} inert={!sidebar ? true : undefined}><div className="sidebar-head"><span>{view === "assets" ? "资产归档" : view === "canvas" ? "画布" : "开始创作"}</span><button aria-label="收起侧栏" onClick={() => setSidebar(false)}><PanelLeftClose /></button></div>{view === "create" ? <><button className="new-chat" disabled={creatingSession} onClick={() => showCreate(true)}>{creatingSession ? <LoaderCircle className="spin" /> : <Plus />} 新创作</button><div className="sidebar-label">创作会话</div><div className="session-list">{sessions.map((session) => <div className={`session-item ${session.id === activeSessionId ? "is-active" : ""}`} key={session.id}>{editingSessionId === session.id ? <input autoFocus maxLength={64} value={sessionTitleDraft} disabled={sessionBusy} onChange={(event) => setSessionTitleDraft(event.target.value)} onBlur={() => void saveSessionTitle(session)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setEditingSessionId(null); }} aria-label="会话名称" /> : <button className="session-item__main" onClick={() => void openSession(session)}><MessageSquare /><span><b>{session.title}</b><small>{new Date(session.updatedAt).toLocaleDateString("zh-CN")}</small></span></button>}<span className="session-item__actions"><button title="重命名会话" aria-label={`重命名 ${session.title}`} onPointerDown={(event) => event.preventDefault()} onClick={() => beginRenameSession(session)}><Pencil /></button><button title="删除会话" aria-label={`删除 ${session.title}`} onClick={() => setSessionDeleteTarget(session)}><Trash2 /></button></span></div>)}{!sessions.length && <p>还没有创作会话</p>}</div></> : view === "assets" ? <><div className="asset-sidebar-summary"><span>已归档成片</span><strong>{archivedCount}</strong><p>不同创作会话的成片会统一归档在这里。</p></div><button className="new-chat new-chat--quiet" onClick={() => showCreate(true)}><Plus /> 创建新内容</button></> : <div className="canvas-sidebar-summary"><CanvasNavGlyph /><span>自由画布</span><p>把镜头、素材与灵感组织在同一张画布上，自由排版、连接创作。</p><button className="new-chat new-chat--quiet" onClick={createCanvasFromSidebar}><Plus /> 新建画布</button></div>}</aside>
    {sidebar && <button className="sidebar-scrim" aria-label="关闭侧栏" onClick={() => setSidebar(false)} />}
    <section className="workspace"><header className="workspace-head">{!sidebar && <button className="menu-button" aria-label="打开侧栏" onClick={() => setSidebar(true)}><Menu /></button>}<span>{view === "assets" ? "Firefly media archive" : view === "canvas" ? "Firefly canvas" : "Seedance video studio"}</span><div className={`system-live ${syncIssue ? "system-live--issue" : ""}`} title={syncIssue ? "与服务端的同步暂时中断，系统会自动重试" : undefined}><i /> {syncIssue ? "同步暂时中断" : activeTasks.length ? `${activeTasks.length} 项进行中` : "系统在线"}</div></header>
      {loading ? <div className="workspace-loading"><LoaderCircle className="spin" /> 正在唤醒 Firefly</div> : loadError ? <div className="workspace-error"><Archive /><h1>创作台暂时无法载入</h1><p>{loadError}</p><button onClick={() => void initialLoad()}><RefreshCw /> 重新载入</button></div> : view === "canvas" ? (route === "/studio/canvas" ? <CanvasProjectList navigate={navigate} autoCreate={pendingCanvasCreate} onAutoCreateHandled={() => setPendingCanvasCreate(false)} /> : <CanvasWorkspace canvasId={route.split("/")[3] ?? ""} navigate={navigate} user={user} logout={logout} />) : view === "assets" ? <AssetArchive tasks={assetTasks} imageResults={assetImageResults} models={models} onCreate={() => showCreate(true)} onDelete={requestDelete} onRemoveImage={(id) => void removeImageResult(id)} onReedit={(kind, id) => void reeditGeneration(kind, id)} reeditBusyId={reeditBusyId} onInsertCanvas={setCanvasInsertTarget} /> : creatingNew || (!tasks.length && !imageResults.length) ? <div className="empty-workspace"><Composer key={`${activeSessionId}:empty`} models={models} compact={false} sessionId={activeSessionId} restore={composerRestore?.targetSessionId === activeSessionId ? composerRestore : undefined} onRestoreConsumed={consumeComposerRestore} generationCapacity={generationCapacity} admissionConfirmationPending={videoAdmissionPending} onAdmissionConfirmationChange={setVideoAdmissionPending} onGenerationSettled={() => void refreshGenerationCapacity()} onCreated={(task) => { setTasks((old) => upsertStudioItem(old, task)); setAssetTasks((old) => upsertStudioItem(old, task)); setCreatingNew(false); markSessionUsed(task.prompt); }} onImagesGenerated={(bundle) => { updateImageResult(bundle); setCreatingNew(false); markSessionUsed(bundle.prompt); }} /><div className="creation-footnote">输入素材保留 7 天 · 成片将长期保存至主动删除</div></div> : <div className="conversation"><div className="conversation-inner"><ImageResultsGallery results={imageResults} onInsertCanvas={setCanvasInsertTarget} onRemove={removeImageResult} onReedit={(kind, id) => void reeditGeneration(kind, id)} reeditBusyId={reeditBusyId} />{!!tasks.length && <><div className="conversation-heading"><span>Current sequence</span><h1>创作正在发生</h1></div>{tasks.map((task) => <TaskCard key={task.id} task={task} models={models} eager={task.id === latestVideoTaskId} now={now} onDelete={requestDelete} onReedit={(kind, id) => void reeditGeneration(kind, id)} reeditBusy={reeditBusyId === task.id} canDelete={task.ownerId === user.id} />)}</>}</div><div className="composer-dock"><Composer key={`${activeSessionId}:dock`} models={models} compact sessionId={activeSessionId} restore={composerRestore?.targetSessionId === activeSessionId ? composerRestore : undefined} onRestoreConsumed={consumeComposerRestore} generationCapacity={generationCapacity} admissionConfirmationPending={videoAdmissionPending} onAdmissionConfirmationChange={setVideoAdmissionPending} onGenerationSettled={() => void refreshGenerationCapacity()} onCreated={(task) => { setTasks((old) => upsertStudioItem(old, task)); setAssetTasks((old) => upsertStudioItem(old, task)); markSessionUsed(task.prompt); }} onImagesGenerated={(bundle) => { updateImageResult(bundle); markSessionUsed(bundle.prompt); }} /></div></div>}
    </section>
    {reeditError && <div className="reedit-notice reedit-notice--error" role="alert"><span><b>无法载入这次创作</b><small>{reeditError}</small></span><button aria-label="关闭提示" onClick={() => setReeditError("")}><X /></button></div>}
    {reeditInfo && <div className="reedit-notice" role="status" aria-live="polite"><span><b>创作参数已恢复</b><small>{reeditInfo}</small></span>{reeditUndo && <button className="reedit-notice__undo" onClick={() => void undoReeditReplacement()}>撤销替换</button>}<button aria-label="关闭提示" onClick={() => setReeditInfo("")}><X /></button></div>}
    {canvasInsertTarget && <CanvasInsertPicker payload={canvasInsertTarget.kind === "video" ? { kind: "video", taskId: canvasInsertTarget.task.id, title: canvasInsertTarget.task.prompt || "参考素材生成" } : canvasInsertTarget.kind === "image" ? { kind: "image", uploadId: canvasInsertTarget.asset.UploadId ?? "", name: canvasInsertTarget.asset.Name || "图片" } : { kind: "generated", mediaId: canvasInsertTarget.mediaId, title: canvasInsertTarget.title }} onClose={() => setCanvasInsertTarget(null)} navigate={navigate} />}
    {deleteTarget && <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-title" onClick={() => !deleting && setDeleteTarget(null)}><div className="confirm-dialog" onClick={(event) => event.stopPropagation()}><span><Trash2 /></span><h2 id="delete-title">删除这次创作？</h2><p>项目与已归档成片将被删除，此操作无法撤销。</p>{deleteError && <small className="confirm-error" role="alert">{deleteError}</small>}<div><button autoFocus disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</button><button className="danger" disabled={deleting} onClick={confirmDelete}>{deleting ? <LoaderCircle className="spin" /> : <Trash2 />} 删除项目</button></div></div></div>}
    {sessionDeleteTarget && <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="session-delete-title" onClick={() => !sessionBusy && setSessionDeleteTarget(null)}><div className="confirm-dialog" onClick={(event) => event.stopPropagation()}><span><Trash2 /></span><h2 id="session-delete-title">删除“{sessionDeleteTarget.title}”？</h2><p>会话会从左侧栏移除；已归档的视频与图片仍保留在资产页。</p><div><button autoFocus disabled={sessionBusy} onClick={() => setSessionDeleteTarget(null)}>取消</button><button className="danger" disabled={sessionBusy} onClick={() => void confirmDeleteSession()}>{sessionBusy ? <LoaderCircle className="spin" /> : <Trash2 />} 删除会话</button></div></div></div>}
    {reeditConflict && <FocusedModal labelledBy="reedit-conflict-title" className="reedit-conflict-dialog" onDismiss={() => setReeditConflict(null)}><span><RotateCcw /></span><h2 id="reedit-conflict-title">这里有尚未发送的内容</h2><p>在新会话打开可完整保留当前草稿；也可以替换草稿，并在30分钟内撤销。</p><div><button onClick={() => setReeditConflict(null)}>取消</button><button onClick={() => void resolveReeditConflict("replace")}>替换当前草稿</button><button autoFocus className="primary" onClick={() => void resolveReeditConflict("new")}>在新会话打开</button></div></FocusedModal>}
    {featureNotice && <div key={`notice-${featureNotice.nonce}`} className={`feature-notice feature-notice--atlas ${featureNotice.leaving ? "feature-notice--leaving" : ""}`} role="status" aria-live="polite"><span className="feature-notice__icon"><AtlasNavGlyph /></span><span><b>Atlas</b><small>功能即将上线</small></span><button aria-label="关闭提示" onClick={dismissAtlas}><X /></button></div>}
  </main>;
}

export function App() {
  const [route, setRoute] = useState(location.pathname); const [auth, setAuth] = useState<SessionUser | null | undefined>(undefined);
  const [authError, setAuthError] = useState(false); const [authRetry, setAuthRetry] = useState(0);
  const navigate = (path: string) => { history.pushState({}, "", path); setRoute(path); };
  useEffect(() => { const pop = () => setRoute(location.pathname); addEventListener("popstate", pop); return () => removeEventListener("popstate", pop); }, []);
  useEffect(() => { let active = true; setAuthError(false); bootstrapSession({ load: () => api.get<{ authenticated: boolean; user?: SessionUser }>("/api/auth/session", { timeoutMs: 8000 }), activateMediaScope: scopePrivateMediaCacheToUser, deactivateMediaScope: deactivatePrivateMediaCacheScope }).then((user) => { if (active) setAuth(user); }).catch(() => { void deactivatePrivateMediaCacheScope(); if (active) setAuthError(true); }); return () => { active = false; }; }, [authRetry]);
  useEffect(() => listenForSignedOut((reason) => { if (reason === "explicit" && auth?.id) { void assetMetadataCache.clear(auth.id); void composerDraftCache.clearUser(auth.id); void forgetPrivateMediaCacheUser(); } else void deactivatePrivateMediaCacheScope(); setAuth(null); }), [auth?.id]);
  if (route === "/") return <Landing enter={() => navigate("/studio")} />;
  if (auth === undefined) return <main className="boot"><FireflyMark />{authError ? <div className="boot-recovery" role="alert"><p>暂时无法确认登录状态</p><small>网络或会话服务正在恢复，你的登录 Cookie 没有被清除。</small><button className="primary-button" onClick={() => setAuthRetry((value) => value + 1)}><RefreshCw /> 重新连接</button></div> : <LoaderCircle className="spin" />}</main>;
  if (!auth) return <AccessGate back={() => navigate("/")} />;
  return <AssetCacheScope userId={auth.id}><Studio user={auth} route={route} navigate={navigate} logout={async () => { await api.delete("/api/auth/session"); notifySignedOut("explicit"); navigate("/"); }} /></AssetCacheScope>;
}
