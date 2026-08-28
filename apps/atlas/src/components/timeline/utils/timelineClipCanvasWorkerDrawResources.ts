import type { TimelineClipCanvasWorkerDrawMessage } from './timelineClipCanvasWorkerContract';
import type { TimelineClipCanvasWorkerPreparedClipResources } from './timelineClipCanvasWorkerModel';

export interface PendingTimelineClipCanvasWorkerDraw {
  requestId: number;
  trackId: string;
  inputClipCount: number;
  visibleClipCount: number;
  thumbnailClipCount: number;
  thumbnailDrawCount: number;
  message: TimelineClipCanvasWorkerDrawMessage;
  transferables: Transferable[];
  posted: boolean;
}

export function mergeTimelineClipCanvasWorkerPreparedResourcesByClipId(
  base: ReadonlyMap<string, TimelineClipCanvasWorkerPreparedClipResources> | undefined,
  transient: ReadonlyMap<string, TimelineClipCanvasWorkerPreparedClipResources> | undefined,
): ReadonlyMap<string, TimelineClipCanvasWorkerPreparedClipResources> | undefined {
  if (!base) return transient;
  if (!transient) return base;
  const merged = new Map<string, TimelineClipCanvasWorkerPreparedClipResources>();
  base.forEach((resources, clipId) => {
    merged.set(clipId, resources);
  });
  transient.forEach((resources, clipId) => {
    merged.set(clipId, {
      ...(merged.get(clipId) ?? {}),
      ...resources,
    });
  });
  return merged;
}

export function getTimelineClipCanvasWorkerDrawThumbnailCounts(
  message: TimelineClipCanvasWorkerDrawMessage,
): { thumbnailClipCount: number; thumbnailDrawCount: number } {
  let thumbnailClipCount = 0;
  let thumbnailDrawCount = 0;
  message.paintPayloads.thumbnailStrips.forEach((payload) => {
    thumbnailClipCount += 1;
    thumbnailDrawCount += payload.resource.drawCount;
  });
  message.paintPayloads.compositionVisuals.forEach((payload) => {
    if (!payload.resource.segmentThumbnailStrip) return;
    thumbnailClipCount += 1;
    thumbnailDrawCount += payload.resource.segmentThumbnailStrip.drawCount;
  });
  return { thumbnailClipCount, thumbnailDrawCount };
}

export function closeUnpostedTimelineClipCanvasWorkerDrawResources(
  pending: PendingTimelineClipCanvasWorkerDraw | null,
): void {
  if (!pending || pending.posted) return;
  pending.message.paintPayloads.thumbnailStrips.forEach((payload) => {
    payload.resource.bitmap.close();
  });
  pending.message.paintPayloads.compositionVisuals.forEach((payload) => {
    payload.resource.segmentThumbnailStrip?.bitmap.close();
  });
}
