/**
 * 懒加载视频节点内容：IntersectionObserver（rootMargin 480px）靠近才加载，
 * preload metadata、断线自动重连、播放位置保留（复用 TaskCard 的成熟模式）。
 */
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";

type MediaState = "idle" | "loading" | "ready" | "buffering" | "error";

export function LazyCanvasVideo({ src }: { src: string | null }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [state, setState] = useState<MediaState>(src ? "idle" : "error");
  const [retryCount, setRetryCount] = useState(0);
  const retryTimer = useRef<number | null>(null);
  const resumeTime = useRef(0);
  const readyOnce = useRef(false);

  useEffect(() => {
    if (!src) {
      setState("error");
      return;
    }
    setInView(false);
    setState("idle");
    const node = wrapRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    }, { rootMargin: "480px 0px", threshold: 0.01 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [src]);

  useEffect(() => {
    if (!inView || !src) return;
    setState("loading");
    return () => {
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    };
  }, [inView, src, retryCount]);

  useEffect(() => {
    readyOnce.current = false;
    resumeTime.current = 0;
    setRetryCount(0);
  }, [src]);

  useEffect(() => {
    const resume = () => {
      if (state === "error" && inView && src && navigator.onLine) retry();
    };
    window.addEventListener("online", resume);
    return () => window.removeEventListener("online", resume);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, inView, src]);

  const retry = () => {
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    setRetryCount((count) => count + 1);
  };

  const handleError = (video: HTMLVideoElement) => {
    if (readyOnce.current && Number.isFinite(video.currentTime)) resumeTime.current = Math.max(0, video.currentTime);
    if (!navigator.onLine) {
      setState("error");
      return;
    }
    if (!readyOnce.current && retryCount < 2) {
      setState("loading");
      retryTimer.current = window.setTimeout(() => setRetryCount((count) => count + 1), [2000, 6000][retryCount]);
      return;
    }
    setState("error");
  };

  return (
    <div ref={wrapRef} className="canvas-node__video-wrap" data-canvas-no-zoom>
      {inView && src && (
        <video
          key={retryCount}
          src={src}
          controls
          playsInline
          preload="metadata"
          className="canvas-node__video"
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            if (resumeTime.current > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(resumeTime.current, Math.max(0, video.duration - 0.1));
          }}
          onCanPlay={() => {
            readyOnce.current = true;
            setState("ready");
          }}
          onPlaying={() => setState("ready")}
          onWaiting={(event) => {
            if (readyOnce.current && !event.currentTarget.paused) setState("buffering");
          }}
          onStalled={(event) => {
            if (readyOnce.current && !event.currentTarget.paused) setState("buffering");
          }}
          onError={(event) => handleError(event.currentTarget)}
        />
      )}
      {src && (!inView || state !== "ready") && (
        <div className={"canvas-node__media-status canvas-node__media-status--" + state} role="status" aria-live="polite">
          {state === "error" ? (
            <>
              <b>{navigator.onLine ? "视频加载失败" : "网络连接已断开"}</b>
              {navigator.onLine && (
                <button type="button" onClick={retry} onMouseDown={(event) => event.stopPropagation()}>
                  <RefreshCw /> 重试
                </button>
              )}
            </>
          ) : state === "loading" || state === "buffering" ? (
            <>
              <LoaderCircle className="spin" />
              <b>{state === "buffering" ? "正在继续缓冲" : "正在载入视频"}</b>
            </>
          ) : (
            <b>靠近时自动载入</b>
          )}
        </div>
      )}
      {!src && (
        <div className="canvas-node__media-status canvas-node__media-status--error" role="status">
          <b>视频不可用</b>
        </div>
      )}
    </div>
  );
}
