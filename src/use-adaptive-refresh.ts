import { useEffect, useRef } from "react";

export const adaptiveRefreshDelay = (active: boolean, hidden: boolean) => active
  ? hidden ? 15_000 : 2_000
  : hidden ? 5 * 60_000 : 60_000;

/** A single non-overlapping refresh loop that follows browser visibility and connectivity. */
export const useAdaptiveRefresh = (enabled: boolean, active: boolean, refresh: () => Promise<void>) => {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let running = false;
    let rerun = false;
    let timer: number | undefined;

    const schedule = () => {
      if (disposed) return;
      timer = window.setTimeout(run, adaptiveRefreshDelay(active, document.hidden));
    };
    const run = async () => {
      if (running) { rerun = true; return; }
      if (timer) window.clearTimeout(timer);
      running = true;
      try {
        if (navigator.onLine) await refreshRef.current();
      } catch {
        // The caller owns visible sync state; the loop must still recover and reschedule.
      } finally {
        running = false;
        if (disposed) return;
        if (rerun) { rerun = false; void run(); }
        else schedule();
      }
    };
    const resume = () => {
      if (timer) window.clearTimeout(timer);
      if (!document.hidden && navigator.onLine) void run();
      else schedule();
    };

    schedule();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [active, enabled]);
};
