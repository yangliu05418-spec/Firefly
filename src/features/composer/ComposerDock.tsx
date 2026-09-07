import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Reserve the complete fixed dock, including the mobile navigation offset. */
export function ComposerDock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const dock = ref.current;
    const workspace = dock?.closest<HTMLElement>(".workspace");
    if (!dock || !workspace) return;
    const root = document.documentElement;
    const previousScrollPadding = root.style.scrollPaddingBottom;
    const update = () => {
      const clearance = Math.max(0, Math.ceil(window.innerHeight - dock.getBoundingClientRect().top)) + 24;
      workspace.style.setProperty("--composer-clearance", `${clearance}px`);
      root.style.scrollPaddingBottom = `${clearance}px`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(dock);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      workspace.style.removeProperty("--composer-clearance");
      root.style.scrollPaddingBottom = previousScrollPadding;
    };
  }, []);
  return <div ref={ref} className="composer-dock">{children}</div>;
}
