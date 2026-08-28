import type {
  TimelineKeyframeDiamondGeometry,
  TimelineKeyframeRowGeometry,
} from './TimelineGeometrySnapshot';
import { createTimelineRect } from './rect';

export interface TimelineKeyframeGeometryInput {
  id: string;
  clipId: string;
  property: string;
  time: number;
}

export interface BuildTimelineKeyframeRowGeometriesInput {
  trackId: string;
  clipId?: string;
  properties: readonly string[];
  keyframes: readonly TimelineKeyframeGeometryInput[];
  selectedKeyframeIds?: ReadonlySet<string>;
  contentWidth: number;
  pxPerSecond: number;
  clipStartTime?: number;
  rowHeightPx?: number;
  rowGapPx?: number;
  topOffsetPx?: number;
  diamondHitSizePx?: number;
}

export function buildTimelineKeyframeRowGeometries(
  input: BuildTimelineKeyframeRowGeometriesInput,
): TimelineKeyframeRowGeometry[] {
  const rowHeightPx = input.rowHeightPx ?? 18;
  const rowGapPx = input.rowGapPx ?? 0;
  const topOffsetPx = input.topOffsetPx ?? 0;
  const diamondHitSizePx = input.diamondHitSizePx ?? 12;
  const clipStartTime = input.clipStartTime ?? 0;
  const selectedKeyframeIds = input.selectedKeyframeIds ?? new Set<string>();

  return input.properties.map((property, index) => {
    const y = topOffsetPx + index * (rowHeightPx + rowGapPx);
    const rowRect = createTimelineRect(0, y, input.contentWidth, rowHeightPx);
    const diamonds: TimelineKeyframeDiamondGeometry[] = input.keyframes
      .filter((keyframe) => keyframe.property === property)
      .map((keyframe) => {
        const centerX = (clipStartTime + keyframe.time) * input.pxPerSecond;
        const centerY = rowRect.y + rowRect.height / 2;
        return {
          keyframeId: keyframe.id,
          rectId: `keyframe-diamond-${keyframe.id}`,
          clipId: keyframe.clipId,
          trackId: input.trackId,
          property,
          time: keyframe.time,
          rect: createTimelineRect(
            centerX - diamondHitSizePx / 2,
            centerY - diamondHitSizePx / 2,
            diamondHitSizePx,
            diamondHitSizePx,
          ),
          selected: selectedKeyframeIds.has(keyframe.id),
        };
      });

    return {
      id: `keyframe-row:${input.trackId}:${property}`,
      trackId: input.trackId,
      clipId: input.clipId,
      property,
      rowRect,
      diamonds,
    };
  });
}
