import { beforeEach, describe, expect, it, vi } from 'vitest';

const thumbnailCache = vi.hoisted(() => ({
  getThumbnailsForRange: vi.fn(),
}));
const bitmapCache = vi.hoisted(() => ({
  ensure: vi.fn(),
  get: vi.fn((url: string) => ({ url })),
}));
const cover = vi.hoisted(() => ({ draw: vi.fn() }));

vi.mock('../../src/services/thumbnailCacheService', () => ({
  thumbnailCacheService: thumbnailCache,
}));
vi.mock('../../src/services/timeline/thumbnailBitmapCache', () => ({
  ensureThumbnailBitmap: bitmapCache.ensure,
  getThumbnailBitmap: bitmapCache.get,
  hasThumbnailBitmap: vi.fn(() => false),
}));
vi.mock('../../src/components/timeline/utils/timelineClipCanvasCoverDraw', () => ({
  drawTimelineClipCanvasCover: cover.draw,
}));

import { drawTimelineClipCanvasThumbnails } from '../../src/components/timeline/utils/timelineClipCanvasThumbnailPainter';
import { resolveTimelineThumbnailUrls } from '../../src/components/timeline/utils/timelineClipCanvasThumbnailPreparation';
import type { TimelinePaintSourceClip } from '../../src/timeline';

const clip: TimelinePaintSourceClip = {
  duration: 3,
  id: 'clip-1',
  inPoint: 0,
  name: 'clip.mp4',
  outPoint: 3,
  source: { mediaFileId: 'media-1', naturalDuration: 3, type: 'video' },
  startTime: 0,
  trackId: 'track-1',
};

describe('timeline video thumbnail fallback', () => {
  beforeEach(() => {
    thumbnailCache.getThumbnailsForRange.mockReset();
    bitmapCache.get.mockClear();
    bitmapCache.ensure.mockClear();
    cover.draw.mockClear();
  });

  it('uses the poster immediately while the sampled filmstrip is warming', () => {
    expect(resolveTimelineThumbnailUrls([], '/media/poster.webp', 4)).toEqual([
      '/media/poster.webp',
      '/media/poster.webp',
      '/media/poster.webp',
      '/media/poster.webp',
    ]);
  });

  it('promotes to sampled frames as soon as they are available', () => {
    expect(resolveTimelineThumbnailUrls(
      ['blob:first-frame', 'blob:middle-frame', 'blob:last-frame'],
      '/media/poster.webp',
      3,
    )).toEqual(['blob:first-frame', 'blob:middle-frame', 'blob:last-frame']);
  });

  it('keeps the poster in slots whose sampled frame is not ready yet', () => {
    expect(resolveTimelineThumbnailUrls(
      ['blob:first-frame', null, 'blob:last-frame'],
      '/media/poster.webp',
      3,
    )).toEqual(['blob:first-frame', '/media/poster.webp', 'blob:last-frame']);
  });

  it('does not invent a thumbnail when neither source is ready', () => {
    expect(resolveTimelineThumbnailUrls([], undefined, 3)).toEqual([]);
  });

  it('draws sampled frames and uses the poster only for slots still warming', () => {
    thumbnailCache.getThumbnailsForRange.mockReturnValue([
      'blob:frame-0',
      null,
      'blob:frame-2',
    ]);

    const drawn = drawTimelineClipCanvasThumbnails(
      {} as CanvasRenderingContext2D,
      clip,
      'media-1',
      0,
      0,
      72,
      40,
      vi.fn(),
      4,
      24,
      '/api/generations/task-1/poster',
    );

    expect(thumbnailCache.getThumbnailsForRange).toHaveBeenCalledWith(
      'media-1', 0, 3, 3, undefined,
    );
    expect(bitmapCache.get.mock.calls.map(([url]) => url)).toEqual([
      'blob:frame-0',
      '/api/generations/task-1/poster',
      'blob:frame-2',
    ]);
    expect(cover.draw).toHaveBeenCalledTimes(3);
    expect(drawn).toBe(3);
  });
});
