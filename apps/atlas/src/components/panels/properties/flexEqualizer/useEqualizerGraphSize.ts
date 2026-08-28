import { useLayoutEffect, useState } from 'react';

import { DEFAULT_GRAPH_HEIGHT, DEFAULT_GRAPH_WIDTH } from './graphMath';

/**
 * Measures the graph stage's content box. The stage is sized purely by CSS
 * (the display fills the available panel height), so both dimensions come
 * from the ResizeObserver instead of deriving height from width.
 */
export function useEqualizerGraphSize(ref: { current: HTMLElement | null }) {
  const [size, setSize] = useState({
    width: DEFAULT_GRAPH_WIDTH,
    height: DEFAULT_GRAPH_HEIGHT,
  });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const update = (measuredWidth: number, measuredHeight: number) => {
      const width = Math.max(1, Math.round(measuredWidth || DEFAULT_GRAPH_WIDTH));
      const height = Math.max(1, Math.round(measuredHeight || DEFAULT_GRAPH_HEIGHT));
      setSize(current => (
        current.width === width && current.height === height ? current : { width, height }
      ));
    };

    update(element.clientWidth, element.clientHeight);
    if (typeof ResizeObserver === 'undefined') {
      const handleResize = () => update(element.clientWidth, element.clientHeight);
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }

    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      update(rect?.width ?? element.clientWidth, rect?.height ?? element.clientHeight);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
