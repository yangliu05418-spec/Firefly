import { useEffect, useState, type RefObject } from 'react';
import { TimelineNavigator } from '../TimelineNavigator';

interface TimelineNavigatorChromeProps {
  duration: number;
  maxZoom: number;
  minZoom: number;
  onScrollChange: (scrollX: number) => void;
  onZoomChange: (zoom: number) => void;
  scrollX: number;
  slotGridProgress: number;
  timelineBodyRef: RefObject<HTMLDivElement | null>;
  zoom: number;
}

export function TimelineNavigatorChrome({
  duration,
  maxZoom,
  minZoom,
  onScrollChange,
  onZoomChange,
  scrollX,
  slotGridProgress,
  timelineBodyRef,
  zoom,
}: TimelineNavigatorChromeProps) {
  const [viewportWidth, setViewportWidth] = useState(800);

  useEffect(() => {
    const viewportElement = timelineBodyRef.current
      ?.querySelector('.track-lanes-scroll')
      ?.parentElement;
    if (!viewportElement) return;

    const updateViewportWidth = () => {
      setViewportWidth(viewportElement.clientWidth || 800);
    };

    updateViewportWidth();
    const observer = new ResizeObserver(updateViewportWidth);
    observer.observe(viewportElement);
    return () => observer.disconnect();
  }, [timelineBodyRef]);

  if (slotGridProgress >= 1) return null;

  return (
    <TimelineNavigator
      duration={duration}
      scrollX={scrollX}
      zoom={zoom}
      viewportWidth={viewportWidth}
      minZoom={minZoom}
      maxZoom={maxZoom}
      onScrollChange={onScrollChange}
      onZoomChange={onZoomChange}
    />
  );
}
