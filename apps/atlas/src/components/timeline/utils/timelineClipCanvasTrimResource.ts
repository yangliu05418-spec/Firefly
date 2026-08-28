import type { TimelineClipCanvasWorkerPreparedClipResources } from './timelineClipCanvasWorkerModel';

export interface TimelineClipCanvasTrimGeometry {
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  visible: boolean;
  trimEdge?: 'left' | 'right';
  originalStartTime: number;
  originalEndTime: number;
  sourceDuration: number;
}

type WorkerPreparedTrimVisualsResource = TimelineClipCanvasWorkerPreparedClipResources['trimVisuals'];

function collectTimelineClipCanvasSourceExtensionGhosts(input: {
  geometry: TimelineClipCanvasTrimGeometry;
  canvasOffsetX: number;
  scrollX: number;
  viewportWidth: number;
  renderOverscanPx: number;
  timeToPixel: (time: number) => number;
}): NonNullable<WorkerPreparedTrimVisualsResource>['sourceExtensionGhosts'] | undefined {
  const { geometry } = input;
  if (!geometry.trimEdge) return undefined;

  const displayEnd = geometry.startTime + geometry.duration;
  const visibleLeft = input.scrollX - input.renderOverscanPx;
  const visibleRight = input.scrollX + input.viewportWidth + input.renderOverscanPx;
  const ghosts: Array<{ edge: 'left' | 'right'; x: number; width: number }> = [];

  const pushGhost = (edge: 'left' | 'right', startTime: number, endTime: number): boolean => {
    const ghostStartTime = Math.max(0, Math.min(startTime, endTime));
    const ghostEndTime = Math.max(ghostStartTime, Math.max(startTime, endTime));
    if (ghostEndTime - ghostStartTime <= 0.001) return false;

    const rawLeft = input.timeToPixel(ghostStartTime);
    const rawRight = input.timeToPixel(ghostEndTime);
    const clippedLeft = Math.max(rawLeft, visibleLeft);
    const clippedRight = Math.min(rawRight, visibleRight);
    if (clippedRight - clippedLeft < 1) return false;

    ghosts.push({
      edge,
      x: clippedLeft - input.canvasOffsetX,
      width: clippedRight - clippedLeft,
    });
    return true;
  };

  let drewPrimaryGhost = false;
  if (geometry.trimEdge === 'left') {
    const availableLeftDuration = Math.min(
      Math.max(0, geometry.inPoint),
      Math.max(0, geometry.startTime),
    );
    if (availableLeftDuration > 0.001) {
      drewPrimaryGhost = pushGhost('left', geometry.startTime - availableLeftDuration, geometry.startTime) ||
        drewPrimaryGhost;
    }
  }

  if (geometry.trimEdge === 'right') {
    const availableRightDuration = Math.max(0, geometry.sourceDuration - geometry.outPoint);
    if (availableRightDuration > 0.001) {
      drewPrimaryGhost = pushGhost('right', displayEnd, displayEnd + availableRightDuration) || drewPrimaryGhost;
    }
  }

  if (
    !drewPrimaryGhost &&
    geometry.trimEdge === 'left' &&
    Math.abs(geometry.startTime - geometry.originalStartTime) > 0.001
  ) {
    pushGhost(
      'left',
      Math.min(geometry.startTime, geometry.originalStartTime),
      Math.max(geometry.startTime, geometry.originalStartTime),
    );
  }

  if (
    !drewPrimaryGhost &&
    geometry.trimEdge === 'right' &&
    Math.abs(displayEnd - geometry.originalEndTime) > 0.001
  ) {
    pushGhost('right', Math.min(displayEnd, geometry.originalEndTime), Math.max(displayEnd, geometry.originalEndTime));
  }

  return ghosts.length > 0 ? ghosts : undefined;
}

export function createTimelineClipCanvasWorkerTrimVisualsResource(input: {
  geometry: TimelineClipCanvasTrimGeometry;
  canvasOffsetX: number;
  scrollX: number;
  viewportWidth: number;
  renderOverscanPx: number;
  timeToPixel: (time: number) => number;
}): WorkerPreparedTrimVisualsResource | undefined {
  const { geometry } = input;
  if (!geometry.visible) return undefined;

  const absoluteX = input.timeToPixel(geometry.startTime);
  const absoluteW = input.timeToPixel(geometry.duration);
  if (absoluteW <= 0) return undefined;

  const sourceExtensionGhosts = collectTimelineClipCanvasSourceExtensionGhosts(input);
  return {
    kind: 'trim-visuals',
    body: {
      x: absoluteX - input.canvasOffsetX,
      width: absoluteW,
    },
    sourceExtensionGhosts,
  };
}
