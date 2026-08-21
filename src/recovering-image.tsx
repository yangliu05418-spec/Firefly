import { useCallback, useEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";

const DEFAULT_RETRY_DELAYS = [2_000, 6_000] as const;

export type ImageRecoveryState = {
  phase: "retrying" | "failed";
  retry: () => void;
  retryInMs?: number;
};

type RecoveringImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError" | "onLoad"> & {
  src: string;
  fallback: (state: ImageRecoveryState) => ReactNode;
  retryDelays?: readonly number[];
  onLoad?: ImgHTMLAttributes<HTMLImageElement>["onLoad"];
};

type RecoveringThumbnailProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> & {
  src: string;
  fallbackClassName?: string;
  manualRecovery?: boolean;
};

type InternalState = { source: string; cycle: number; attempt: number; phase: "loading" | "ready" | "retrying" | "failed" };
const initialState = (source: string): InternalState => ({ source, cycle: 0, attempt: 0, phase: "loading" });

/** Bust only Firefly's stable authenticated route; never mutate a TOS signature. */
export function imageRetrySource(source: string, token: number, origin = typeof location === "undefined" ? "https://firefly.invalid" : location.origin) {
  if (!token) return source;
  try {
    const url = new URL(source, origin);
    if (url.origin !== origin || !url.pathname.startsWith("/api/")) return source;
    url.searchParams.set("_ff_retry", String(token));
    return source.startsWith("/") ? `${url.pathname}${url.search}${url.hash}` : url.toString();
  } catch { return source; }
}

export function RecoveringImage({ src, fallback, retryDelays = DEFAULT_RETRY_DELAYS, onLoad, ...imageProps }: RecoveringImageProps) {
  const [state, setState] = useState<InternalState>(() => initialState(src));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = state.source === src ? state : initialState(src);
  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    clearTimer();
    setState(initialState(src));
    return clearTimer;
  }, [clearTimer, src]);

  const retry = useCallback(() => {
    clearTimer();
    setState((previous) => ({ source: src, cycle: previous.source === src ? previous.cycle + 1 : 1, attempt: 0, phase: "loading" }));
  }, [clearTimer, src]);

  if (current.phase === "retrying" || current.phase === "failed") {
    return fallback({ phase: current.phase, retry, retryInMs: current.phase === "retrying" ? retryDelays[current.attempt] : undefined });
  }

  const token = current.cycle * 10 + current.attempt;
  return <img {...imageProps} key={`${src}:${token}`} src={imageRetrySource(src, token)} onLoad={(event) => {
    clearTimer();
    setState((previous) => previous.source === src ? { ...previous, phase: "ready" } : previous);
    onLoad?.(event);
  }} onError={() => {
    clearTimer();
    if (current.attempt >= retryDelays.length) {
      setState((previous) => previous.source === src ? { ...previous, phase: "failed" } : previous);
      return;
    }
    const delay = retryDelays[current.attempt] ?? 0;
    setState((previous) => previous.source === src ? { ...previous, phase: "retrying" } : previous);
    timer.current = setTimeout(() => {
      timer.current = null;
      setState((previous) => previous.source === src ? { ...previous, attempt: current.attempt + 1, phase: "loading" } : previous);
    }, delay);
  }} />;
}

/** Shared compact recovery UI. Disable manualRecovery when rendered inside another button. */
export function RecoveringThumbnail({ fallbackClassName, manualRecovery = true, alt, ...props }: RecoveringThumbnailProps) {
  return <RecoveringImage {...props} alt={alt} fallback={({ phase, retry }) => {
    const failed = phase === "failed";
    const interactive = failed && manualRecovery;
    const activate = (event: { stopPropagation: () => void }) => { event.stopPropagation(); if (interactive) retry(); };
    return <span
      className={fallbackClassName ?? "image-recovery-fallback"}
      role={interactive ? "button" : "status"}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `重新加载${alt || "图片"}` : failed ? `${alt || "图片"}暂时无法载入` : "正在重新载入图片"}
      title={interactive ? "图片载入失败，点击重新加载" : failed ? "图片暂时无法载入" : "正在重新载入图片"}
      onClick={interactive ? activate : undefined}
      onKeyDown={interactive ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate(event);
        }
      } : undefined}
    >
      {failed ? <RefreshCw /> : <LoaderCircle className="spin" />}
      {interactive && <small>重新加载</small>}
    </span>;
  }} />;
}
