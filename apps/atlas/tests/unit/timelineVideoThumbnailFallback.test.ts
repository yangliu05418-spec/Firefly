import { describe, expect, it } from 'vitest';
import { resolveTimelineThumbnailUrls } from '../../src/components/timeline/utils/timelineClipCanvasThumbnailPreparation';

describe('timeline video thumbnail fallback', () => {
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

  it('does not invent a thumbnail when neither source is ready', () => {
    expect(resolveTimelineThumbnailUrls([], undefined, 3)).toEqual([]);
  });
});
