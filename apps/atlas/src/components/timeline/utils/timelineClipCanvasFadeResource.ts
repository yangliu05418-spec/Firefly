import type { TimelinePaintFadeVisuals } from '../../../timeline/paint';
import { buildFadeCurveGeometry, type FadeCurveKeyframe } from './fadeCurvePath';
import type { TimelineClipCanvasWorkerPreparedClipResources } from './timelineClipCanvasWorkerModel';

export function createTimelineClipCanvasWorkerFadeVisualsResource(input: {
  fade: TimelinePaintFadeVisuals | undefined;
  clipWidth: number;
  height: number;
}): TimelineClipCanvasWorkerPreparedClipResources['fadeVisuals'] | undefined {
  const { fade, clipWidth, height } = input;
  if (!fade || fade.keyframes.length < 2) return undefined;

  const bodyHeight = Math.max(1, height - 2);
  const geometry = buildFadeCurveGeometry({
    keyframes: fade.keyframes satisfies readonly FadeCurveKeyframe[],
    clipDuration: fade.clipDuration,
    width: clipWidth,
    height: bodyHeight,
  });
  if (!geometry || geometry.segments.length === 0 || geometry.points.length < 2) return undefined;

  const curves: number[] = [];
  geometry.segments.forEach((segment) => {
    curves.push(
      segment.cp1.x,
      segment.cp1.y,
      segment.cp2.x,
      segment.cp2.y,
      segment.end.x,
      segment.end.y,
    );
  });
  const points: number[] = [];
  geometry.points.forEach((point) => {
    points.push(point.x, point.y);
  });

  return {
    kind: 'fade-visuals',
    startX: geometry.startPoint.x,
    startY: geometry.startPoint.y,
    curves: Float32Array.from(curves),
    curveCount: geometry.segments.length,
    points: Float32Array.from(points),
    pointCount: geometry.points.length,
    isAudioClip: fade.isAudioClip,
  };
}
