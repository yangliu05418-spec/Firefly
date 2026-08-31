import { thumbnailCacheService } from '../../../services/thumbnailCacheService';
import { ensureThumbnailBitmap, getThumbnailBitmap } from '../../../services/timeline/thumbnailBitmapCache';
import type { TimelinePaintSourceClip } from '../../../timeline';
import { drawTimelineClipCanvasCover } from './timelineClipCanvasCoverDraw';
import { resolveTimelineThumbnailUrls } from './timelineClipCanvasThumbnailPreparation';

export function drawTimelineClipCanvasThumbnails(
  ctx: CanvasRenderingContext2D,
  clip: TimelinePaintSourceClip,
  mediaFileId: string,
  x: number,
  top: number,
  w: number,
  h: number,
  requestRedraw: () => void,
  maxThumbnailSlots: number,
  thumbnailSlotPx: number,
  staticThumbnailUrl?: string,
): number {
  const count = Math.max(1, Math.min(maxThumbnailSlots, Math.floor(w / thumbnailSlotPx)));
  const generatedUrls = clip.source?.type === 'video'
    ? thumbnailCacheService.getThumbnailsForRange(
      mediaFileId,
      clip.inPoint ?? 0,
      clip.outPoint ?? (clip.inPoint ?? 0) + clip.duration,
      count,
      clip.reversed,
    )
    : [];
  const urls = resolveTimelineThumbnailUrls(generatedUrls, staticThumbnailUrl, count);
  const slotW = w / count;
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    const url = urls[i];
    if (!url) continue;
    const bmp = getThumbnailBitmap(url);
    if (bmp) {
      drawTimelineClipCanvasCover(ctx, bmp, x + i * slotW, top, slotW, h);
      drawn += 1;
    } else {
      ensureThumbnailBitmap(url, requestRedraw, mediaFileId);
    }
  }
  return drawn;
}
