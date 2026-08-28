import { useLayoutEffect } from 'react';

const MIN_FIT_HEIGHT_PX = 280;
const BOTTOM_GAP_PX = 10;

function findScrollParent(element: HTMLElement | null): HTMLElement | null {
  let current = element?.parentElement ?? null;
  while (current) {
    const style = window.getComputedStyle(current);
    if (/(auto|scroll|overlay)/.test(style.overflowY)) return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * Fits the EQ to the visible host panel area: the root gets an explicit pixel
 * height so the display plus floating control module always end at the scroll
 * viewport's bottom edge instead of forcing the panel to scroll. Falls back
 * to the CSS height when no scrollable ancestor exists.
 */
export function useFitVisiblePanelHeight(rootRef: { current: HTMLElement | null }) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof window === 'undefined') return undefined;
    const scrollParent = findScrollParent(root);
    if (!scrollParent) return undefined;

    const apply = () => {
      const parentRect = scrollParent.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      // Offset of the root inside the scroll content (scroll-position
      // independent), so the computed height stays stable while scrolling.
      const topInsideContent = (rootRect.top - parentRect.top) + scrollParent.scrollTop;
      const available = scrollParent.clientHeight - topInsideContent - BOTTOM_GAP_PX;
      const height = Math.max(MIN_FIT_HEIGHT_PX, Math.round(available));
      root.style.height = `${height}px`;
    };

    apply();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', apply);
      return () => {
        window.removeEventListener('resize', apply);
        root.style.height = '';
      };
    }

    const observer = new ResizeObserver(apply);
    observer.observe(scrollParent);
    window.addEventListener('resize', apply);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', apply);
      root.style.height = '';
    };
  }, [rootRef]);
}
