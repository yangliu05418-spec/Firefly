import type { TimelineClip } from '../types';
import { updateClipById } from '../helpers/clipStateHelpers';
import { Logger } from '../../../services/logger';
import { thumbnailRenderer } from '../../../services/thumbnailRenderer';
import { generateTimelineNestedCompositionFallbackVideoThumbnails } from '../../../services/timeline/timelineNestedCompositionThumbnailRuntime';
import type {
  NestedCompositionStoreGet,
  NestedCompositionStoreSet,
} from '../nestedCompositionLoader';

const log = Logger.create('NestedCompositionLoader');

export interface GenerateCompThumbnailsParams {
  clipId: string;
  nestedClips: TimelineClip[];
  compDuration: number;
  thumbnailsEnabled: boolean;
  boundaries?: number[];
  get: NestedCompositionStoreGet;
  set: NestedCompositionStoreSet;
}

/**
 * Generate thumbnails for nested composition using WebGPU rendering.
 * Shows all layers with effects, not just the first video.
 * Uses segment boundaries to ensure each clip section gets a representative thumbnail.
 * Falls back to polling first video if WebGPU fails.
 */
export async function generateCompThumbnails(params: GenerateCompThumbnailsParams): Promise<void> {
  const { clipId, compDuration, thumbnailsEnabled, boundaries, get, set } = params;

  if (!thumbnailsEnabled) return;

  const compClip = get().clips.find((c: TimelineClip) => c.id === clipId);
  if (!compClip?.compositionId) {
    log.warn('No composition ID for comp clip', { clipId });
    return;
  }

  try {
    log.info('Generating WebGPU thumbnails for nested comp', {
      clipId,
      compositionId: compClip.compositionId,
      compDuration,
      boundaryCount: boundaries?.length ?? 0,
      boundaries: boundaries?.map(b => (b * 100).toFixed(1) + '%'),
    });

    const thumbnails = await thumbnailRenderer.generateCompositionThumbnails(
      compClip.compositionId,
      compDuration,
      { count: 10, width: 160, height: 90, boundaries },
    );

    log.info('WebGPU thumbnail result', { clipId, count: thumbnails.length, hasData: thumbnails.length > 0 });

    if (thumbnails.length > 0) {
      set({ clips: updateClipById(get().clips, clipId, { thumbnails }) });
      log.info('Set thumbnails for nested comp', { clipId, count: thumbnails.length });
      return;
    }

    log.warn('WebGPU returned empty thumbnails', { clipId, compositionId: compClip.compositionId });
  } catch (e) {
    log.error('WebGPU thumbnail generation failed, falling back to video-based', e);
  }

  log.warn('Using FALLBACK thumbnail generation (first video only)');
  await generateCompThumbnailsFallback(params);
}

async function generateCompThumbnailsFallback(params: GenerateCompThumbnailsParams): Promise<void> {
  const { clipId, nestedClips, compDuration, get, set } = params;

  const firstVideoClip = nestedClips.find(c =>
    c.file?.type?.startsWith('video/') ||
    c.source?.type === 'video' ||
    /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(c.file?.name || c.name || '')
  );
  const firstVideoClipId = firstVideoClip?.id;
  if (!firstVideoClipId) return;

  let attempts = 0;
  const maxAttempts = 50;

  const checkAndGenerate = async () => {
    if (!get().thumbnailsEnabled) return;

    const compClip = get().clips.find((c: TimelineClip) => c.id === clipId);
    const currentNestedClip = compClip?.nestedClips?.find((nc: TimelineClip) => nc.id === firstVideoClipId);
    const thumbnails = await generateTimelineNestedCompositionFallbackVideoThumbnails(
      currentNestedClip,
      compDuration,
    );

    if (thumbnails) {
      try {
        set({ clips: updateClipById(get().clips, clipId, { thumbnails }) });
        log.debug('Generated fallback thumbnails for nested comp', { clipId, count: thumbnails.length });
      } catch (e) {
        log.warn('Failed to generate fallback thumbnails for nested comp', e);
      }
    } else if (attempts < maxAttempts) {
      attempts++;
      setTimeout(checkAndGenerate, 100);
    } else {
      log.warn('Timeout waiting for nested video to load for thumbnails', { clipId });
    }
  };

  setTimeout(checkAndGenerate, 100);
}
