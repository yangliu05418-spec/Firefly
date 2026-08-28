import { getThumbnailBitmap } from '../../../services/timeline/thumbnailBitmapCache';
import type { TimelineClipCanvasWorkerPreparedClipResources } from './timelineClipCanvasWorkerModel';

export const TIMELINE_CLIP_CANVAS_WORKER_THUMBNAIL_STRIP_MAX_WIDTH = 2048;
export const TIMELINE_CLIP_CANVAS_WORKER_THUMBNAIL_STRIP_MAX_HEIGHT = 128;

export interface TimelineClipCanvasWorkerThumbnailStripPlan {
  clipId: string;
  mediaFileId: string;
  x: number;
  width: number;
  height: number;
  bitmapWidth: number;
  bitmapHeight: number;
  urls: readonly (string | null)[];
}

function drawCover(
  ctx: OffscreenCanvasRenderingContext2D,
  bmp: ImageBitmap,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const scale = Math.max(dw / bmp.width, dh / bmp.height);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (bmp.width - sw) / 2;
  const sy = (bmp.height - sh) / 2;
  ctx.drawImage(bmp, sx, sy, sw, sh, dx, dy, dw, dh);
}

function createTimelineClipCanvasWorkerThumbnailStripResource(
  plan: TimelineClipCanvasWorkerThumbnailStripPlan,
): TimelineClipCanvasWorkerPreparedClipResources['thumbnailStrip'] | undefined {
  if (typeof OffscreenCanvas === 'undefined') return undefined;
  const canvas = new OffscreenCanvas(plan.bitmapWidth, plan.bitmapHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  const slotWidth = plan.bitmapWidth / plan.urls.length;
  let drawCount = 0;
  for (let index = 0; index < plan.urls.length; index += 1) {
    const url = plan.urls[index];
    if (!url) continue;
    const bitmap = getThumbnailBitmap(url);
    if (!bitmap) continue;
    drawCover(ctx, bitmap, index * slotWidth, 0, slotWidth, plan.bitmapHeight);
    drawCount += 1;
  }
  if (drawCount === 0) return undefined;

  return {
    kind: 'thumbnail-strip',
    bitmap: canvas.transferToImageBitmap(),
    x: plan.x,
    width: plan.width,
    height: plan.height,
    drawCount,
  };
}

export function createTimelineClipCanvasWorkerThumbnailResourcesByClipId(
  plansByClipId: ReadonlyMap<string, TimelineClipCanvasWorkerThumbnailStripPlan>,
): ReadonlyMap<string, TimelineClipCanvasWorkerPreparedClipResources> | undefined {
  if (plansByClipId.size === 0) return undefined;
  const resourcesByClipId = new Map<string, TimelineClipCanvasWorkerPreparedClipResources>();
  for (const [clipId, plan] of plansByClipId) {
    const thumbnailStrip = createTimelineClipCanvasWorkerThumbnailStripResource(plan);
    if (thumbnailStrip) {
      resourcesByClipId.set(clipId, { thumbnailStrip });
    }
  }
  return resourcesByClipId.size > 0 ? resourcesByClipId : undefined;
}
